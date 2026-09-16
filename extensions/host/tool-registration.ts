import { presentationAdapterFromDefinition, type ToolPresentationAdapter } from "../domain/tool-presentation.ts";
import { classifyToolOwner, readToolOwners, toolDefinitionSnapshot, toolOwnershipSnapshot, type ToolOwnerKind } from "./tool-ownership.ts";

export interface ToolRegistrationHost<TDefinition extends { name?: string }> {
	registerTool(definition: TDefinition): void;
	getAllTools?: () => unknown;
}

export interface ToolRegistrationOptions {
	skipped: ReadonlySet<string>;
	onDiagnostic?: (key: string, error: unknown) => void;
}

/**
 * Owns the execution-registration state machine independently from presentation.
 * Unknown/external ownership always preserves the host tool. A prior proven
 * builtin/self owner permits eager registration during reload before transcript
 * rows are reconstructed.
 */
export class ToolRegistrationCoordinator<TDefinition extends { name?: string }> {
	private readonly pending: TDefinition[] = [];
	private readonly installed = new Set<string>();
	private readonly presentations = new Map<string, ToolPresentationAdapter>();
	private readonly priorOwnership = toolOwnershipSnapshot();
	private readonly originalDefinitions = toolDefinitionSnapshot<TDefinition>();
	private readonly canRegisterDuringFactory: boolean;
	private warningShown = false;

	constructor(
		private readonly host: ToolRegistrationHost<TDefinition>,
		private readonly options: ToolRegistrationOptions,
	) {
		let available = false;
		try {
			available = Array.isArray(host.getAllTools?.());
		} catch (error) {
			options.onDiagnostic?.("tool-registry-probe", error);
		}
		this.canRegisterDuringFactory = available;
		if (available) this.captureOriginalDefinitions();
	}

	private captureOriginalDefinitions(): void {
		try {
			const tools = this.host.getAllTools?.();
			if (!Array.isArray(tools)) return;
			for (const candidate of tools) {
				const name = String((candidate as any)?.name ?? "").toLowerCase();
				if (name && classifyToolOwner(candidate) === "builtin" && !this.originalDefinitions.has(name)) {
					this.originalDefinitions.set(name, candidate as TDefinition);
				}
			}
		} catch (error) {
			this.options.onDiagnostic?.("tool-definition-snapshot", error);
		}
	}

	private restoreOriginal(name: string, owner: ToolOwnerKind | undefined): boolean {
		const original = this.originalDefinitions.get(name);
		if (owner !== "self" || !original) return false;
		this.host.registerTool(original);
		return true;
	}

	private owners(): Map<string, ToolOwnerKind> | null {
		return readToolOwners(
			this.host.getAllTools ? () => this.host.getAllTools!() : undefined,
			(error) => this.options.onDiagnostic?.("tool-owner-snapshot", error),
		);
	}

	add(definition: TDefinition): void {
		const name = String(definition?.name ?? "").toLowerCase();
		if (!name) return;
		this.pending.push(definition);
		const priorOwner = this.priorOwnership.get(name);
		const currentOwners = this.canRegisterDuringFactory ? this.owners() : null;
		const currentOwner = currentOwners?.get(name);
		const currentAbsent = !!currentOwners && !currentOwners.has(name);
		if (this.options.skipped.has(name)) {
			if (this.canRegisterDuringFactory) this.restoreOriginal(name, currentOwner);
			return;
		}
		const presentation = presentationAdapterFromDefinition(definition);
		if (presentation) this.presentations.set(presentation.name, presentation);
		if (
			(this.canRegisterDuringFactory && (currentAbsent || currentOwner === "builtin" || currentOwner === "self"))
			|| (!this.canRegisterDuringFactory && (priorOwner === "builtin" || priorOwner === "self"))
		) {
			this.host.registerTool(definition);
			this.installed.add(name);
		}
	}

	installDeferred(notify?: (message: string, kind: "warning") => void): void {
		this.captureOriginalDefinitions();
		const owners = this.owners();
		if (owners) {
			for (const definition of this.pending) {
				const name = String(definition?.name ?? "").toLowerCase();
				if (name) this.priorOwnership.set(name, owners.get(name) ?? "unknown");
			}
		}
		const unknownNames: string[] = [];
		for (const definition of this.pending) {
			const name = String(definition?.name ?? "").toLowerCase();
			const owner = owners?.get(name) ?? "unknown";
			if (!name || this.installed.has(name)) continue;
			if (this.options.skipped.has(name)) { this.restoreOriginal(name, owner); continue; }
			if (owner === "external") continue;
			if (owner === "unknown") { unknownNames.push(name); continue; }
			this.host.registerTool(definition);
			this.installed.add(name);
		}
		if (!this.warningShown && unknownNames.length > 0 && notify) {
			this.warningShown = true;
			notify(`Claudify preserved native ${unknownNames.join(", ")} tools because ownership could not be verified`, "warning");
		}
	}

	presentationAdapters(): Iterable<ToolPresentationAdapter> {
		return this.presentations.values();
	}
}
