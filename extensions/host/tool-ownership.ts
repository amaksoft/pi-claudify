import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedState } from "./shared-state.ts";

export type ToolOwnerKind = "builtin" | "self" | "external" | "unknown";

const TOOL_OWNERSHIP_SNAPSHOT_KEY = Symbol.for("pi-claudify:tool-ownership-snapshot");

export function toolOwnershipSnapshot(): Map<string, ToolOwnerKind> {
	return sharedState(TOOL_OWNERSHIP_SNAPSHOT_KEY, () => new Map<string, ToolOwnerKind>());
}


const CLAUDIFY_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function claudifySourceRoot(): string { return CLAUDIFY_SOURCE_ROOT; }

function isWithinSourceRoot(value: unknown): boolean {
	if (typeof value !== "string" || !value) return false;
	if (/^(?:(?:npm|extension):)?(?:@owlburtoe\/)?pi-claudify(?:@[^/]+)?$/i.test(value)) return true;
	if (!value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value)) return false;
	const rel = relative(CLAUDIFY_SOURCE_ROOT, resolve(value));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function classifyToolOwner(tool: any): ToolOwnerKind {
	const sourceInfo = tool?.sourceInfo;
	if (!sourceInfo) return "unknown";
	if (sourceInfo.source === "builtin") return "builtin";
	return isWithinSourceRoot(sourceInfo.path) || isWithinSourceRoot(sourceInfo.source) ? "self" : "external";
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
