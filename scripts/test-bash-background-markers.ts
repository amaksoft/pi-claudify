import assert from "node:assert/strict";

import {
	createBashToolPresentation,
	type BashToolPresentationRuntime,
} from "../extensions/tools/bash-tool.ts";
import { bashLabelsInGroup } from "../extensions/transcript/inspection-candidates.ts";
import { describeInspectionsDone } from "../extensions/inspection-summary.ts";

// Spoof: isToolExecutionLike keys off constructor.name + the render surface.
class ToolExecutionComponent {
	toolName = "bash";
	toolCallId = "x1";
	args: Record<string, unknown> = {};
	result: unknown = null;
	isPartial = false;
	expanded = false;
	cwd = process.cwd();
	render() {}
	updateResult() {}
	setExpanded() {}
	updateDisplay() {}
}

const row = (args: Record<string, unknown>): unknown => {
	const component = new ToolExecutionComponent();
	component.args = args;
	return component;
};

// --- Aggregate labels: background launches stay marked --------------------

assert.deepEqual(
	bashLabelsInGroup([row({ command: "sleep 90", background: true })]),
	["sleep 90 · background"],
	"background:true labels carry the marker",
);
assert.deepEqual(
	bashLabelsInGroup([row({ command: "sleep 90", run_in_background: true })]),
	["sleep 90 · background"],
	"run_in_background labels carry the marker",
);
assert.deepEqual(
	bashLabelsInGroup([row({ command: "sleep 90" })]),
	["sleep 90"],
	"foreground labels stay unmarked",
);
assert.deepEqual(
	bashLabelsInGroup([row({ command: "sleep 90", name: "nightly", background: true })]),
	["nightly · background"],
	"given names carry the marker",
);

// Markers flow into the settled aggregate header.
assert.equal(
	describeInspectionsDone(["bash", "bash"], [], ["rewrite house style amend · background", "push house style update"]),
	"Ran 2 shell commands: rewrite house style amend · background, push house style update",
	"aggregate keeps per-item background markers",
);

// --- Call rows: background launches say so without expanding ---------------

const theme = { fg: (_c: string, text: string) => text, bold: (text: string) => text } as any;

const callRuntime = (overrides: Record<string, unknown> = {}) => ({
	makeText: (_last: unknown, text: string) => ({ text }),
	stableSummary: (_ctx: unknown, _key: string, build: () => string) => build(),
	syncCallStatus: () => {},
	semanticEnabled: () => false,
	shortPath: (path: string) => path,
	cwd: process.cwd(),
	header: (tool: string, summary: string) => `⏺ ${tool}(${summary})`,
	statusDot: () => "⏺ ",
	detachedEnabled: () => false,
	detachHint: () => null,
	...overrides,
}) as unknown as BashToolPresentationRuntime;

const presentation = createBashToolPresentation(callRuntime() as unknown as BashToolPresentationRuntime);

const callText = (args: Record<string, unknown>): string => {
	const ctx: any = { expanded: false, cwd: process.cwd(), state: {}, executionStarted: true, isPartial: false, args };
	const rendered = (presentation.renderCall as any)(args, theme, ctx);
	return String(rendered?.text ?? rendered);
};

assert.ok(
	callText({ command: "sleep 90", background: true }).includes("· background"),
	"background:true call rows carry the marker",
);
assert.ok(
	callText({ command: "sleep 90", run_in_background: true }).includes("· background"),
	"run_in_background call rows carry the marker",
);
assert.ok(
	!callText({ command: "sleep 90" }).includes("background"),
	"foreground call rows stay unmarked (no detach engine here)",
);

console.log("bash background marker tests passed");
