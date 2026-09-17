import assert from "node:assert/strict";

import {
	ToolExecutionComponent,
	createBashToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension, { classifyBashCommandForDisplay } from "../extensions/index.ts";
import { clearSettingsCache, writeSettingsKey } from "../extensions/settings.ts";
import { decodeCommandAuditText, encodeCommandAuditText } from "../extensions/terminal-sanitize.ts";

import { useSandboxHome } from "./sandbox-home.ts";

// Assert default rendering, not the settings of whoever runs the suite.
useSandboxHome("cc-bash");

assert.deepEqual(
	classifyBashCommandForDisplay("nl -ba apps/backend/src/lib/notification-unsubscribe.ts | sed -n '1,200p'"),
	{
		kind: "read",
		label: "Read",
		path: "apps/backend/src/lib/notification-unsubscribe.ts",
		rangeLabel: "lines 1-200",
		suppressCollapsedHint: true,
	},
);

assert.deepEqual(
	classifyBashCommandForDisplay('sed -n "960,1015p" apps/backend/src/db/schema.ts'),
	{
		kind: "read",
		label: "Read",
		path: "apps/backend/src/db/schema.ts",
		rangeLabel: "lines 960-1015",
		suppressCollapsedHint: true,
	},
);

assert.deepEqual(
	classifyBashCommandForDisplay("cat 'docs/plans/semantic bash.md'"),
	{
		kind: "read",
		label: "Read",
		path: "docs/plans/semantic bash.md",
		suppressCollapsedHint: true,
	},
);

assert.deepEqual(
	classifyBashCommandForDisplay("head -n 40 README.md"),
	{
		kind: "read",
		label: "Read",
		path: "README.md",
		rangeLabel: "first 40 lines",
		suppressCollapsedHint: true,
	},
);

assert.deepEqual(
	classifyBashCommandForDisplay("tail -25 package-lock.json"),
	{
		kind: "read",
		label: "Read",
		path: "package-lock.json",
		rangeLabel: "last 25 lines",
		suppressCollapsedHint: true,
	},
);

assert.equal(classifyBashCommandForDisplay("npm test"), null);
assert.equal(classifyBashCommandForDisplay("nl -ba a.ts | grep TODO"), null);
assert.equal(classifyBashCommandForDisplay("nl -ba a.ts | sed -n '1,20p' | head"), null);
assert.equal(classifyBashCommandForDisplay("cat a.ts b.ts"), null);
assert.equal(classifyBashCommandForDisplay("cat -"), null);
assert.equal(classifyBashCommandForDisplay("cd apps && cat package.json"), null);

class FakePi {
	tools = new Map<string, any>();
	commands = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();

	registerTool(definition: any): void {
		this.tools.set(definition.name, definition);
	}

	registerCommand(name: string, command: any): void {
		this.commands.set(name, command);
	}

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

function completedTool(pi: FakePi, name: string, id: string, args: any, text: string, details: any = {}): ToolExecutionComponent {
	const tool = pi.tools.get(name);
	assert.ok(tool, `${name} tool registered`);
	const component = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		tool,
		{ requestRender() {}, previousLines: [] } as any,
		process.cwd(),
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	component.updateResult({ content: [{ type: "text", text }], details, isError: false } as any, false);
	return component;
}

/** Dispatched but not yet settled — the group must stay expanded. */
function runningTool(pi: FakePi, name: string, id: string, args: any): ToolExecutionComponent {
	const tool = pi.tools.get(name);
	assert.ok(tool, `${name} tool registered`);
	const component = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		tool,
		{ requestRender() {}, previousLines: [] } as any,
		process.cwd(),
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	return component;
}

initTheme("dark", false);
const pi = new FakePi();
for (const definition of [
	createReadToolDefinition(process.cwd()),
	createBashToolDefinition(process.cwd()),
	createGrepToolDefinition(process.cwd()),
	createFindToolDefinition(process.cwd()),
	createWriteToolDefinition(process.cwd()),
]) {
	pi.tools.set(definition.name, { ...definition, sourceInfo: { source: "builtin", path: `<builtin:${definition.name}>` } });
}
extension(pi as any);
const bashTool = pi.tools.get("bash");
assert.ok(bashTool);

const component = new ToolExecutionComponent(
	"bash",
	"tool-bash-read",
	{ command: "nl -ba apps/backend/src/lib/notification-unsubscribe.ts | sed -n '1,200p'" },
	{ showImages: false },
	bashTool,
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
component.markExecutionStarted();
component.setArgsComplete();
component.updateResult({
	content: [{ type: "text", text: "     1\talpha\n     2\tbeta" }],
	details: {},
} as any, false);

const rendered = component.render(120).map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, "")).join("\n");
assert.match(rendered, /⏺ Read\(apps\/backend\/src\/lib\/notification-unsubscribe\.ts \(lines 1-200\)\)/);
assert.match(rendered, /⎿  Read 2 lines/);
assert.doesNotMatch(rendered, /Bash nl -ba/);
assert.doesNotMatch(rendered, /Ctrl\+O/);


const groupedContainer = new Container();
groupedContainer.addChild(completedTool(pi, "read", "read-one", { path: "src/one.ts" }, "alpha\nbeta"));
groupedContainer.addChild(completedTool(pi, "grep", "grep-one", { pattern: "alpha", path: "src" }, "one.ts:1: alpha\ntwo.ts:2: alpha"));
groupedContainer.addChild(completedTool(pi, "find", "find-one", { pattern: "*.ts", path: "src" }, "one.ts\ntwo.ts\nthree.ts"));
groupedContainer.addChild(completedTool(pi, "read", "read-two", { path: "src/two.ts", offset: 1, limit: 20 }, "gamma"));
groupedContainer.addChild(completedTool(pi, "grep", "grep-two", { pattern: "gamma", path: "src/two.ts" }, "two.ts:1: gamma"));
groupedContainer.addChild(completedTool(pi, "read", "read-three", { path: "src/three.ts" }, "delta"));
groupedContainer.addChild(completedTool(pi, "write", "write-one", { path: "src/write.ts", content: "next\n" }, "ok", { _type: "new", lines: 2, filePath: "src/write.ts" }));

const groupedRendered = groupedContainer.render(120).map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, "")).join("\n");

