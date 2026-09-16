import { sharedState } from "./shared-state.ts";

export type ToolOwnerKind = "builtin" | "self" | "external" | "unknown";

const TOOL_OWNERSHIP_SNAPSHOT_KEY = Symbol.for("pi-claudify:tool-ownership-snapshot");
const TOOL_DEFINITION_SNAPSHOT_KEY = Symbol.for("pi-claudify:tool-definition-snapshot");

export function toolOwnershipSnapshot(): Map<string, ToolOwnerKind> {
	return sharedState(TOOL_OWNERSHIP_SNAPSHOT_KEY, () => new Map<string, ToolOwnerKind>());
}

/** Original proven-builtin definitions captured before Claudify replaces them. */
export function toolDefinitionSnapshot<T = unknown>(): Map<string, T> {
	return sharedState(TOOL_DEFINITION_SNAPSHOT_KEY, () => new Map<string, T>());
}

export function classifyToolOwner(tool: any): ToolOwnerKind {
	const sourceInfo = tool?.sourceInfo;
	if (!sourceInfo) return "unknown";
	if (sourceInfo.source === "builtin") return "builtin";
	const identity = `${sourceInfo.path ?? ""}\n${sourceInfo.source ?? ""}`.toLowerCase();
	const packageBoundary = /(?:^|[\\/:])(?:@owlburtoe[\\/])?pi-claudify(?:$|[\\/:])/m;
	return packageBoundary.test(identity) ? "self" : "external";
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
