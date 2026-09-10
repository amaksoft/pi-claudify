/**
 * Compatibility boundary for pi ToolExecutionComponent internals.
 *
 * result/isPartial/expanded/hideComponent are private in pi's type surface even
 * though extensions must inspect them to compose transcript rows. Keep every
 * untyped read and fallback write here so host drift has one blast radius.
 */
export interface PiToolRecord extends Record<string, any> {
	toolName?: string;
	toolCallId?: string;
	args?: Record<string, any>;
	result?: any;
	isPartial?: boolean;
	expanded?: boolean;
	hideComponent?: boolean;
	cwd?: string;
	setExpanded?: (expanded: boolean) => void;
	invalidate?: () => void;
}

export function toolComponentRecord(value: unknown): PiToolRecord {
	return value as PiToolRecord;
}

export function isToolExecutionLike(value: unknown): value is PiToolRecord & { toolName: string; toolCallId: string } {
	if (!value || typeof value !== "object") return false;
	const candidate = value as PiToolRecord & Record<string, unknown>;
	// `instanceof` is not stable when Pi and an extension resolve separate peer
	// package instances. Require the private identity fields plus the distinctive
	// ToolExecution mutation/render surface instead; uncertain rows stay native.
	const constructorName = (candidate as any).constructor?.name;
	return constructorName === "ToolExecutionComponent"
		&& typeof candidate.toolName === "string"
		&& typeof candidate.toolCallId === "string"
		&& typeof candidate.render === "function"
		&& typeof candidate.updateResult === "function"
		&& typeof candidate.setExpanded === "function"
		&& typeof candidate.updateDisplay === "function";
}

export function toolComponentCwd(value: unknown): string {
	const cwd = toolComponentRecord(value).cwd;
	return typeof cwd === "string" && cwd ? cwd : process.cwd();
}

/**
 * Streaming tools receive a partial result at execution start; terminal and
 * restored rows carry a non-partial result. Absence of isPartial means settled.
 */
export function isSettledToolExecution(value: unknown): boolean {
	const record = toolComponentRecord(value);
	return !!record.result && record.isPartial !== true;
}

export function setToolExpanded(value: unknown, expanded: boolean): void {
	const record = toolComponentRecord(value);
	if (typeof record.setExpanded === "function") record.setExpanded.call(value, expanded);
	else {
		record.expanded = expanded;
		record.invalidate?.();
	}
}