// Every read-only tool has settled, so Claude Code collapses the whole block to a
// single dim past-tense line with no bullet. Grammar:
// docs/plans/2026-07-13-current-cc-grammar.md
//
// The glob (`find`) counts as a *pattern*, not a clause of its own — Claude Code
// folds Glob into grep's clause. Captured side by side against pi:
// docs/plans/2026-07-14-tool-row-conformance-audit.md
assert.match(groupedRendered, /^ {2}Searched for 3 patterns, read 3 files$/m);
assert.doesNotMatch(groupedRendered, /Inspect\(/);
assert.doesNotMatch(groupedRendered, /tool uses/);
assert.doesNotMatch(groupedRendered, /lines loaded/);
assert.doesNotMatch(groupedRendered, /^⏺ Read\(src\/one\.ts\)/m);

// Mutating tools keep their own row and never join the group.
// The label is Write (never "Create") and the result is a sentence.
assert.match(groupedRendered, /^⏺ Write\(src\/write\.ts\)/m);
// "next\n" is one line — the trailing newline terminates it, it does not add a line.
assert.match(groupedRendered, /⎿ {2}Wrote 1 line to src\/write\.ts/);
assert.doesNotMatch(groupedRendered, /⏺ Create\(/);

// While tools are still running the group stays expanded: gerund header, one ⎿ per
// target, bare paths, `$ cmd` for shell.
const activeContainer = new Container();
activeContainer.addChild(runningTool(pi, "read", "run-read", { path: "src/one.ts" }));
activeContainer.addChild(runningTool(pi, "read", "run-read-2", { path: "src/two.ts" }));
activeContainer.addChild(runningTool(pi, "bash", "run-bash", { command: "git log --oneline -3" }));

const activeRendered = activeContainer.render(120).map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, "")).join("\n");
assert.match(activeRendered, /^⏺ Reading 2 files, running 1 shell command…$/m);
assert.match(activeRendered, /^ {2}⎿ {2}src\/one\.ts$/m);
assert.match(activeRendered, /^ {2}⎿ {2}src\/two\.ts$/m);
assert.match(activeRendered, /^ {2}⎿ {2}\$ git log --oneline -3$/m);

// --- An aggregated shell command must be recoverable in full. ----------------

