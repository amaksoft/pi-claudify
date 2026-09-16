import assert from "node:assert/strict";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension, {
	ensureInspectionGroups,
	InspectionGroupComponent,
	isSettledInspectionTool,
	sanitizeToolText,
} from "../extensions/index.ts";
import { clearSettingsCache, writeSettingsKey } from "../extensions/settings.ts";
import { useSandboxHome } from "./sandbox-home.ts";

// Assert default rendering, not the settings of whoever runs the suite.
useSandboxHome("cc-groups");

// pi assigns `.result` when execution STARTS and streams into it with
// isPartial === true; completion flips isPartial to false, and restored history
// rows arrive already false. So "has a result" is not "finished".
// Capture: docs/plans/2026-09-07-inspection-group-interaction.md

class FakePi {
	tools = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void {
		this.tools.set(definition.name, definition);
	}
	registerCommand(): void {}
	on(name: string, handler: (...args: any[]) => any): void {
		const handlers = this.events.get(name) ?? [];
		handlers.push(handler);
		this.events.set(name, handlers);
	}
	getThinkingLevel(): string {
		return "off";
	}
	getAllTools(): any[] {
		return [...this.tools.values()];
	}
}

type Phase = "pending" | "streaming" | "settled";

function tool(pi: FakePi, name: string, id: string, args: any, text: string, phase: Phase): ToolExecutionComponent {
	const definition = pi.tools.get(name);
	assert.ok(definition, `${name} tool registered`);
	const component = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		definition,
		{ requestRender() {}, previousLines: [] } as any,
		process.cwd(),
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	if (phase !== "pending") {
		component.updateResult(
			{ content: [{ type: "text", text }], details: {}, isError: false } as any,
			phase === "streaming",
		);
	}
	return component;
}

