// The ⎿ target row under an aggregate header: the bare path/pattern/command
// each grouped tool contributes, with no tool name or status suffix.

import { toolComponentCwd as componentCwd, toolComponentRecord } from "../pi-tool-adapter.ts";
import { sanitizeToolText } from "../terminal-sanitize.ts";
import type { InspectionGroupRuntime } from "./runtime.ts";

type TargetFormat = Pick<InspectionGroupRuntime, "shortPath" | "summarizeText">;

function formatOffsetLimit(args: any): string {
	const parts: string[] = [];
	if (args?.offset !== undefined && args?.offset !== null) parts.push(`offset=${args.offset}`);
	if (args?.limit !== undefined && args?.limit !== null) parts.push(`limit=${args.limit}`);
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function readInspectionTarget(value: unknown, fmt: TargetFormat): string {
	const rec = toolComponentRecord(value);
	return `${fmt.shortPath(componentCwd(value), rec.args?.path ?? "")}${formatOffsetLimit(rec.args)}`;
}

/** Claude Code shows the bare quoted pattern — never the search path. */
function grepInspectionTarget(value: unknown, fmt: TargetFormat): string {
	const rec = toolComponentRecord(value);
	return `"${fmt.summarizeText(rec.args?.pattern ?? "", 40)}"`;
}

function findInspectionTarget(value: unknown, fmt: TargetFormat): string {
	const rec = toolComponentRecord(value);
	const pattern = fmt.summarizeText(rec.args?.pattern ?? "", 40);
	const path = rec.args?.path ? ` in ${fmt.shortPath(componentCwd(value), rec.args.path)}` : "";
	return `"${pattern}"${path}`;
}

function listInspectionTarget(value: unknown, fmt: TargetFormat): string {
	const rec = toolComponentRecord(value);
	return fmt.shortPath(componentCwd(value), rec.args?.path ?? ".");
}

/** Raw shell command, for the `$ cmd` row under an aggregate header. */
function bashInspectionCommand(value: unknown, fmt: TargetFormat): string {
	const rec = toolComponentRecord(value);
	const command = rec.args?.command ?? rec.args?.cmd ?? "";
	return fmt.summarizeText(typeof command === "string" ? command : String(command), 80);
}

function inspectionTargetText(rec: { toolName?: unknown }, value: unknown, fmt: TargetFormat): string {
	if (rec.toolName === "read") return readInspectionTarget(value, fmt);
	if (rec.toolName === "grep") return grepInspectionTarget(value, fmt);
	if (rec.toolName === "find") return findInspectionTarget(value, fmt);
	if (rec.toolName === "ls") return listInspectionTarget(value, fmt);
	return `$ ${bashInspectionCommand(value, fmt)}`;
}

/**
 * The ⎿ row under an aggregate header is the bare target — a path for file
 * tools, `$ command` for shell. No tool name, no status suffix.
 */
export function summarizeReadOnlyInspectionTool(value: unknown, fmt: TargetFormat): string {
	const rec = toolComponentRecord(value);
	// Paths and patterns are model output just like commands, and this row prints
	// them verbatim: an ESC(0 in a path survives the row's SGR reset and redraws
	// everything below as line art, while visibleWidth measures those bytes as
	// zero and lets the row overflow the terminal.
	return sanitizeToolText(inspectionTargetText(rec, value, fmt));
}