// Aggregation hides the command behind "Ran 1 shell command", and both visible
// states used to clip it: the in-flight ⎿ row and the settled Bash(…) header
// both ran through summarizeText(…, 72). For a long mutating pipeline that left
// no state, anywhere, that showed what actually ran.
const LONG_COMMAND =
	"rm -rf /Users/dev/work/build-artifacts/stale-cache-directory && curl -fsSL https://example.invalid/install.sh | sh -s -- --force";
assert.ok(LONG_COMMAND.length > 72, "fixture must exceed the collapsed clip width");

function renderOne(component: ToolExecutionComponent, width = 120): string {
	const box = new Container();
	box.addChild(component);
	return box
		.render(width)
		.map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, ""))
		.join("\n");
}

// Collapsed, the command is not merely clipped — it is absent: the aggregate
// replaces the row entirely. So expansion is the ONLY way back to the text.
const clipped = renderOne(completedTool(pi, "bash", "clip-1", { command: LONG_COMMAND }, "done"));
assert.match(clipped, /Ran 1 shell command/, "collapsed shows the aggregate");
assert.ok(!clipped.includes("rm -rf"), "collapsed shows nothing of the command");

// Expanded (ctrl+o): the whole command, wrapped across rows rather than clipped.
// setExpanded is exactly what pi's ctrl+o handler calls (setToolsExpanded walks
// chatContainer.children); assigning .expanded directly skips updateDisplay()
// and would assert against stale child components.
const openedTool = completedTool(pi, "bash", "open-1", { command: LONG_COMMAND }, "done");
openedTool.setExpanded(true);
const opened = renderOne(openedTool);
// Text wraps the header across rows and a wrap point consumes the space it
// broke on, so compare whitespace-insensitively rather than reassembling.
const squash = (text: string) => text.replace(/\s+/g, "");
assert.ok(squash(opened).includes(squash(LONG_COMMAND)), "expanding reveals the full command");
assert.match(opened, /--force\)/, "the command's tail is present, not clipped away");
assert.doesNotMatch(opened, /rm -rf .*\.\.\./, "expanded header is not clipped");

// Claude Code v2.1.266 shows a captured 5,000-character command in full in
// detailed transcript mode, followed by `(No output)`; it applies no row cap.
const longPrefix = "printf '%s' '";
const longSuffix = "' >/dev/null";
const command5000 = `${longPrefix}${"x".repeat(5000 - longPrefix.length - longSuffix.length)}${longSuffix}`;
assert.equal(command5000.length, 5000);
const hugeCommandTool = completedTool(pi, "bash", "command-5000", { command: command5000 }, "");
hugeCommandTool.setExpanded(true);
const hugeCommandRender = renderOne(hugeCommandTool, 120);
assert.ok(squash(hugeCommandRender).includes(squash(command5000)), "5,000-character expanded command remains fully recoverable");
assert.match(hugeCommandRender, /\(No output\)/, "empty result follows Claude's detailed wording");
assert.doesNotMatch(hugeCommandRender, /display capped|truncated|\.\.\./i, "expanded command has no uncaptured row cap");

// "Full command" means exact argument whitespace, not merely all tokens. Two
// spaces inside a quoted argument are shell-significant and must survive.
const SPACED_COMMAND = `printf 'a  b'`;
const spacedTool = completedTool(pi, "bash", "space-1", { command: SPACED_COMMAND }, "a  b");
spacedTool.setExpanded(true);
assert.match(renderOne(spacedTool), /Bash\(printf 'a  b'\)/, "expanded command preserves quoted double spaces");
const TRAILING_SPACE_COMMAND = String.raw`printf %s foo\ `;
const trailingSpaceTool = completedTool(pi, "bash", "space-2", { command: TRAILING_SPACE_COMMAND }, "foo ");
trailingSpaceTool.setExpanded(true);
assert.ok(
	renderOne(trailingSpaceTool).includes(`Bash(${encodeCommandAuditText(TRAILING_SPACE_COMMAND)})`),
	"expanded command preserves a significant escaped trailing space",
);

// The collapsed summary is cached under a separate key, so a row rendered
// collapsed first still widens when opened (argsComplete latches the cache).
const latched = completedTool(pi, "bash", "latch-1", { command: LONG_COMMAND }, "done");
renderOne(latched);
latched.setExpanded(true);
assert.ok(
	renderOne(latched).replace(/\s+/g, "").includes(LONG_COMMAND.replace(/\s+/g, "")),
	"a collapsed render must not pin the clipped summary",
);
// …and collapsing again returns to the aggregate rather than stranding the
// expanded text in a collapsed row.
latched.setExpanded(false);
assert.match(renderOne(latched), /Ran 1 shell command/, "re-collapsing restores the aggregate");

