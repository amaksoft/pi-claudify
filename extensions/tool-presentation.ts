export type CompatibleInspectionToolName = "read" | "grep" | "find" | "ls" | "bash" | "write" | "edit";

const COMPATIBLE_INSPECTION_TOOLS = new Set<CompatibleInspectionToolName>(["read", "grep", "find", "ls", "bash", "write", "edit"]);

export interface ToolPresentationAdapter {
	name: CompatibleInspectionToolName;
	renderCall?: (...args: any[]) => unknown;
	renderResult?: (...args: any[]) => unknown;
}

export function compatibleInspectionToolName(value: unknown): CompatibleInspectionToolName | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.toLowerCase() as CompatibleInspectionToolName;
	return COMPATIBLE_INSPECTION_TOOLS.has(normalized) ? normalized : undefined;
}

export function supportsInspectionCall(name: CompatibleInspectionToolName, args: unknown): boolean {
	if (!args || typeof args !== "object") return false;
	const record = args as Record<string, unknown>;
	switch (name) {
		case "read":
			return typeof record.path === "string"
				&& (record.offset === undefined || typeof record.offset === "number")
				&& (record.limit === undefined || typeof record.limit === "number");
		case "grep":
		case "find":
			return typeof record.pattern === "string"
				&& (record.path === undefined || typeof record.path === "string");
		case "ls":
			return record.path === undefined || typeof record.path === "string";
		case "bash":
			return typeof record.command === "string";
		case "write":
			return typeof record.path === "string" && typeof record.content === "string";
		case "edit": {
			if (typeof record.path !== "string") return false;
			if (typeof record.oldText === "string" && typeof record.newText === "string") return true;
			return Array.isArray(record.edits) && record.edits.length > 0 && record.edits.every((edit) => {
				if (!edit || typeof edit !== "object") return false;
				const operation = edit as Record<string, unknown>;
				return typeof operation.oldText === "string" && typeof operation.newText === "string";
			});
		}
	}
}

export function supportsInspectionResult(name: CompatibleInspectionToolName, result: unknown): boolean {
	if (!result || typeof result !== "object") return false;
	const content = (result as Record<string, unknown>).content;
	if (!Array.isArray(content) || content.length === 0) return false;
	return content.every((block) => {
		if (!block || typeof block !== "object") return false;
		const record = block as Record<string, unknown>;
		if (record.type === "text") return typeof record.text === "string";
		if (name === "read" && record.type === "image") {
			return typeof record.data === "string" && typeof record.mimeType === "string";
		}
		return false;
	});
}

export function presentationAdapterFromDefinition(definition: unknown): ToolPresentationAdapter | undefined {
	if (!definition || typeof definition !== "object") return undefined;
	const record = definition as Record<string, unknown>;
	const name = compatibleInspectionToolName(record.name);
	if (!name) return undefined;
	const renderCall = typeof record.renderCall === "function" ? record.renderCall as (...args: any[]) => unknown : undefined;
	const renderResult = typeof record.renderResult === "function" ? record.renderResult as (...args: any[]) => unknown : undefined;
	if (!renderCall && !renderResult) return undefined;
	return { name, renderCall, renderResult };
}
