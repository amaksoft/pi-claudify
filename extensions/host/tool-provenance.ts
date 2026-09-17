import { resolve } from "node:path";

import { RuntimeHandle } from "../runtime/runtime-handle.ts";
import { normalizeEditResultProvenance, type EditExecutionDependencies } from "../tools/edit-execution.ts";
import { enrichWriteResultWithSnapshot, type WriteExecutionDependencies } from "../tools/write-execution.ts";
import { captureWriteSnapshot, type WriteSnapshot } from "../write-snapshot.ts";

const MAX_PENDING_WRITE_SNAPSHOTS = 64;

interface PendingWrite {
	filePath: string;
	absolutePath: string;
	content: string;
	snapshot: WriteSnapshot;
	ambiguous: boolean;
}

export interface ToolCallObservation {
	toolCallId: string;
	toolName: string;
	input: unknown;
}

export interface ToolResultObservation extends ToolCallObservation {
	content: unknown;
	details: unknown;
	isError: boolean;
}

export interface ToolProvenanceDependencies extends WriteExecutionDependencies, EditExecutionDependencies {
	isBuiltinOwner(name: "write" | "edit"): boolean;
}

/**
 * Presentation-only provenance capture for Pi-owned mutation tools. It never
 * executes a tool, changes arguments, or observes an external same-name tool.
 */
export class ToolProvenanceObserver {
	private readonly pendingWrites = new Map<string, PendingWrite>();
	private readonly unavailableWrites = new Set<string>();

	constructor(
		private readonly runtime: RuntimeHandle,
		private readonly dependencies: ToolProvenanceDependencies,
	) {}

	onToolCall(event: ToolCallObservation, cwd: string): void {
		if (!this.runtime.isCurrent() || event.toolName.toLowerCase() !== "write" || !this.dependencies.isBuiltinOwner("write")) return;
		const input = event.input as Record<string, unknown> | undefined;
		const filePath = typeof input?.path === "string" ? input.path : typeof input?.file_path === "string" ? input.file_path : "";
		const content = typeof input?.content === "string" ? input.content : "";
		if (!filePath) return;
		const absolutePath = resolve(cwd, filePath);
		for (const pending of this.pendingWrites.values()) {
			if (pending.absolutePath === absolutePath) pending.ambiguous = true;
		}
		while (this.pendingWrites.size >= MAX_PENDING_WRITE_SNAPSHOTS) {
			const evicted = this.pendingWrites.keys().next().value!;
			this.pendingWrites.delete(evicted);
			this.unavailableWrites.add(evicted);
		}
		while (this.unavailableWrites.size > MAX_PENDING_WRITE_SNAPSHOTS) this.unavailableWrites.delete(this.unavailableWrites.values().next().value!);
		this.pendingWrites.set(event.toolCallId, {
			filePath,
			absolutePath,
			content,
			snapshot: captureWriteSnapshot(absolutePath),
			ambiguous: [...this.pendingWrites.values()].some((pending) => pending.absolutePath === absolutePath),
		});
	}

	onToolResult(event: ToolResultObservation): { details: unknown } | undefined {
		if (!this.runtime.isCurrent()) return undefined;
		const name = event.toolName.toLowerCase();
		if (name === "write") {
			const pending = this.pendingWrites.get(event.toolCallId);
			this.pendingWrites.delete(event.toolCallId);
			const wasUnavailable = this.unavailableWrites.delete(event.toolCallId);
			if ((!pending && !wasUnavailable) || event.isError || !this.dependencies.isBuiltinOwner("write")) return undefined;
			const finalInput = event.input as Record<string, unknown> | undefined;
			const finalPath = typeof finalInput?.path === "string" ? finalInput.path : typeof finalInput?.file_path === "string" ? finalInput.file_path : "";
			const finalContent = typeof finalInput?.content === "string" ? finalInput.content : "";
			if (!pending || pending.ambiguous || finalPath !== pending.filePath || finalContent !== pending.content) {
				const existing = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
				return { details: { ...existing, _type: "diffOmitted", reason: "unavailable", filePath: finalPath || pending?.filePath || "", lines: finalContent ? finalContent.split("\n").length : 0 } };
			}
			const normalized = enrichWriteResultWithSnapshot(
				pending.snapshot,
				pending.filePath,
				pending.content,
				{ content: event.content, details: event.details },
				this.dependencies,
			);
			return { details: normalized.details };
		}
		if (name === "edit" && !event.isError && this.dependencies.isBuiltinOwner("edit")) {
			const normalized = normalizeEditResultProvenance(
				event.input,
				{ content: event.content, details: event.details },
				this.dependencies,
			);
			return { details: normalized.details };
		}
		return undefined;
	}

	onToolEnd(toolCallId: string): void {
		this.pendingWrites.delete(toolCallId);
		this.unavailableWrites.delete(toolCallId);
	}

	clear(): void {
		this.pendingWrites.clear();
		this.unavailableWrites.clear();	}

	pendingCount(): number {
		return this.pendingWrites.size;
	}
}