// A command is model output: escape sequences must never reach the row. A bare
// SGR reset is not enough — ESC(0 survives it and redraws later rows as line art.
const hostile = completedTool(
	pi,
	"bash",
	"esc-1",
	{ command: "echo \u001b[31mred\u001b[0m \u001b(0 \u001b]8;;http://evil.invalid\u0007link\u0007 \u0000done" },
	"out",
);
hostile.setExpanded(true);
const hostileOut = new Container();
hostileOut.addChild(hostile);
const rawHostile = hostileOut.render(120).join("\n");
assert.doesNotMatch(rawHostile, /\u001b\(0|\u001b\]8;;http:\/\/evil\.invalid|\u0000/, "raw hostile controls never reach the terminal");
assert.match(rawHostile, /\\x\{ESC\}\[31mred\\x\{ESC\}\[0m/, "expanded audit visibly encodes SGR bytes");
assert.match(rawHostile, /\\x\{ESC\}\]8;;http:\/\/evil\.invalid\\x\{BEL\}link\\x\{BEL\}/, "expanded audit preserves printable OSC payload and metacharacters");
assert.match(rawHostile, /\\x\{NUL\}done/, "expanded audit visibly preserves NUL position");

const executableOsc = completedTool(
	pi,
	"bash",
	"esc-executable",
	{ command: "true \u001b]0; printf PWN \u0007" },
	"",
);
executableOsc.setExpanded(true);
const executableAudit = renderOne(executableOsc);
assert.match(executableAudit, /true \\x\{ESC\}\]0; printf PWN \\x\{BEL\}/, "audit encoding never erases printable executable syntax inside a terminated envelope");
const literalToken = completedTool(pi, "bash", "literal-audit-token", { command: String.raw`printf '\x{ESC}'` }, "");
literalToken.setExpanded(true);
assert.match(renderOne(literalToken), /printf '\\\\x\{ESC\}'/, "literal audit-token text remains distinguishable through escaped backslash");
const roundTripAudit = String.raw`literal \\x{ESC}` + "\x1b]0; printf PWN \x07\n\u202e\u061c\u2060";
assert.equal(decodeCommandAuditText(encodeCommandAuditText(roundTripAudit)), roundTripAudit, "audit representation round-trips controls and literal token syntax without collision");

const c1AuditTool = completedTool(pi, "bash", "c1-executable", { command: "true \u009d0; printf C1 \u009c" }, "");
c1AuditTool.setExpanded(true);
const c1Audit = renderOne(c1AuditTool);
assert.match(c1Audit, /true \\u\{009D\}0; printf C1 \\u\{009C\}/, "C1 OSC/ST controls are visible while printable shell syntax remains ordered");

// A read-like command renders as its target (`f (lines 1-200)`), which hides
// what actually ran. Expanding must still reach the command, or the semantic
// path becomes the one place aggregation stays unrecoverable.
const SEMANTIC_COMMAND = "nl -ba apps/backend/src/lib/notification-unsubscribe.ts | sed -n '1,200p'";
const semanticCollapsed = renderOne(completedTool(pi, "bash", "sem-1", { command: SEMANTIC_COMMAND }, "1\tline"));
assert.match(semanticCollapsed, /Ran 1 shell command/, "a read-like command still aggregates");

const semanticOpen = completedTool(pi, "bash", "sem-2", { command: SEMANTIC_COMMAND }, "1\tline");
semanticOpen.setExpanded(true);
const semanticOpened = renderOne(semanticOpen);
assert.ok(
	semanticOpened.replace(/\s+/g, "").includes(SEMANTIC_COMMAND.replace(/\s+/g, "")),
	"expanding a read-like command reveals the command, not just its target",
);
// Collapsed it still reads as the friendly target, so the capture is intact.
semanticOpen.setExpanded(false);
assert.doesNotMatch(renderOne(semanticOpen), /nl -ba/, "collapsed keeps the semantic target form");

