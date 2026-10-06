// Candidate classification for the read-only/shell inspection aggregate:
// which tool executions are eligible to join a group, and what kind of
// clause (read/grep/ls/bash/mcp) each one contributes to the header.

import { settingsFeatureEnabled } from "../domain/compatibility.ts";
import { sanitizeToolText } from "../terminal-sanitize.ts";
import { classifyBashCommandForDisplay } from "../domain/bash-display.ts";
import { isMcpToolName } from "../host/tool-discovery.ts";
import type { InspectionKind } from "../inspection-summary.ts";
import { readSettings } from "../settings.ts";
import { snapshotToolExecution } from "./tool-record.ts";
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
	if (!readOnlyToolGroupingEnabled()) return false;
	const record = snapshotToolExecution(value);
	if (!record || isPresentationOverrideSkipped(record.name) || record.expanded) return false;
	if (record.name === "read" || record.name === "grep" || record.name === "find" || record.name === "ls") return true;
	// Every MCP call aggregates, whatever it does. Claude Code renders a mutating
	// or failing MCP tool exactly like a read-only one — there is no separate row.
	if (isMcpToolName(record.name)) return true;
	// Claude Code aggregates every shell command ("running 1 shell command"), not
	// just the ones that look like file reads — so that is the default. Turning
	// groupShellCommands off keeps shell calls as their own always-visible rows:
	// aggregation is recoverable (ctrl+o shows the command), but ctrl+o opens the
	// whole transcript, so a user who wants to see commands as they happen has no
	// per-row alternative.
	if (record.name === "bash") return shellGroupingEnabled();
	return false;
}

export function isMcpToolExecution(value: unknown): boolean {
	const record = snapshotToolExecution(value);
	return !!record && isMcpToolName(record.name);
}

export function inspectionKind(value: unknown): InspectionKind {
	const record = snapshotToolExecution(value);
	if (!record) return "bash";
	if (record.name === "read") return "read";
	if (record.name === "grep") return "grep";
	// Claude Code folds Glob into the grep clause — a glob for `src/*.ts` renders
	// as "Searching for 1 pattern" with ⎿ "src/*.ts", not a clause of its own.
	if (record.name === "find") return "grep";
	if (record.name === "ls") return "ls";
	if (isMcpToolName(record.name)) return "mcp";
	return "bash";
}

/** Servers addressed by the group's MCP calls, in first-seen order. */
export function mcpServersInGroup(group: unknown[]): string[] {
	return group.filter(isMcpToolExecution).map(mcpServerForComponent);
}

/**
 * Human labels for the group's bash calls, in first-seen order. Reads the
 * bg-shell `displayName` result-details contract first (given name > short
 * command > derived label), falling back to args for results without
 * details (e.g. background launches whose details are undefined).
 */
export function bashLabelsInGroup(group: unknown[]): string[] {
	const labels: string[] = [];
	for (const value of group) {
		const record = snapshotToolExecution(value);
		if (!record || record.name !== "bash") continue;
		// Headers never carry raw model text: sanitize every label the same
		// way per-row rendering does (bidi overrides, zero-width splits).
		const clean = (text: string): string => sanitizeToolText(text).trim().slice(0, 60);
		const args = record.args as Record<string, unknown>;
		// Background launches stay marked in collapsed summaries: the aggregate
		// otherwise reads identically to foreground runs.
		const launchedBackground = args["background"] === true || args["run_in_background"] === true;
		const mark = (label: string): string => (launchedBackground ? `${label} · background` : label);
		const details = (record.result as { details?: { displayName?: unknown } } | null)?.details;
		const fromDetails = typeof details?.displayName === "string" ? clean(details.displayName) : "";
		if (fromDetails.length > 0) {
			labels.push(mark(fromDetails));
			continue;
		}
		const given = typeof args["name"] === "string" ? clean(args["name"] as string) : "";
		if (given.length > 0) {
			labels.push(mark(given));
			continue;
		}
		const command = typeof args["command"] === "string" ? (args["command"] as string) : "";
		// Read-like commands keep semantic display (friendly target, no raw
		// command leak): skip derived labels so the count phrasing survives.
		// Explicit names (details.displayName, args.name) always win.
		if (classifyBashCommandForDisplay(command)?.kind === "read") continue;
		const firstLine = clean(command.split("\n")[0]);
		labels.push(mark(firstLine.length > 0 ? firstLine : "shell command"));
	}
	return labels;
}
