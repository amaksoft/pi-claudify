import { presentationAdapterFromDefinition, type ToolPresentationAdapter } from "../domain/tool-presentation.ts";
import { readToolOwners, toolOwnershipSnapshot, type ToolOwnerKind } from "./tool-ownership.ts";

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
	}

	private owners(): Map<string, ToolOwnerKind> | null {
		return readToolOwners(
			this.host.getAllTools ? () => this.host.getAllTools!() : undefined,
			(error) => this.options.onDiagnostic?.("tool-owner-snapshot", error),
		);
	}

	addPresentation(presentation: ToolPresentationAdapter): void {
		if (this.options.skipped.has(presentation.name)) return;
		this.presentations.set(presentation.name, presentation);
	}

	add(definition: TDefinition): void {
		const name = String(definition?.name ?? "").toLowerCase();
		if (!name) return;
		this.pending.push(definition);
		const priorOwner = this.priorOwnership.get(name);
		const currentOwners = this.canRegisterDuringFactory ? this.owners() : null;
		const currentOwner = currentOwners?.get(name);
		const currentAbsent = !!currentOwners && !currentOwners.has(name);
		if (this.options.skipped.has(name)) return;
		const presentation = presentationAdapterFromDefinition(definition);
		if (presentation) this.addPresentation(presentation);
		if (
			(this.canRegisterDuringFactory && (currentAbsent || currentOwner === "builtin" || currentOwner === "self"))
			|| (!this.canRegisterDuringFactory && (priorOwner === "builtin" || priorOwner === "self"))
		) {
			this.host.registerTool(definition);
			this.installed.add(name);
			this.priorOwnership.set(name, "self");
		}
	}

	installDeferred(notify?: (message: string, kind: "warning") => void): void {
		const owners = this.owners();
		if (owners) {
			for (const definition of this.pending) {
				const name = String(definition?.name ?? "").toLowerCase();
				if (!name) continue;
				const observed = owners.get(name) ?? "unknown";
				// Some host versions omit sourceInfo for extension tools. Never
				// downgrade a definition this coordinator successfully registered from
				// proven self ownership to unknown merely because metadata is absent.
				if (observed !== "unknown" || !this.priorOwnership.has(name)) this.priorOwnership.set(name, observed);
			}
		}
		const unknownNames: string[] = [];
		for (const definition of this.pending) {
			const name = String(definition?.name ?? "").toLowerCase();
			const owner = owners?.get(name) ?? "unknown";
			const absent = !!owners && !owners.has(name);
			if (!name || this.installed.has(name)) continue;
			if (this.options.skipped.has(name)) continue;
			if (owner === "external") continue;
			// A complete live registry that lacks this name proves there is no
			// owner to displace. This is the normal first-load path for Claudify's
			// own Cron/Ask tools because Pi exposes getAllTools only after factory
			// evaluation. Distinguish absence from an existing metadata-less tool.
			if (owner === "unknown" && !absent) { unknownNames.push(name); continue; }
			this.host.registerTool(definition);
			this.installed.add(name);
			this.priorOwnership.set(name, "self");
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
