import assert from "node:assert/strict";

import { registerOpenAiStylePresenter, renderOpenAiToolResult } from "../extensions/tools/openai-tool.ts";
import { firstMeaningfulLine, subagentLaunchInfo, subagentsPresenter } from "../extensions/tools/subagents-presentation.ts";

registerOpenAiStylePresenter(subagentsPresenter);

const theme = { fg: (_key: string, text: string) => text, bold: (text: string) => text } as any;
const runtime = {
	makeText: (_last: unknown, text: string) => text,
	withBranch: (text: string) => text,
	startBlink: () => {},
	stopBlink: () => {},
	setStatus: () => {},
	buildPreview: (lines: string[]) => lines.join("\n"),
	previewRows: () => 5,
	summarize: (text: string, max: number) => text.slice(0, max),
} as any;
const ctx = (over: Record<string, unknown> = {}) => ({
	isError: false,
	expanded: false,
	isPartial: false,
	args: {},
	state: {},
	lastComponent: {},
	...over,
});
const result = (text: string, details: Record<string, unknown> = {}) => ({
	content: [{ type: "text", text }],
	details,
});

// Contract units: launch states read as running; anything else defers.
assert.deepEqual(subagentLaunchInfo({ status: "background", agentId: "abc" }), { id: "abc" });
assert.deepEqual(subagentLaunchInfo({ status: "running" }), { id: undefined });
assert.deepEqual(subagentLaunchInfo({ status: "queued" }), { id: undefined });
assert.equal(subagentLaunchInfo({ status: "completed" }), undefined);
assert.equal(subagentLaunchInfo(undefined), undefined);
assert.equal(firstMeaningfulLine('{\n  "verdict": "real",\n}'), '"verdict": "real",');
assert.equal(firstMeaningfulLine("{\n}\n"), undefined);
assert.equal(firstMeaningfulLine(""), undefined);

// Rendered rows: background names its state, never "Done".
assert.equal(
	renderOpenAiToolResult(runtime, "Agent", result("Agent abc started.", { status: "background", agentId: "abc" }), false, false, theme, ctx()),
	"Running in background (ID: abc)",
);
assert.equal(
	renderOpenAiToolResult(runtime, "Agent", result("x", { status: "queued" }), false, false, theme, ctx()),
	"Running in background",
);

// Finished runs preview their result text.
assert.equal(
	renderOpenAiToolResult(runtime, "Agent", result('{\n  "verdict": "real"\n}', { status: "completed" }), false, false, theme, ctx()),
	'"verdict": "real"',
);

// Empty results fall through to the generic "Done".
assert.equal(
	renderOpenAiToolResult(runtime, "Agent", result("", { status: "completed" }), false, false, theme, ctx()),
	"Done",
);

// Partial shows live activity when the caller sends it.
assert.equal(
	renderOpenAiToolResult(runtime, "Agent", result("", { activity: "bash for 3m" }), false, true, theme, ctx()),
	"bash for 3m",
);
assert.equal(
	renderOpenAiToolResult(runtime, "Agent", result(""), false, true, theme, ctx()),
	"Initializing…",
);

// Non-Agent tools never route here.
assert.equal(
	renderOpenAiToolResult(runtime, "Bash", result("hi", { status: "background" }), false, false, theme, ctx()),
	"1 line returned",
);

// --- presenter chain: tracks register, never edit openai-tool.ts ----------------
import { bgToolPresenter } from "../extensions/tools/bg-tool-presentation.ts";
import { openAiStylePresenters, registerOpenAiStylePresenter, summarizeOpenAiToolCall } from "../extensions/tools/openai-tool.ts";

assert.ok(openAiStylePresenters().some((entry) => entry.id === "subagents"), "subagents presenter is registered");
assert.equal(
	summarizeOpenAiToolCall("tmux", { action: "list" }, theme, (path: string) => path, (text: string) => text),
	"Tmux",
	"unregistered families fall back to humanized labels, never to another track",
);
registerOpenAiStylePresenter(bgToolPresenter);
assert.equal(
	summarizeOpenAiToolCall("tmux", { action: "list" }, theme, (path: string) => path, (text: string) => text),
	"list",
	"registering the bg presenter claims tmux summaries without touching the switch",
);
{
	const before = openAiStylePresenters().length;
	const probe = { id: "probe-track", summarizeCall: () => "probe" };
	registerOpenAiStylePresenter(probe);
	registerOpenAiStylePresenter({ ...probe });
	assert.equal(openAiStylePresenters().length, before + 1, "re-registration replaces by id instead of duplicating");
}

console.log("agent presentation ok");
