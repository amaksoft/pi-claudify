import { resolve } from "node:path";

import { RuntimeHandle } from "../runtime/runtime-handle.ts";
import { normalizeEditResultProvenance, type EditExecutionDependencies } from "../tools/edit-execution.ts";
import { enrichWriteResultWithSnapshot, type WriteExecutionDependencies } from "../tools/write-execution.ts";
import { captureWriteSnapshot, type WriteSnapshot } from "../write-snapshot.ts";

const MAX_PENDING_WRITE_SNAPSHOTS = 64;

interface PendingWrite {
	filePath: string;
	content: string;
	snapshot: WriteSnapshot;
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
		while (this.pendingWrites.size >= MAX_PENDING_WRITE_SNAPSHOTS) this.pendingWrites.delete(this.pendingWrites.keys().next().value!);
		this.pendingWrites.set(event.toolCallId, {
			filePath,
			content,
			snapshot: captureWriteSnapshot(resolve(cwd, filePath)),
		});
	}

	onToolResult(event: ToolResultObservation): { details: unknown } | undefined {
		if (!this.runtime.isCurrent()) return undefined;
		const name = event.toolName.toLowerCase();
		if (name === "write") {
			const pending = this.pendingWrites.get(event.toolCallId);
			this.pendingWrites.delete(event.toolCallId);
			if (!pending || event.isError || !this.dependencies.isBuiltinOwner("write")) return undefined;
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
	}

	clear(): void {
		this.pendingWrites.clear();
	}

	pendingCount(): number {
		return this.pendingWrites.size;
	}
}
