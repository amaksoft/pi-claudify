// Candidate classification for the read-only/shell inspection aggregate:
// which tool executions are eligible to join a group, and what kind of
// clause (read/grep/ls/bash/mcp) each one contributes to the header.

import { settingsFeatureEnabled } from "../domain/compatibility.ts";
import { isMcpToolName } from "../host/tool-discovery.ts";
import type { InspectionKind } from "../inspection-summary.ts";
import { isToolExecutionLike, toolComponentRecord } from "../pi-tool-adapter.ts";
import { readSettings } from "../settings.ts";
import { mcpServerForComponent } from "../tools/mcp-tool.ts";

/** Claude parity by default; off keeps shell rows visible without expanding. */
export function shellGroupingEnabled(): boolean {
	return readSettings().values.groupShellCommands !== false;
}

export function readOnlyToolGroupingEnabled(): boolean {
	const settings = readSettings().values;
	// `inspectionGroups: false` disables every aggregate clause (read/grep/find/
	// ls/mcp/bash-shell) uniformly; it is independent of `bashStacking`, which
	// only governs consecutive-bash spacer collapsing.
	if (!settingsFeatureEnabled(settings, "inspectionGroups")) return false;
	return settings.readOnlyToolGrouping !== false;
}

export function readOnlyToolGroupLimit(): number {
	const value = readSettings().values.readOnlyToolGroupLimit;
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.max(1, Math.min(20, Math.floor(value)))
		: 5;
}

/**
 * `isPresentationOverrideSkipped` is injected because index.ts applies the
 * same skip-list check outside inspection grouping (general tool-border
 * framing, tool renderer wiring); this module never re-derives it.
 */
export function isInspectionGroupCandidate(
	value: unknown,
	isPresentationOverrideSkipped: (toolName: unknown) => boolean,
): boolean {
	if (!readOnlyToolGroupingEnabled() || !isToolExecutionLike(value)) return false;
	const rec = toolComponentRecord(value);
	if (isPresentationOverrideSkipped(rec.toolName)) return false;
	if (rec.expanded === true) return false;
	if (rec.toolName === "read" || rec.toolName === "grep" || rec.toolName === "find" || rec.toolName === "ls") return true;
	// Every MCP call aggregates, whatever it does. Claude Code renders a mutating
	// or failing MCP tool exactly like a read-only one — there is no separate row.
	if (isMcpToolName(rec.toolName)) return true;
	// Claude Code aggregates every shell command ("running 1 shell command"), not
	// just the ones that look like file reads — so that is the default. Turning
	// groupShellCommands off keeps shell calls as their own always-visible rows:
	// aggregation is recoverable (ctrl+o shows the command), but ctrl+o opens the
	// whole transcript, so a user who wants to see commands as they happen has no
	// per-row alternative.
	if (rec.toolName === "bash") return shellGroupingEnabled();
	return false;
}

export function isMcpToolExecution(value: unknown): boolean {
	return isToolExecutionLike(value) && isMcpToolName(toolComponentRecord(value).toolName);
}

export function inspectionKind(value: unknown): InspectionKind {
	const rec = toolComponentRecord(value);
	if (rec.toolName === "read") return "read";
	if (rec.toolName === "grep") return "grep";
	// Claude Code folds Glob into the grep clause — a glob for `src/*.ts` renders
	// as "Searching for 1 pattern" with ⎿ "src/*.ts", not a clause of its own.
	if (rec.toolName === "find") return "grep";
	if (rec.toolName === "ls") return "ls";
	if (isMcpToolName(rec.toolName)) return "mcp";
	return "bash";
}

/** Servers addressed by the group's MCP calls, in first-seen order. */
export function mcpServersInGroup(group: unknown[]): string[] {
	return group.filter(isMcpToolExecution).map(mcpServerForComponent);
}
