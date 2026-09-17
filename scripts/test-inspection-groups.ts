import assert from "node:assert/strict";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension, {
	ensureInspectionGroups,
	InspectionGroupComponent,
	isSettledInspectionTool,
	sanitizeToolText,
} from "../extensions/index.ts";
import {
	beginPointerExpansionEpoch,
	clearPointerExpandedMembers,
	handlePointerExpansionInput,
	markPointerExpandedMembers,
	releasePointerExpansionOwner,
} from "../extensions/expansion-coordinator.ts";
import {
	reconcileInspectionGroups,
	type InspectionGroupPolicy,
	type InspectionGroupReconciliationMetrics,
} from "../extensions/inspection-group.ts";
import { isToolExecutionLike } from "../extensions/pi-tool-adapter.ts";
import { clearSettingsCache, writeSettingsKey } from "../extensions/settings.ts";
import { sanitizeToolContent } from "../extensions/terminal-sanitize.ts";
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

const HostContainer = Object.getPrototypeOf(ToolExecutionComponent.prototype).constructor as new () => Container;
if (HostContainer.prototype !== Container.prototype) {
	const packedTopologyBox = new HostContainer();
	packedTopologyBox.addChild(tool(pi, "read", "packed-read-1", { path: "one.ts" }, "one", "settled"));
	packedTopologyBox.addChild(tool(pi, "read", "packed-read-2", { path: "two.ts" }, "two", "settled"));
	const packedRows = packedTopologyBox.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");
	assert.match(packedRows, /Read 2 files/, "host-owned Container prototype receives automatic grouping under duplicate peer topology");
}

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
assert.equal(sanitizeToolContent("const family = '👨‍👩‍👧‍👦';"), "const family = '👨‍👩‍👧‍👦';", "file content preserves emoji ZWJ graphemes");
for (const emoji of ["👩🏽‍🚀", "❤️‍🔥", "🏳️‍🌈"]) {
	assert.equal(sanitizeToolContent(emoji), emoji, `complete grapheme survives sanitizing: ${emoji}`);
}
assert.equal(sanitizeToolContent("a\u200db"), "ab", "standalone ZWJ spoofing remains stripped");
assert.equal(sanitizeToolContent("a\u061cb\u2060c"), "abc", "Arabic letter mark and word joiner cannot alter displayed audit text");
assert.equal(sanitizeToolContent("a\uE000b"), "a\\u{E000}b", "literal formatter sentinel is represented distinctly instead of deleted or interpreted");
assert.equal(sanitizeToolContent("\tindented\r\nnext"), "\tindented\nnext", "content preserves tabs and normalizes CRLF without synthetic spaces");
assert.equal(sanitizeToolContent("standalone\rreturn"), "standalone\\rreturn", "standalone CR is visible rather than a forged row or trailing space");
assert.equal(sanitizeToolContent("👩🏽‍x"), "👩🏽x", "a joiner outside a valid pictographic grapheme is stripped");
assert.equal(sanitizeToolContent("x\u{F0000}y"), "x\u{F0000}y", "an input matching the first internal placeholder cannot be rewritten as ZWJ");
assert.doesNotMatch(sanitizeToolContent("x\x1b(0y"), /\x1b\(0/, "content sanitizer still removes terminal charset shifts");
const repeatedUnterminated = "\x1bP".repeat(40_000);
assert.equal(sanitizeToolText(repeatedUnterminated), "�".repeat(40_000), "unterminated envelope scanner handles each introducer once without swallowing payload");

// --- groupShellCommands: parity by default, shell rows visible when off. -----

// Default (unset) must match Claude Code's captured behaviour: shell aggregates.
const shellDefault = render([
	tool(pi, "read", "g1", { path: "src/alpha.ts" }, "a", "settled"),
	tool(pi, "bash", "g2", { command: "echo hi && ls -1" }, "hi", "settled"),
]);
assert.match(shellDefault, /^ {2}Read 1 file, ran 1 shell command$/m);

// Three-or-more shell groups must survive repeated global and pointer cycles.
// A local click does not update Pi's global expansion boolean; the coordinator
// consumes exactly the next Ctrl+O so visibly-open commands collapse in one key.
function settledShell(id: string, index: number) {
	return tool(pi, "bash", id, { command: `printf shell-${index}` }, `shell-${index}`, "settled");
}

for (const count of [3, 4, 5]) {
	clearPointerExpandedMembers();
	const shellBox = new Container();
	const members = Array.from({ length: count }, (_, index) => settledShell(`cycle-${count}-${index}`, index + 1));
	for (const member of members) shellBox.addChild(member);
	const collapsed = plainRows(shellBox).join("\n");
	assert.match(collapsed, new RegExp(`^ {2}Ran ${count} shell commands$`, "m"), `${count} commands collapse to one summary`);
	const group = (shellBox as any).children[0] as InspectionGroupComponent;
	const summaryY = plainRows(shellBox).findIndex((line) => line.includes(`Ran ${count} shell commands`));
	group.handleMouse({ type: "click", button: "left", y: summaryY, width: 120 });
	assert.ok(members.every((member) => (member as any).expanded), `click expands all ${count} member rows`);
	assert.deepEqual(handlePointerExpansionInput("\x0f"), { consume: true }, "first Ctrl+O after a local click is consumed as collapse");
	assert.ok(members.every((member) => !(member as any).expanded), `one Ctrl+O collapses all ${count} pointer-opened rows`);
	assert.match(plainRows(shellBox).join("\n"), new RegExp(`^ {2}Ran ${count} shell commands$`, "m"));
	assert.equal(handlePointerExpansionInput("\x0f"), undefined, "next Ctrl+O falls through to Pi's normal global toggle");

	// Exercise two more cycles to catch stale wrapper/member ownership.
	for (let cycle = 0; cycle < 2; cycle++) {
		const nextGroup = (shellBox as any).children[0] as InspectionGroupComponent;
		const nextY = plainRows(shellBox).findIndex((line) => line.includes(`Ran ${count} shell commands`));
		nextGroup.handleMouse({ type: "click", button: "left", y: nextY, width: 120 });
		assert.deepEqual(handlePointerExpansionInput("\x0f"), { consume: true });
		assert.match(plainRows(shellBox).join("\n"), new RegExp(`^ {2}Ran ${count} shell commands$`, "m"));
	}
}

clearPointerExpandedMembers();
const zeroHeightSeparatedShellBox = new Container();
zeroHeightSeparatedShellBox.addChild(settledShell("zero-gap-1", 1));
zeroHeightSeparatedShellBox.addChild({ render: () => [], invalidate() {} } as any);
zeroHeightSeparatedShellBox.addChild(settledShell("zero-gap-2", 2));
assert.match(plainRows(zeroHeightSeparatedShellBox).join("\n"), /^ {2}Ran 2 shell commands$/m, "zero-height assistant placeholders do not split a historical inspection group");

clearPointerExpandedMembers();
const separatedShellBox = new Container();
const leftShells = Array.from({ length: 3 }, (_, index) => settledShell(`left-shell-${index}`, index + 1));
const separator = tool(pi, "write", "shell-separator", { path: "separator.txt", content: "x" }, "ok", "settled");
const rightShells = Array.from({ length: 4 }, (_, index) => settledShell(`right-shell-${index}`, index + 1));
for (const member of [...leftShells, separator, ...rightShells]) separatedShellBox.addChild(member);
const separatedRows = plainRows(separatedShellBox);
assert.match(separatedRows.join("\n"), /^ {2}Ran 3 shell commands$/m);
assert.match(separatedRows.join("\n"), /^ {2}Ran 4 shell commands$/m);
const separatedGroups = (separatedShellBox as any).children.filter((child: unknown) => child instanceof InspectionGroupComponent) as InspectionGroupComponent[];
assert.equal(separatedGroups.length, 2);
for (const group of separatedGroups) {
	const rows = group.render(120).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
	const y = rows.findIndex((line) => line.includes("Ran "));
	group.handleMouse({ type: "click", button: "left", y, width: 120 });
}
assert.ok([...leftShells, ...rightShells].every((member) => (member as any).expanded));
assert.deepEqual(handlePointerExpansionInput("\x0f"), { consume: true }, "one Ctrl+O collapses every pointer-opened shell group");
assert.ok([...leftShells, ...rightShells].every((member) => !(member as any).expanded));
assert.equal((separator as any).expanded, false, "the separating mutating tool is untouched");

clearPointerExpandedMembers();
const activeShellBox = new Container();
const activeShellMembers = [
	tool(pi, "bash", "active-shell-1", { command: "echo settled" }, "settled", "settled"),
	tool(pi, "bash", "active-shell-2", { command: "echo streaming" }, "streaming", "streaming"),
	tool(pi, "bash", "active-shell-3", { command: "echo pending" }, "", "pending"),
];
for (const member of activeShellMembers) activeShellBox.addChild(member);
const activeShellRows = plainRows(activeShellBox);
assert.match(activeShellRows.join("\n"), /^⏺ Running 3 shell commands…$/m);
const activeShellGroup = (activeShellBox as any).children[0] as InspectionGroupComponent;
const activeTargetY = activeShellRows.findIndex((line) => line.includes("$ echo"));
activeShellGroup.handleMouse({ type: "click", button: "left", y: activeTargetY, width: 120 });
assert.ok(activeShellMembers.every((member) => (member as any).expanded), "active three-command click expands settled, streaming, and pending members");
assert.deepEqual(handlePointerExpansionInput("\x0f"), { consume: true });
assert.ok(activeShellMembers.every((member) => !(member as any).expanded), "one Ctrl+O re-collapses a mixed active group");

clearPointerExpandedMembers();
const restoredShellBox = new Container();
const restoredShells = Array.from({ length: 3 }, (_, index) => settledShell(`restored-shell-${index}`, index + 1));
for (const member of restoredShells) {
	delete (member as any).isPartial;
	restoredShellBox.addChild(member);
}
const restoredShellRows = plainRows(restoredShellBox);
assert.match(restoredShellRows.join("\n"), /^ {2}Ran 3 shell commands$/m);
const restoredShellGroup = (restoredShellBox as any).children[0] as InspectionGroupComponent;
const restoredY = restoredShellRows.findIndex((line) => line.includes("Ran 3 shell commands"));
restoredShellGroup.handleMouse({ type: "click", button: "left", y: restoredY, width: 120 });
assert.deepEqual(handlePointerExpansionInput("\x0f"), { consume: true });
assert.match(plainRows(restoredShellBox).join("\n"), /^ {2}Ran 3 shell commands$/m, "restored rows cycle without stale expansion state");

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

// A live turn appends tools one at a time. The reconciler must grow one group,
// release the replaced wrapper, and then reuse the stable replacement rather
// than nesting wrappers or allocating on every frame.
const growthBox = new Container();
const growthOne = tool(pi, "read", "growth-1", { path: "src/one.ts" }, "one", "settled");
growthBox.addChild(growthOne);
plainRows(growthBox);
const firstGrowthGroup = (growthBox as any).children[0] as InspectionGroupComponent;
const growthTwo = tool(pi, "read", "growth-2", { path: "src/two.ts" }, "two", "settled");
growthBox.addChild(growthTwo);
assert.match(plainRows(growthBox).join("\n"), /^ {2}Read 2 files$/m);
const grownGroup = (growthBox as any).children[0] as InspectionGroupComponent;
assert.ok(grownGroup instanceof InspectionGroupComponent);
assert.notEqual(grownGroup, firstGrowthGroup, "membership change replaces the wrapper");
assert.equal(firstGrowthGroup.getMembers().length, 0, "replaced wrapper releases its member references");
assert.deepEqual(grownGroup.getMembers(), [growthOne, growthTwo], "new wrapper owns the complete run in order");
plainRows(growthBox);
assert.equal((growthBox as any).children[0], grownGroup, "identical membership reuses the wrapper");

// Eligibility changes repartition the flattened member stream in ONE pass.
// A mixed wrapper must not temporarily dissolve to all-native rows and wait for
// a second repaint before eligible singletons are grouped again.
const splitBox = new Container();
const splitReadA = tool(pi, "read", "split-a", { path: "src/a.ts" }, "a", "settled");
const splitBash = tool(pi, "bash", "split-b", { command: "echo split" }, "split", "settled");
const splitReadC = tool(pi, "read", "split-c", { path: "src/c.ts" }, "c", "settled");
splitBox.addChild(splitReadA);
splitBox.addChild(splitBash);
splitBox.addChild(splitReadC);
assert.match(plainRows(splitBox).join("\n"), /Read 2 files, ran 1 shell command/);
writeSettingsKey("groupShellCommands", false);
clearSettingsCache();
try {
	const splitOnce = plainRows(splitBox).join("\n");
	assert.equal((splitBox as any).children.length, 3, "one render partitions group/read, native bash, group/read");
	assert.ok((splitBox as any).children[0] instanceof InspectionGroupComponent);
	assert.equal((splitBox as any).children[1], splitBash);
	assert.ok((splitBox as any).children[2] instanceof InspectionGroupComponent);
	assert.equal((splitOnce.match(/^ {2}Read 1 file$/gm) ?? []).length, 2, "eligible runs are regrouped immediately");
	assert.match(splitOnce, /⏺ Bash\(echo split\)/);
} finally {
	writeSettingsKey("groupShellCommands", true);
	clearSettingsCache();
}

// If independently-created wrappers become adjacent, the merged replacement
// must release ALL discarded wrappers, not just whichever one was considered
// reusable first.
const leftBox = new Container();
const leftMember = tool(pi, "read", "merge-left", { path: "src/left.ts" }, "left", "settled");
leftBox.addChild(leftMember);
plainRows(leftBox);
const leftGroup = (leftBox as any).children[0] as InspectionGroupComponent;
const rightBox = new Container();
const rightMember = tool(pi, "read", "merge-right", { path: "src/right.ts" }, "right", "settled");
rightBox.addChild(rightMember);
plainRows(rightBox);
const rightGroup = (rightBox as any).children[0] as InspectionGroupComponent;
const mergeBox = new Container();
mergeBox.addChild(leftGroup);
mergeBox.addChild(rightGroup);
assert.match(plainRows(mergeBox).join("\n"), /^ {2}Read 2 files$/m);
assert.equal(leftGroup.getMembers().length, 0, "first discarded wrapper releases ownership");
assert.equal(rightGroup.getMembers().length, 0, "second discarded wrapper releases ownership");

// At narrow widths the wrapper paints native member rows. Mouse handling must
// delegate to Container too; visual fallback without interaction is not native.
const narrowBox = new Container();
const narrowMember = tool(pi, "read", "click-narrow", { path: "src/narrow.ts" }, "one", "settled");
narrowBox.addChild(narrowMember);
plainRows(narrowBox, 12);
const narrowGroup = (narrowBox as any).children[0] as InspectionGroupComponent;
const containerProto = Container.prototype as any;
const previousHandleMouse = containerProto.handleMouse;
const delegated = { handled: true as const, source: "container" };
containerProto.handleMouse = function () { return delegated; };
try {
	assert.equal(
		narrowGroup.handleMouse({ type: "click", button: "left", y: 1, width: 12 }),
		delegated,
		"native narrow fallback delegates pointer handling to the host container",
	);
} finally {
	if (previousHandleMouse === undefined) delete containerProto.handleMouse;
	else containerProto.handleMouse = previousHandleMouse;
}

// --- Conservative identity, epochs, policy refresh, and linear reuse. --------

// Matching pi's private field names is not a runtime type brand. Custom
// components with coincidental metadata must stay exactly where the host put
// them rather than being reparented into an inspection wrapper.
const toolShapedCustomComponent = new Container() as Container & { toolName: string; toolCallId: string };
toolShapedCustomComponent.toolName = "read";
toolShapedCustomComponent.toolCallId = "not-a-pi-tool";
assert.equal(isToolExecutionLike(toolShapedCustomComponent), false, "tool-shaped custom components are not pi executions");
const falsePositiveBox = new Container();
falsePositiveBox.addChild(toolShapedCustomComponent);
ensureInspectionGroups(falsePositiveBox);
assert.equal((falsePositiveBox as any).children[0], toolShapedCustomComponent, "an uncertain component remains native");

// A stale facade can still claim it is expanded after its transcript node has
// detached. A no-op setter is not a real collapse and must not steal Ctrl+O
// from Pi's current transcript.
clearPointerExpandedMembers();
const detachedMember = { expanded: true, setExpanded(_expanded: boolean) {} };
markPointerExpandedMembers([detachedMember]);
assert.equal(handlePointerExpansionInput("\x0f"), undefined, "a detached no-op member does not consume Ctrl+O");
assert.equal(detachedMember.expanded, true);

// Explicit epochs prevent delayed generation-A work from entering generation B
// after compaction or wholesale transcript replacement.
const generationA = beginPointerExpansionEpoch();
const oldGenerationMember = {
	expanded: true,
	setExpanded(expanded: boolean) { this.expanded = expanded; },
};
markPointerExpandedMembers([oldGenerationMember], generationA);
const generationB = beginPointerExpansionEpoch();
const currentGenerationMember = {
	expanded: true,
	setExpanded(expanded: boolean) { this.expanded = expanded; },
};
markPointerExpandedMembers([oldGenerationMember], generationA);
markPointerExpandedMembers([currentGenerationMember], generationB);
assert.deepEqual(handlePointerExpansionInput("\x0f"), { consume: true }, "generation B's visible member collapses");
assert.equal(currentGenerationMember.expanded, false);
assert.equal(oldGenerationMember.expanded, true, "generation A remains detached and untouched");

const parentPointerOwner = {};
const childPointerOwner = {};
beginPointerExpansionEpoch(parentPointerOwner);
const parentPointerMember = { expanded: true, setExpanded(expanded: boolean) { this.expanded = expanded; } };
markPointerExpandedMembers([parentPointerMember], undefined, parentPointerOwner);
beginPointerExpansionEpoch(childPointerOwner);
clearPointerExpandedMembers(childPointerOwner);
releasePointerExpansionOwner(childPointerOwner);
assert.deepEqual(handlePointerExpansionInput("\x0f", parentPointerOwner), { consume: true }, "child session lifecycle cannot orphan the parent's pointer-expanded members");
assert.equal(parentPointerMember.expanded, false);
releasePointerExpansionOwner(parentPointerOwner);

clearPointerExpandedMembers();
const cancellableMember = { expanded: true, setExpanded(expanded: boolean) { this.expanded = expanded; } };
markPointerExpandedMembers([cancellableMember]);
for (const handler of pi.events.get("session_before_compact") ?? []) await handler({}, { sessionManager: { getBranch: () => [] } });
assert.deepEqual(handlePointerExpansionInput("\x0f"), { consume: true }, "cancelled/pre-compaction event does not discard valid pointer state");
cancellableMember.expanded = true;
markPointerExpandedMembers([cancellableMember]);
clearPointerExpandedMembers();
assert.equal(handlePointerExpansionInput("\x0f"), undefined, "successful transcript replacement advances the pointer epoch");

function testPolicy(label: string, eligible: ReadonlySet<unknown>): InspectionGroupPolicy {
	return {
		isEligible: (member) => eligible.has(member),
		isSettled: () => true,
		setExpanded() {},
		renderActive: () => ({ lines: [`active-${label}`], interactiveRows: { start: 0, end: 1 } }),
		renderSettled: () => ({ lines: [`settled-${label}`], interactiveRows: { start: 0, end: 1 } }),
	};
}

// Reusing a membership-stable wrapper must not freeze the policy object from
// the frame in which that wrapper was allocated.
const policyMember = new Text("member", 0, 0);
const policyRoot = { children: [policyMember] as unknown[] };
reconcileInspectionGroups(policyRoot, testPolicy("A", new Set([policyMember])));
const policyWrapper = policyRoot.children[0] as InspectionGroupComponent;
assert.deepEqual(policyWrapper.render(80), ["settled-A"]);
reconcileInspectionGroups(policyRoot, testPolicy("B", new Set([policyMember])));
assert.equal(policyRoot.children[0], policyWrapper, "stable membership reuses the same wrapper");
assert.deepEqual(policyWrapper.render(80), ["settled-B"], "reused wrapper renders with the current policy");

function instrumentSeparatedRuns(runCount: number): InspectionGroupReconciliationMetrics {
	const members = Array.from({ length: runCount }, (_, index) => new Text(`member-${index}`, 0, 0));
	const eligible = new Set<unknown>(members);
	const children: unknown[] = [];
	for (let index = 0; index < members.length; index++) {
		children.push(members[index]);
		if (index + 1 < members.length) children.push({ separator: index });
	}
	const root = { children };
	const policy = testPolicy("instrumented", eligible);
	reconcileInspectionGroups(root, policy);
	const metrics: InspectionGroupReconciliationMetrics = {
		flattenedMembers: 0,
		indexedWrappers: 0,
		reuseCandidateChecks: 0,
	};
	reconcileInspectionGroups(root, policy, metrics);
	return metrics;
}

const nMetrics = instrumentSeparatedRuns(128);
const twoNMetrics = instrumentSeparatedRuns(256);
assert.deepEqual(
	nMetrics,
	{ flattenedMembers: 255, indexedWrappers: 128, reuseCandidateChecks: 128 },
	"N separated runs perform one indexed reuse check per wrapper",
);
assert.deepEqual(
	twoNMetrics,
	{ flattenedMembers: 511, indexedWrappers: 256, reuseCandidateChecks: 256 },
	"2N separated runs double rather than square reconciliation work",
);

console.log("inspection group tests passed");