// --- Clicks must land where the painted row is. --------------------------------
// The host hit-tests from mouseLayout, which core writes for the UNFRAMED
// lines. The border patch trims blanks and prepends a spacer (plus borders in
// outlines mode), so without re-anchoring every painted line below a tool row
// routes off by the framing height: header clicks miss while result clicks
// still toggle. Re-anchor first/last child heights to what we painted.
const clickTool = new ToolExecutionComponent(
	"bash",
	"click-1",
	{ command: "echo hi" },
	{ showImages: false },
	bashTool,
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
clickTool.markExecutionStarted();
clickTool.setArgsComplete();
clickTool.updateResult({ content: [{ type: "text", text: "hi" }], details: {} } as any, false);
const clickKids = ((clickTool as any).children ?? []) as any[];
assert.ok(clickKids.length > 0, "tool row exposes child regions to map");
// Seed the layout the host would have written: true per-child heights, as
// originalRender records them before framing shifts every painted line.
const naturalHeights = clickKids.map((kid: any) => kid.render(120).length);
(clickTool as any).mouseLayout = { width: 120, children: clickKids.map((component: unknown, index: number) => ({ component, height: naturalHeights[index] })) };
const clickLines = clickTool.render(120);
const installed = (clickTool as any).mouseLayout;
assert.equal(installed.width, 120, "installed layout tracks the render width");
assert.equal(installed.children.length, clickKids.length, "one entry per child region");
assert.ok(clickLines.length > 0, "the tool paints rows");
const mappedTotal = installed.children.reduce((sum: number, entry: any) => sum + entry.height, 0);
// The seeded heights here are measured standalone, while the parent composes
// children at a padded width — so exact equality cannot hold in this pinned
// host. Assert a usable non-empty map; exact conservation is pinned below on
// the pure function with known inputs.
assert.ok(mappedTotal > 0, "installed layout owns at least one painted row");
assert.ok(
	installed.children.every((entry: any) => Number.isInteger(entry.height) && entry.height >= 0),
	"every region has a non-negative integer height",
);
assert.ok(installed.children[0].height > 0, "the header region remains clickable");

// --- anchorFramedHeights: the conservation math, deterministically. -----------
// Painted output is always framing + trimmed content, so mapped heights must
// always sum to exactly the painted line count — otherwise rows below misroute.
import { anchorFramedHeights } from "../extensions/index.ts";
const conserve = (natural: number[], start: number, trailing: number, top: number, bottom: number): number =>
	anchorFramedHeights(natural, start, trailing, top, bottom).reduce((a, b) => a + b, 0);
// transparent: 1 spacer on top; outlines: spacer+border top, border bottom.
assert.equal(conserve([3, 3], 0, 0, 1, 0), 7, "spacer absorbed, total conserved");
assert.equal(conserve([3, 3], 1, 1, 1, 0), 5, "trimmed blanks removed from the right ends");
assert.equal(conserve([4, 2, 5], 2, 3, 2, 1), 9, "outlines framing on both ends");
assert.equal(conserve([2], 1, 1, 1, 1), 2, "single child takes both trims and both framings");
assert.deepEqual(anchorFramedHeights([], 2, 2, 1, 1), [], "no children, no regions");
assert.deepEqual(
	anchorFramedHeights([1, 4], 5, 0, 1, 0),
	[1, 0],
	"leading trim consumes across child boundaries; top framing remains mapped",
);
assert.deepEqual(
	anchorFramedHeights([4, 1], 0, 5, 0, 1),
	[0, 1],
	"trailing trim consumes across child boundaries; bottom framing remains mapped",
);
assert.ok(anchorFramedHeights([1, 4], 0, 0, 1, 0)[0] >= 1, "first region is non-empty, so the spacer maps into the block");

// --- A running command shows where it is, not just a count. --------------------
// While streaming, the row used to read `Running... (N lines)` with no output.
// Claude shows the head there; tail keeps the latest progress visible instead.
// Either way the preview is truncated to the collapsed budget.
writeSettingsKey("groupShellCommands", false);
clearSettingsCache();
const ticks = Array.from({ length: 15 }, (_, index) => `tick${index + 1}`).join("\n");
const streamingTool = new ToolExecutionComponent(
	"bash",
	"run-1",
	{ command: "for i in 1 2 3; do echo tick$i; sleep 1; done" },
	{ showImages: false },
	bashTool,
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
streamingTool.markExecutionStarted();
streamingTool.setArgsComplete();
streamingTool.updateResult({ content: [{ type: "text", text: ticks }], details: {} } as any, true);
const runBox = new Container();
runBox.addChild(streamingTool);
const runOut = runBox
	.render(120)
	.map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""))
	.join("\n");
