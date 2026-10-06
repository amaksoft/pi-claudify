import assert from "node:assert/strict";

import { registerOpenAiStylePresenter, summarizeOpenAiToolCall } from "../extensions/tools/openai-tool.ts";
import { bgToolPresenter } from "../extensions/tools/bg-tool-presentation.ts";

registerOpenAiStylePresenter(bgToolPresenter);

import {
	createBashToolPresentation,
	detectDetachedBash,
	type BashToolPresentationRuntime,
} from "../extensions/tools/bash-tool.ts";

const calls: { stopBlink: number; statuses: unknown[] } = { stopBlink: 0, statuses: [] };
const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
const presentation = createBashToolPresentation({
	semanticEnabled: () => false,
	detachedEnabled: () => true,
	detachHint: () => "ctrl+b to background",
	shortPath: (path: string) => path,
	makeText: (_component: unknown, text: string) => text,
	header: (_label: string, summary: string) => summary,
	statusDot: () => "",
	withBranch: (text: string) => text,
	startBlink: () => {},
	stopBlink: () => { calls.stopBlink += 1; },
	setStatus: (_ctx: unknown, status: unknown) => { calls.statuses.push(status); },
	outputMode: () => "summary",
	runningPreview: () => "head",
	collapsedLimit: () => 5,
	collapsedRows: () => 5,
	expandedRows: () => 20,
	revision: () => 0,
	hash: (text: string) => text,
	widthAware: (_last: unknown, _key: string, build: (width: number) => string[]) => build(80),
	renderLines: (text: string) => text.split("\n"),
	visualPreview: (text: string) => text,
	errorText: (_theme: unknown, text: string) => text,
} as unknown as BashToolPresentationRuntime);

const ctx = { isError: false, expanded: false, args: { command: "sleep 60" } };
const render = (result: unknown) =>
	presentation.renderResult(result, { expanded: false, isPartial: false }, theme as never, ctx) as unknown as string;

// 1. detached-background outcome with identity.
let out = render({
	details: { outcome: "detached-background" },
	content: [{ type: "text", text: "Sent to background (Ctrl+B). Still running.\njob_id: a1b2c3\nlog_path: /tmp/x.out" }],
});
assert.ok(out.includes("Running in background"), "detached copy");
assert.ok(out.includes("job a1b2c3"), "job id");
assert.ok(out.includes("/tmp/x.out"), "log path");
assert.ok(!out.includes("Done"), "not settled copy");
assert.deepEqual(calls.statuses.at(-1), "pending", "amber status held");

// 2. timed-out-background outcome.
out = render({
	details: { outcome: "timed-out-background" },
	content: [{ type: "text", text: "Still running after 3s.\njob_id: ff00ff\nlog_path: /tmp/y.out" }],
});
assert.ok(out.includes("Running in background") && out.includes("job ff00ff"));

// 3. Launch result: details undefined, contract text marker.
out = render({
	details: undefined,
	content: [{ type: "text", text: "Started in background tmux window: x @1.\njob_id: 123abc\nlog_path: /tmp/z.out\nRead it." }],
});
assert.ok(out.includes("Running in background") && out.includes("job 123abc"));

// 4. Kill-switch off: falls through to settled rendering.
const off = createBashToolPresentation({
	semanticEnabled: () => false,
	detachedEnabled: () => false,
	shortPath: (path: string) => path,
	makeText: (_c: unknown, text: string) => text,
	header: (_l: string, summary: string) => summary,
	statusDot: () => "",
	withBranch: (text: string) => text,
	startBlink: () => {},
	stopBlink: () => {},
	setStatus: () => {},
	outputMode: () => "summary",
} as unknown as BashToolPresentationRuntime);
out = off.renderResult(
	{
		details: { outcome: "detached-background" },
		content: [{ type: "text", text: "Sent to background.\njob_id: a1b2c3\nlog_path: /tmp/x.out" }],
	},
	{ expanded: false, isPartial: false },
	theme as never,
	ctx,
) as unknown as string;
assert.ok(!out.includes("Running in background"), "kill-switch restores settled rendering");

// 5. No false positives: inline mention without the contract anchor.
assert.equal(
	detectDetachedBash(undefined, "my job_id: nope, still running"),
	undefined,
	"anchor requires line start",
);
assert.deepEqual(detectDetachedBash({ outcome: "detached-background" }, "plain"), {
	outcome: "detached-background",
});
assert.deepEqual(
	detectDetachedBash(undefined, "Started in background.\njob_id: a1b2c3\nlog_path: /tmp/x.out", true),
	{ outcome: undefined, jobId: "a1b2c3", logPath: "/tmp/x.out" },
	"launch text + capable tool detaches",
);
assert.equal(
	detectDetachedBash(undefined, "Started in background.\njob_id: a1b2c3\nlog_path: /tmp/x.out", false),
	undefined,
	"same text from a vanilla tool settles Done (triple-gate)",
);
assert.equal(
	detectDetachedBash(undefined, "vanilla echo\njob_id: a1b2c3\nlog_path: /tmp/x.out"),
	undefined,
	"text pair alone never detaches (default leg off)",
);
assert.equal(
	detectDetachedBash(undefined, "output mentions\njob_id: a1b2c3\nbut no log path"),
	undefined,
	"job_id alone (no log_path) does not detach the row",
);