function render(children: ToolExecutionComponent[], width = 120): string {
	const box = new Container();
	for (const child of children) box.addChild(child);
	return box
		.render(width)
		.map((line) =>
			line
				.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
				.replace(/\x1b\[[0-9;]*m/g, "")
				.replace(/\s+$/, ""),
		)
		.join("\n");
}

initTheme("dark", false);
const pi = new FakePi();
extension(pi as any);

// --- The settle predicate across pi's real lifecycle. ------------------------

const pending = tool(pi, "read", "s1", { path: "src/alpha.ts" }, "", "pending");
assert.equal(isSettledInspectionTool(pending), false, "no result yet is not settled");

const streaming = tool(pi, "read", "s2", { path: "src/beta.ts" }, "partial output", "streaming");
assert.equal(isSettledInspectionTool(streaming), false, "result present but isPartial: streaming, not settled");

const finished = tool(pi, "read", "s3", { path: "src/gamma.ts" }, "done", "settled");
assert.equal(isSettledInspectionTool(finished), true, "non-partial result is settled");

// A restored/history row carries no isPartial flag at all; absent must not read
// as "still streaming", or replayed transcripts would never collapse.
const restored: any = tool(pi, "read", "s4", { path: "src/delta.ts" }, "done", "settled");
delete restored.isPartial;
assert.equal(isSettledInspectionTool(restored), true, "absent isPartial reads as settled");

// --- The aggregate must survive the whole run, not one frame. ----------------

// Streaming members keep the gerund header up. Before the predicate fix this
// collapsed to the past-tense summary as soon as execution started, because
// `.result` was already assigned.
const midRun = render([
	tool(pi, "read", "m1", { path: "src/alpha.ts" }, "chunk", "streaming"),
	tool(pi, "read", "m2", { path: "src/beta.ts" }, "", "pending"),
]);
assert.match(midRun, /^⏺ Reading 2 files…$/m);
assert.doesNotMatch(midRun, /^ {2}Read 2 files/m);

// One member still streaming is enough to hold the aggregate open.
const oneStillStreaming = render([
	tool(pi, "read", "m3", { path: "src/alpha.ts" }, "done", "settled"),
	tool(pi, "read", "m4", { path: "src/beta.ts" }, "chunk", "streaming"),
]);
assert.match(oneStillStreaming, /^⏺ Reading 2 files…$/m);

// All settled: the past-tense summary.
const allSettled = render([
	tool(pi, "read", "m5", { path: "src/alpha.ts" }, "done", "settled"),
	tool(pi, "read", "m6", { path: "src/beta.ts" }, "done", "settled"),
]);
assert.match(allSettled, /^ {2}Read 2 files$/m);
assert.doesNotMatch(allSettled, /Reading 2 files…/);

// --- Target rows print model output verbatim, so they must be sanitized. ----

// A path or pattern reaches the ⎿ row unquoted. An ESC(0 charset shift survives
// the row's SGR reset and redraws every row below as line-drawing glyphs, and
// visibleWidth counts those bytes as zero — so the row also overflows the
// terminal, which pi treats as a hard error.
const HOSTILE_PATH = "src/\u001b(0evil\u001b[31m/\u0000x.ts";

function rawRender(children: ToolExecutionComponent[], width: number): string[] {
	const box = new Container();
	for (const child of children) box.addChild(child);
	return box.render(width);
}

function widthOf(line: string): number {
	return line
		.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
		.replace(/\x1b\[[0-9;:?]*[ -\/]*[@-~]/g, "")
		.replace(/\x1b[@-Z\\-_()#%*+]?/g, "").length;
}

const hostileRows = rawRender(
	[
		tool(pi, "read", "h1", { path: HOSTILE_PATH }, "", "pending"),
		tool(pi, "read", "h2", { path: "src/plain.ts" }, "", "pending"),
	],
	60,
);
const hostileText = hostileRows.join("\n");
assert.doesNotMatch(hostileText, /\u001b\(0/, "charset shift never reaches a target row");
assert.doesNotMatch(hostileText, /\u0000/, "NUL never reaches a target row");
for (const line of hostileRows) {
	assert.ok(widthOf(line) <= 60, `target row fits the terminal: ${JSON.stringify(line)}`);
}
// The readable part of the path survives — sanitizing is not blanking.
assert.match(hostileText.replace(/\x1b\[[0-9;]*m/g, ""), /src\/evil\/x\.ts/);

// An OSC 8 envelope in a grep pattern must not smuggle a link into the row.
const hostilePattern = rawRender(
	[
		tool(pi, "grep", "h3", { pattern: "\u001b]8;;http://evil.invalid\u0007needle", path: "src" }, "", "pending"),
		tool(pi, "read", "h4", { path: "src/plain.ts" }, "", "pending"),
	],
	60,
).join("\n");
assert.doesNotMatch(hostilePattern, /evil\.invalid/, "OSC 8 target stripped from a pattern");
assert.match(hostilePattern, /needle/, "the pattern text itself survives");

// Wide characters were already handled (padToWidth measures visible width);
// this pins it so a future truncation change cannot regress it.
const cjkRows = rawRender(
	[
		tool(pi, "read", "h5", { path: "src/日本語ディレクトリ/コンポーネント実装.ts" }, "", "pending"),
		tool(pi, "read", "h6", { path: "src/plain.ts" }, "", "pending"),
	],
	40,
);
for (const line of cjkRows) {
	const visible = [...line.replace(/\x1b\[[0-9;]*m/g, "")].reduce((sum, ch) => {
		const cp = ch.codePointAt(0) ?? 0;
		const wide =
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xff00 && cp <= 0xff60);
		return sum + (wide ? 2 : 1);
	}, 0);
	assert.ok(visible <= 40, `CJK target row fits the terminal: ${JSON.stringify(line)}`);
}

// --- Row forging, tail erasure, and display spoofing. ------------------------

// \n and \t sit OUTSIDE the C0 range that the escape strip covers, and a target
// row prints them verbatim — so a path can forge an entire fake tool row.
const FORGED = "src/a.ts\n⏺ Bash(echo totally safe)\n  ⎿ ok";
const forgedOut = rawRender(
	[
		tool(pi, "read", "f1", { path: FORGED }, "", "pending"),
		tool(pi, "read", "f2", { path: "src/plain.ts" }, "", "pending"),
	],
	120,
).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
// Exactly one ⎿ row per tool: the forged rows must have folded into their target.
assert.equal(forgedOut.filter((line) => line.includes("⎿")).length, 2, "a path cannot forge extra target rows");
// The forged text is preserved (deleting it would hide what the model asked
// for) but folded into its own target row, where it cannot pass for a real
// header: nothing but a genuine row may begin a line with the tool glyph.
assert.equal(
	forgedOut.filter((line) => /^\s*⏺ Bash\(/.test(line)).length,
	0,
	"a path cannot forge a tool header at the start of a row",
);
assert.match(forgedOut.join("\n"), /src\/a\.ts .*echo totally safe/, "the text survives, folded onto one row");

// An unterminated envelope (ESC X / ESC P / ESC _ / ESC ^) must not swallow the
// rest of the string: two bytes would erase a destructive tail and leave a row
// that reads as complete.
const TAIL = "echo hello \u001bX && rm -rf ~/important";
const tailOut = rawRender([tool(pi, "bash", "f3", { command: TAIL }, "", "pending"), tool(pi, "read", "f4", { path: "x.ts" }, "", "pending")], 120)
	.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""))
	.join("\n");
assert.match(tailOut, /rm -rf ~\/important/, "an unterminated envelope must not erase the command tail");
assert.match(tailOut, /\ufffd/, "removed bytes leave a visible marker");

// Bidi overrides reorder a row without changing its bytes; zero-width
// characters split a command invisibly. Neither belongs in an audit row.
const SPOOF = "echo hi \u202e# )dneirf( ohce ;/ fr- mr";
const spoofOut = rawRender([tool(pi, "bash", "f5", { command: SPOOF }, "", "pending"), tool(pi, "read", "f6", { path: "x.ts" }, "", "pending")], 120).join("\n");
assert.doesNotMatch(spoofOut, /\u202e/, "bidi override stripped");
const ZWSP = "r\u200bm -r\u200bf /";
const zwspOut = rawRender([tool(pi, "bash", "f7", { command: ZWSP }, "", "pending"), tool(pi, "read", "f8", { path: "x.ts" }, "", "pending")], 120).join("\n");
assert.doesNotMatch(zwspOut, /\u200b/, "zero-width space stripped");
assert.match(zwspOut.replace(/\x1b\[[0-9;]*m/g, ""), /rm -rf \//, "the real command is what the row shows");

// Sanitizing is idempotent: a second pass must not alter an already-clean row.
assert.equal(sanitizeToolText(sanitizeToolText(FORGED)), sanitizeToolText(FORGED));

// The clean-text fast path must not skip anything the rules would rewrite.
// WRAP_MARK (U+E000) is Private Use, not a control character, so it has to be
// named in the pre-check explicitly or a wrap marker rides straight through.
assert.equal(sanitizeToolText("a\ue000b"), "ab", "the wrap marker is stripped despite the fast path");
assert.equal(sanitizeToolText("src/plain.ts"), "src/plain.ts", "clean text is returned unchanged");

// --- groupShellCommands: parity by default, shell rows visible when off. -----

// Default (unset) must match Claude Code's captured behaviour: shell aggregates.
const shellDefault = render([
	tool(pi, "read", "g1", { path: "src/alpha.ts" }, "a", "settled"),
	tool(pi, "bash", "g2", { command: "echo hi && ls -1" }, "hi", "settled"),
]);
assert.match(shellDefault, /^ {2}Read 1 file, ran 1 shell command$/m);

// Off: the shell call keeps its own row and the reads still aggregate, so a
// command is visible as it happens without needing to expand the transcript.
//
// HOME is already sandboxed for this suite, so writing here is safe: it
// touches the sandbox file, never the settings of whoever runs the tests.
try {
	assert.equal(writeSettingsKey("groupShellCommands", false).success, true, "sandboxed settings write succeeds");
	clearSettingsCache();
	const shellOff = render([
		tool(pi, "read", "g3", { path: "src/alpha.ts" }, "a", "settled"),
		tool(pi, "read", "g4", { path: "src/beta.ts" }, "b", "settled"),
		tool(pi, "bash", "g5", { command: "echo hi && ls -1" }, "hi", "settled"),
	]);
	assert.match(shellOff, /^ {2}Read 2 files$/m, "reads still aggregate");
	assert.doesNotMatch(shellOff, /ran 1 shell command/, "the shell call is not folded in");
	assert.match(shellOff, /⏺ Bash\(echo hi && ls -1\)/, "the command is visible without expanding");
} finally {
	writeSettingsKey("groupShellCommands", true);
	clearSettingsCache();
}

// --- Real group components: click one group, ctrl+o can toggle them all. -----

function plainRows(box: Container, width = 120): string[] {
	return box.render(width).map((line) =>
		line
			.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
			.replace(/\x1b\[[0-9;]*m/g, "")
			.replace(/\s+$/, ""),
	);
}

const clickBox = new Container();
const clickOne = tool(pi, "read", "click-1", { path: "src/one.ts" }, "one", "settled");
const clickTwo = tool(pi, "read", "click-2", { path: "src/two.ts" }, "two", "settled");
clickBox.addChild(clickOne);
clickBox.addChild(clickTwo);
const childrenIdentity = (clickBox as any).children;
const collapsedRows = plainRows(clickBox);
assert.match(collapsedRows.join("\n"), /^ {2}Read 2 files$/m);
assert.equal((clickBox as any).children, childrenIdentity, "reconciliation preserves the host's children-array identity");
assert.equal((clickBox as any).children.length, 1, "one run becomes one component");
const clickable = (clickBox as any).children[0];
assert.ok(clickable instanceof InspectionGroupComponent, "the summary has a real transcript component");
assert.deepEqual((clickable as any).mouseLayout, { width: 120, children: [] }, "wrapper-painted rows expose no invented child hit regions");

const summaryY = collapsedRows.findIndex((line) => line.includes("Read 2 files"));
assert.ok(summaryY >= 0, "summary row found");
assert.deepEqual(
	clickable.handleMouse({ type: "click", button: "left", y: summaryY, width: 120 }),
	{ handled: true },
	"primary click claims the collapsed summary",
);
assert.equal((clickOne as any).expanded, true, "click uses the member's real setExpanded path");
assert.equal((clickTwo as any).expanded, true);
const openedRows = plainRows(clickBox).join("\n");
assert.match(openedRows, /⏺ Read\(src\/one\.ts\)/, "clicked group dissolves into native rows");
assert.match(openedRows, /⏺ Read\(src\/two\.ts\)/);
assert.equal((clickBox as any).children[0], clickOne, "native members return to the parent in original order");
assert.equal((clickBox as any).children[1], clickTwo);

// Collapse through the same methods pi's global ctrl+o sweep calls. The next
// reconciliation re-arms one clickable summary.
clickOne.setExpanded(false);
clickTwo.setExpanded(false);
assert.match(plainRows(clickBox).join("\n"), /^ {2}Read 2 files$/m);
const keyboardGroup = (clickBox as any).children[0];
assert.ok(keyboardGroup instanceof InspectionGroupComponent);
keyboardGroup.setExpanded(true);
assert.match(plainRows(clickBox).join("\n"), /⏺ Read\(src\/one\.ts\)/, "setExpanded gives ctrl+o the same result as click");

// Claude Code captures singleton aggregates. They must be just as clickable as
// multi-tool groups, not silently fall back to a native row at count one.
const singletonBox = new Container();
const singleton = tool(pi, "read", "click-single", { path: "src/single.ts" }, "one", "settled");
singletonBox.addChild(singleton);
const singletonRows = plainRows(singletonBox);
assert.match(singletonRows.join("\n"), /^ {2}Read 1 file$/m);
const singletonGroup = (singletonBox as any).children[0];
assert.ok(singletonGroup instanceof InspectionGroupComponent);
const singletonY = singletonRows.findIndex((line) => line.includes("Read 1 file"));
assert.deepEqual(singletonGroup.handleMouse({ type: "click", button: 0, y: singletonY, width: 120 }), { handled: true });
assert.match(plainRows(singletonBox).join("\n"), /⏺ Read\(src\/single\.ts\)/);

// Active groups are interactive too: clicking the `$ command` target while it
// streams must dissolve into the native running row. A zero-length active span
// made these clicks appear dead even though ctrl+o worked.
const activeBox = new Container();
const activeCommand = "for i in 1 2 3; do echo tick$i; sleep 1; done";
const activeMember = tool(pi, "bash", "click-running", { command: activeCommand }, "tick1\ntick2", "streaming");
activeBox.addChild(activeMember);
const activeRows = plainRows(activeBox);
assert.match(activeRows.join("\n"), /^⏺ Running 1 shell command…$/m);
const activeGroup = (activeBox as any).children[0] as InspectionGroupComponent;
assert.ok(activeGroup instanceof InspectionGroupComponent);
const targetY = activeRows.findIndex((line) => line.includes(`$ ${activeCommand}`));
assert.ok(targetY >= 0, "running command target found");
assert.deepEqual(
	activeGroup.handleMouse({ type: "click", button: "left", y: targetY, width: 119 }),
	{ handled: true },
	"running target click claims even when terminal and content widths differ",
);
assert.equal((activeMember as any).expanded, true);
const activeOpened = plainRows(activeBox).join("\n");
assert.match(activeOpened, /⏺ Bash\(for i in 1 2 3/, "running group dissolves to its native Bash row");
assert.match(activeOpened, /Running\.\.\./, "native running row remains live after click");

// Ignore wrong buttons and spacer rows. Width is deliberately NOT checked: the
// host dispatcher localizes y but passes width through unchanged, so comparing
// event.width against the content render width rejects legitimate clicks
// (terminal width vs padded content width) and silently disables expanding
// while collapsing keeps working natively. Fall-through keeps selection and
// scrolling alive.
const ignoreBox = new Container();
const ignoreMember = tool(pi, "read", "click-ignore", { path: "src/ignore.ts" }, "one", "settled");
ignoreBox.addChild(ignoreMember);
const ignoreRows = plainRows(ignoreBox);
const ignoreGroup = (ignoreBox as any).children[0] as InspectionGroupComponent;
const ignoreY = ignoreRows.findIndex((line) => line.includes("Read 1 file"));
assert.equal(ignoreGroup.handleMouse({ type: "click", button: "right", y: ignoreY, width: 120 }), undefined);
// A width the content never rendered at must still claim: the dispatcher
// localizes y but passes width through, so content-vs-terminal width always
// differs in production. This is the regression test for dead expand-clicks.
assert.deepEqual(ignoreGroup.handleMouse({ type: "click", button: "left", y: ignoreY, width: 119 }), { handled: true });
assert.equal((ignoreMember as any).expanded, true);

console.log("inspection group tests passed");