assert.match(runOut, /Running\.\.\. \(15 lines\)/, "running header keeps the total count");
const runLines = runOut.split("\n").map((line) => line.trim());
for (const head of ["tick1", "tick10"]) assert.ok(runLines.includes(head), `running head shows ${head} by default`);
for (const tail of ["tick11", "tick12", "tick13", "tick14", "tick15"])
	assert.ok(!runLines.includes(tail), `running head hides ${tail} by default`);
assert.match(runOut, /… \+5 more lines/, "running head says output is hidden, without promising expansion");
// Tail mode must reflect live on the SAME mounted component. A fresh component
// would hide a stale width/background-only render cache.
writeSettingsKey("bashRunningPreview", "tail");
clearSettingsCache();
runBox.render(120); // schedules a non-reentrant renderer rebuild
await new Promise((resolve) => setTimeout(resolve, 0));
const tailOut = runBox
	.render(120)
	.map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""))
	.join("\n");
const tailLines = tailOut.split("\n").map((line) => line.trim());
for (const tail of ["tick6", "tick15"]) assert.ok(tailLines.includes(tail), `running tail shows ${tail}`);
for (const head of ["tick1", "tick2", "tick3", "tick4", "tick5"])
	assert.ok(!tailLines.includes(head), `running tail hides ${head}`);
assert.match(tailOut, /… \+5 earlier lines/, "running tail says earlier output is hidden");

// Zero is a valid collapsed-line setting. `slice(-0)` is `slice(0)`, so tail
// mode needs an explicit zero path or it exposes every line.
writeSettingsKey("bashCollapsedLines", 0);
clearSettingsCache();
runBox.render(120);
await new Promise((resolve) => setTimeout(resolve, 0));
const zeroTailOut = runBox
	.render(120)
	.map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""))
	.join("\n");
assert.match(zeroTailOut, /Running\.\.\. \(15 lines\)/);
for (const tick of ["tick1", "tick6", "tick15"]) assert.doesNotMatch(zeroTailOut, new RegExp(`^\\s*${tick}$`, "m"));
assert.match(zeroTailOut, /… \+15 earlier lines/, "zero-line tail states that all output is hidden");
writeSettingsKey("bashCollapsedLines", 10);

// Streaming output is now rendered by claudify, so it must cross the same
// terminal-safety boundary as commands and targets.
const hostileStream = new ToolExecutionComponent(
	"bash",
	"run-hostile",
	{ command: "printf hostile" },
	{ showImages: false },
	bashTool,
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
hostileStream.markExecutionStarted();
hostileStream.setArgsComplete();
hostileStream.updateResult({ content: [{ type: "text", text: "safe\u001b(0spoof\nokay\rFORGED" }], details: {} } as any, true);
const hostileStreamBox = new Container();
hostileStreamBox.addChild(hostileStream);
const hostileStreamRaw = hostileStreamBox.render(120).join("\n");
assert.doesNotMatch(hostileStreamRaw, /\u001b\(0/, "streaming preview strips charset shifts");
assert.doesNotMatch(hostileStreamRaw, /\r/, "streaming preview cannot overwrite its row with CR");
assert.match(hostileStreamRaw, /safespoof/, "readable streaming output survives sanitization");
hostileStream.updateResult({ content: [{ type: "text", text: "done" }], details: {} } as any, false);
clearSettingsCache();

// An expanded running row stays capped: clicking changes aggregate -> native
// row ownership, not the streaming-output budget.
const streamingTool3 = new ToolExecutionComponent(
	"bash",
	"run-3",
	{ command: "for i in 1 2 3; do echo tick$i; sleep 1; done" },
	{ showImages: false },
	bashTool,
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
streamingTool3.markExecutionStarted();
streamingTool3.setArgsComplete();
streamingTool3.updateResult({ content: [{ type: "text", text: ticks }], details: {} } as any, true);
streamingTool3.setExpanded(true);
const expandedBox = new Container();
expandedBox.addChild(streamingTool3);
const expandedOut = expandedBox
	.render(120)
	.map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""))
	.join("\n");
const expandedLines = expandedOut.split("\n").map((line) => line.trim());
for (const tick of ["tick6", "tick15"]) assert.ok(expandedLines.includes(tick), `expanded running tail shows ${tick}`);
for (const tick of ["tick1", "tick2", "tick3", "tick4", "tick5"])
	assert.ok(!expandedLines.includes(tick), `expanded running row still caps ${tick}`);
assert.match(expandedOut, /… \+5 earlier lines/, "expanded running row states what is hidden");
assert.doesNotMatch(expandedOut, /ctrl\+o to expand/, "running truncation never promises the wrong ctrl+o action");
streamingTool.updateResult({ content: [{ type: "text", text: "done" }], details: {} } as any, false);
streamingTool3.updateResult({ content: [{ type: "text", text: "done" }], details: {} } as any, false);
writeSettingsKey("bashRunningPreview", "head");

// Settled expansion defaults to Claude's capture-backed 4,000-row recovery
// budget; ordinary 151-row output must not hit the old implementation default.
writeSettingsKey("expandedPreviewMaxLines", undefined);
clearSettingsCache();
const defaultExpandedLines = Array.from({ length: 151 }, (_, index) => `default-expanded-${index + 1}`).join("\n");
const defaultExpanded = completedTool(pi, "bash", "settled-default-cap", { command: "printf default-expanded" }, defaultExpandedLines);
defaultExpanded.setExpanded(true);
const defaultExpandedOut = renderOne(defaultExpanded, 100);
assert.match(defaultExpandedOut, /default-expanded-151/, "default expanded budget exceeds 150 rows");
assert.doesNotMatch(defaultExpandedOut, /display capped/, "ordinary expanded output is fully recoverable by default");

// Users can still select a lower explicit visual-row ceiling.
writeSettingsKey("expandedPreviewMaxLines", 5);
clearSettingsCache();
const settledLines = Array.from({ length: 15 }, (_, index) => `settled${index + 1}`).join("\n");
const cappedSettled = completedTool(pi, "bash", "settled-cap", { command: "printf settled" }, settledLines);
cappedSettled.setExpanded(true);
const cappedBox = new Container();
cappedBox.addChild(cappedSettled);
const cappedOut = cappedBox
	.render(120)
	.map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""))
	.join("\n");