const plainTheme = { fg: (_name: string, text: string) => text };
const shortPath = (path: string) => path;
const summarize = (text: string) => text;
assert.equal(
	summarizeOpenAiToolCall("tmux", { action: "list" }, plainTheme as never, shortPath, summarize),
	"list",
	"tmux list summarizes to its action",
);
assert.equal(
	summarizeOpenAiToolCall("tmux", { action: "peek", window: "@123" }, plainTheme as never, shortPath, summarize),
	"peek @123",
	"tmux peek names its target",
);
assert.equal(
	summarizeOpenAiToolCall("bg", { action: "kill", window: "a1b2c3" }, plainTheme as never, shortPath, summarize),
	"kill a1b2c3",
	"bg alias summarizes like tmux",
);

const runningTheme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
const runningCtx: any = { isError: false, expanded: false, args: { command: "sleep 60" }, state: {} };
const runningResult = { details: undefined, content: [{ type: "text", text: "" }] };
const runningOptions = { expanded: false, isPartial: true };
const withHint = createBashToolPresentation({
	semanticEnabled: () => false,
	detachedEnabled: () => true,
	detachHint: () => "ctrl+b to background",
	startBlink: () => {},
	runningPreview: () => "head",
	collapsedLimit: () => 10,
	revision: () => 1,
	widthAware: (_c: unknown, _k: string, build: (width: number) => string) => build(80),
	renderLines: (text: string) => text,
	visualPreview: () => "",
	makeText: (_c: unknown, text: string) => text,
	header: (_l: string, summary: string) => summary,
	statusDot: () => "",
	withBranch: (text: string) => text,
	shortPath: (x: string) => x,
} as unknown as BashToolPresentationRuntime);
const runningRow = withHint.renderResult(
	runningResult,
	runningOptions,
	runningTheme as never,
	runningCtx,
) as unknown as string;
assert.ok(
	runningRow.includes("(ctrl+b to background)"),
	"running row carries the detach hint when a background engine is present",
);
const withoutHint = createBashToolPresentation({
	semanticEnabled: () => false,
	detachedEnabled: () => true,
	detachHint: () => null,
	startBlink: () => {},
	runningPreview: () => "head",
	collapsedLimit: () => 10,
	revision: () => 1,
	widthAware: (_c: unknown, _k: string, build: (width: number) => string) => build(80),
	renderLines: (text: string) => text,
	visualPreview: () => "",
	makeText: (_c: unknown, text: string) => text,
	header: (_l: string, summary: string) => summary,
	statusDot: () => "",
	withBranch: (text: string) => text,
	shortPath: (x: string) => x,
} as unknown as BashToolPresentationRuntime);
const plainRow = withoutHint.renderResult(
	runningResult,
	runningOptions,
	runningTheme as never,
	runningCtx,
) as unknown as string;
assert.ok(
	!plainRow.includes("ctrl+b"),
	"running row omits the hint without a background engine",
);

const callTheme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
const callCtx: any = { expanded: false, lastComponent: undefined, cwd: process.cwd() };
const callWithHint = createBashToolPresentation({
	semanticEnabled: () => false,
	detachedEnabled: () => true,
	detachHint: () => "ctrl+b to background",
	syncCallStatus: () => {},
	stableSummary: (_c: any, _k: string, build: () => string) => build(),
	makeText: (_c: unknown, text: string) => text,
	header: (_l: string, summary: string) => summary,
	statusDot: () => "",
	shortPath: (x: string) => x,
} as unknown as BashToolPresentationRuntime);
const callRow = callWithHint.renderCall(
	{ command: "sleep 30" },
	callTheme as never,
	callCtx,
) as unknown as string;
assert.ok(
	callRow.includes("\u00b7 ctrl+b to background"),
	"foreground call rows carry the hotkey hint when a background engine is present",
);
const callWithoutHint = createBashToolPresentation({
	semanticEnabled: () => false,
	detachedEnabled: () => false,
	detachHint: () => null,
	syncCallStatus: () => {},
	stableSummary: (_c: any, _k: string, build: () => string) => build(),
	makeText: (_c: unknown, text: string) => text,
	header: (_l: string, summary: string) => summary,
	statusDot: () => "",
	shortPath: (x: string) => x,
} as unknown as BashToolPresentationRuntime);
const plainCallRow = callWithoutHint.renderCall(
	{ command: "sleep 30" },
	callTheme as never,
	callCtx,
) as unknown as string;
assert.ok(
	!plainCallRow.includes("ctrl+b"),
	"call rows omit the hint without a background engine",
);
const bgCallRow = callWithHint.renderCall(
	{ command: "sleep 30", background: true },
	callTheme as never,
	callCtx,
) as unknown as string;
assert.ok(
	!bgCallRow.includes("ctrl+b"),
	"background launches omit the hint (their result text covers it)",
);

console.log("test-bg-detached: ok");
