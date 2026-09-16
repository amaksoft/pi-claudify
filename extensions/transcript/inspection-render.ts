// Active/settled rendering policy for the inspection aggregate: the gerund
// header + `⎿` target rows while a run is live, and the single dim past-tense
// summary once every member has settled.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { InspectionGroupFrame } from "../inspection-group.ts";
import { describeInspectionsActive, describeInspectionsDone } from "../inspection-summary.ts";
import { WRAP_MARK } from "../terminal-sanitize.ts";
import { inspectionKind, isMcpToolExecution, mcpServersInGroup, readOnlyToolGroupLimit } from "./inspection-candidates.ts";
import { summarizeReadOnlyInspectionTool } from "./inspection-targets.ts";
import type { InspectionGroupRuntime } from "./runtime.ts";

const RESET = "\x1b[0m";
const TRANSPARENT_RESET = `${RESET}\x1b[49m`;

const CLAUDE_TOOL_GLYPH = "⏺";
const CLAUDE_RESULT_PREFIX = "  ⎿  ";
// The collapsed read-only summary hangs at the bullet's indent, not the ⎿ gutter's.
const CLAUDE_COLLAPSED_INDENT = "  ";

export function fitInspectionLine(line: string, width: number, runtime: InspectionGroupRuntime): string[] {
	if (width <= 0) return [];
	return runtime.wrapMarkedLine(line.replace(/\t/g, "   "), width)
		.map((part) => runtime.padToWidth(visibleWidth(part) > width ? truncateToWidth(part, width, "") : part, width));
}

/** Frame aggregate content and report the exact clickable row range. */
export function frameInspectionLines(rendered: string[], width: number, runtime: InspectionGroupRuntime): InspectionGroupFrame {
	runtime.syncToolBackgroundMode();
	const mode = runtime.toolBackgroundMode();
	let start = 0;
	let lines: string[];
	if (mode === "outlines") {
		lines = [" ".repeat(width), runtime.borderLine(width), ...rendered, runtime.borderLine(width)];
		start = 2;
	} else if (mode === "transparent") {
		lines = [" ".repeat(width), ...rendered];
		start = 1;
	} else {
		lines = rendered;
	}
	return { lines, interactiveRows: { start, end: start + rendered.length } };
}

/** Claude's settled group is one dim, indented, bullet-less summary. */
export function renderSettledInspectionGroup(group: unknown[], width: number, runtime: InspectionGroupRuntime): InspectionGroupFrame {
	const summary = `${CLAUDE_COLLAPSED_INDENT}${WRAP_MARK}${runtime.workedLineForeground()}${describeInspectionsDone(
		group.map(inspectionKind),
		mcpServersInGroup(group),
	)}${RESET}`;
	return frameInspectionLines(fitInspectionLine(summary, width, runtime), width, runtime);
}

export function renderActiveInspectionGroup(group: unknown[], width: number, runtime: InspectionGroupRuntime): InspectionGroupFrame {
	// MCP calls contribute a clause to the header but never a ⎿ row of their own.
	const targets = group.filter((entry) => !isMcpToolExecution(entry));
	const shown = targets.slice(0, readOnlyToolGroupLimit());
	const remaining = targets.length - shown.length;
	const core: string[] = [`${WRAP_MARK}${CLAUDE_TOOL_GLYPH} ${describeInspectionsActive(
		group.map(inspectionKind),
		mcpServersInGroup(group),
	)}`];
	for (const entry of shown) {
		core.push(`${runtime.toolRule()}${CLAUDE_RESULT_PREFIX}${TRANSPARENT_RESET}${WRAP_MARK}${summarizeReadOnlyInspectionTool(entry, runtime)}`);
	}
	if (remaining > 0) {
		core.push(`${runtime.toolRule()}${CLAUDE_RESULT_PREFIX}${TRANSPARENT_RESET}${WRAP_MARK}… +${remaining} more`);
	}
	return frameInspectionLines(core.flatMap((line) => fitInspectionLine(line, width, runtime)), width, runtime);
}