const cappedLines = cappedOut.split("\n").map((line) => line.trim());
for (const tick of ["settled1", "settled5"]) assert.ok(cappedLines.some((line) => line.endsWith(tick)), `settled cap shows ${tick}`);
assert.ok(!cappedLines.includes("settled6"), "settled cap hides line 6");
assert.match(cappedOut, /… \+10 lines/, "settled cap states the hidden remainder");
assert.match(cappedOut, /display capped at 5 lines/, "settled cap names the configured ceiling");
writeSettingsKey("expandedPreviewMaxLines", undefined);
clearSettingsCache();

// Budgets count VISUAL rows, not logical newlines. A minified 50KB line must
// remain bounded after ToolText wraps it at the actual viewport width.
writeSettingsKey("bashRunningPreview", "head");
writeSettingsKey("bashCollapsedLines", 10);
clearSettingsCache();
const minifiedTool = new ToolExecutionComponent(
	"bash",
	"run-minified",
	{ command: "cat bundle.js" },
	{ showImages: false },
	bashTool,
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
minifiedTool.markExecutionStarted();
minifiedTool.setArgsComplete();
minifiedTool.updateResult({ content: [{ type: "text", text: `BEGIN${"x".repeat(50 * 1024)}END` }], details: {} } as any, true);
const minifiedRows = minifiedTool.render(100);
assert.ok(minifiedRows.length <= 16, `50KB logical line stays within 10 preview rows plus host chrome, got ${minifiedRows.length} rows`);
for (const line of minifiedRows) assert.ok(visibleWidth(line) <= 100, "minified preview row fits viewport");
assert.match(minifiedRows.join("\n"), /BEGIN/, "head preview keeps the start");

writeSettingsKey("bashRunningPreview", "tail");
clearSettingsCache();
minifiedTool.render(100);
await new Promise((resolve) => setTimeout(resolve, 0));
const minifiedTail = minifiedTool.render(100).join("\n");
assert.match(minifiedTail, /END/, "tail preview keeps the end of one huge logical line");
assert.doesNotMatch(minifiedTail, /BEGIN/, "tail preview drops the distant start");
writeSettingsKey("bashRunningPreview", "head");
clearSettingsCache();
writeSettingsKey("groupShellCommands", true);
clearSettingsCache();

console.log("bash display tests passed");
