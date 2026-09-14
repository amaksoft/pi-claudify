import { sharedState } from "./shared-state.ts";

export type ToolOwnerKind = "builtin" | "self" | "external" | "unknown";

const TOOL_OWNERSHIP_SNAPSHOT_KEY = Symbol.for("pi-claudify:tool-ownership-snapshot");

export function toolOwnershipSnapshot(): Map<string, ToolOwnerKind> {
	return sharedState(TOOL_OWNERSHIP_SNAPSHOT_KEY, () => new Map<string, ToolOwnerKind>());
}

export function classifyToolOwner(tool: any): ToolOwnerKind {
	const sourceInfo = tool?.sourceInfo;
	if (!sourceInfo) return "unknown";
	if (sourceInfo.source === "builtin") return "builtin";
	const identity = `${sourceInfo.path ?? ""}\n${sourceInfo.source ?? ""}`.toLowerCase();
	return identity.includes("pi-claudify") ? "self" : "external";
}

export function readToolOwners(getAllTools: unknown, onError?: (error: unknown) => void): Map<string, ToolOwnerKind> | null {
	if (typeof getAllTools !== "function") return null;
	try {
		const tools = getAllTools();
		if (!Array.isArray(tools)) return null;
		return new Map(tools.map((tool: any) => [String(tool?.name ?? "").toLowerCase(), classifyToolOwner(tool)]));
	} catch (error) {
		onError?.(error);
		return null;
	}
}
