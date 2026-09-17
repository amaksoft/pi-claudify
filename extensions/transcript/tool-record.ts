import { isToolExecutionLike, toolComponentCwd, toolComponentRecord } from "../pi-tool-adapter.ts";

export type ToolExecutionPhase = "pending" | "streaming" | "settled";

/** Immutable semantic view of one host-owned tool row for a single render. */
export interface SemanticToolRecord {
	readonly source: unknown;
	readonly id: string;
	readonly name: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly result: unknown;
	readonly phase: ToolExecutionPhase;
	readonly expanded: boolean;
	readonly cwd: string;
}

export function snapshotToolExecution(value: unknown): SemanticToolRecord | null {
	if (!isToolExecutionLike(value)) return null;
	const record = toolComponentRecord(value);
	const phase: ToolExecutionPhase = !record.result ? "pending" : record.isPartial === true ? "streaming" : "settled";
	return Object.freeze({
		source: value,
		id: record.toolCallId!,
		name: record.toolName!,
		args: Object.freeze({ ...(record.args ?? {}) }),
		result: record.result,
		phase,
		expanded: record.expanded === true,
		cwd: toolComponentCwd(value),
	});
}
