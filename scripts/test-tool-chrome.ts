import assert from "node:assert/strict";

import {
	ToolExecutionComponent,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension, { releaseToolFallbackSanitization, sanitizeRenderedTextBlockLines } from "../extensions/index.ts";
import { clearSettingsCache, writeSettingsKey } from "../extensions/settings.ts";

import { useSandboxHome } from "./sandbox-home.ts";

// Assert default rendering, not the settings of whoever runs the suite.
useSandboxHome("cc-chrome");

// Chrome captured from Claude Code's raw TTY stream:
// docs/plans/2026-07-13-current-cc-grammar.md
const CC_DOT_PENDING = "\x1b[38;2;153;153;153m";
const CC_DOT_SUCCESS = "\x1b[38;2;135;215;135m";
const CC_DOT_ERROR = "\x1b[38;2;255;135;175m";
const BOLD = "\x1b[1m";

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

function component(pi: FakePi, name: string, id: string, args: any, cwd = process.cwd()): ToolExecutionComponent {
	const tool = pi.tools.get(name);
	assert.ok(tool, `${name} tool registered`);
	const c = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		tool,
		{ requestRender() {}, previousLines: [] } as any,
		cwd,
	);
	c.markExecutionStarted();
	c.setArgsComplete();
	return c;
}

function plainRender(component: { render(width: number): string[] }, width = 100): string {
	return component
		.render(width)
		.map((line) => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""))
		.join("\n");
}

const nativeMarkdownRows = ["\x1b[38;2;128;128;128m```ts\x1b[39m", "  code", "│ quote"];
assert.deepEqual(
	sanitizeRenderedTextBlockLines(nativeMarkdownRows, "pi"),
	nativeMarkdownRows,
	"Pi-native Markdown style bypasses Claude grammar transformations",
);

const literalGlyphRows = [
	"\x1b[38;2;128;128;128m```ts\x1b[39m",
	"  \x1b[34mconst\x1b[39m value = 1;",
	"\x1b[38;2;128;128;128m```\x1b[39m",
	"\x1b[38;2;128;128;128m────────────────\x1b[39m",
	"\x1b[38;2;128;128;128m│ \x1b[3mquote\x1b[0m",
	"│ Alpha │ 42 │",
];
assert.deepEqual(
	sanitizeRenderedTextBlockLines(literalGlyphRows, "claude"),
	literalGlyphRows,
	"rendered text sanitation never infers Markdown structure from user-authored glyphs",
);

initTheme("dark", false);
const pi = new FakePi();
for (const definition of [
	createReadToolDefinition(process.cwd()), createWriteToolDefinition(process.cwd()), createEditToolDefinition(process.cwd()),
	createBashToolDefinition(process.cwd()), createGrepToolDefinition(process.cwd()), createFindToolDefinition(process.cwd()), createLsToolDefinition(process.cwd()),
]) pi.tools.set(definition.name, { ...definition, sourceInfo: { source: "builtin", path: `<builtin:${definition.name}>` } });
for (const name of ["webfetch", "web_search", "Agent", "code_search", "apply_patch"]) {
	pi.registerTool({
		name,
		label: name,
		description: name,
		execute: async () => ({ content: [], details: {} }),
	});
}
extension(pi as any);

// Structured apply_patch input must remain multiline until after parsing.
const patchComponent = component(pi, "apply_patch", "patch-structured", {
	patchText: "*** Begin Patch\n*** Add File: src/new.ts\n+const created = true;\n*** Update File: src/old.ts\n@@\n-const old = 1;\n+const old = 2;\n*** End Patch",
});
let patchText = "";
for (let attempt = 0; attempt < 80; attempt++) {
	patchText = plainRender(patchComponent);
	if (!patchText.includes("rendering")) break;
	await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.match(patchText, /Apply Patch\(src\/new\.ts \(\+1 files\)\)/, "multiline patch parser retains both file headers");
assert.match(patchText, /Create src\/new\.ts/);
assert.match(patchText, /const created = true/);

if (process.platform !== "win32") {
	const devicePatch = component(pi, "apply_patch", "patch-device", {
		patchText: "*** Begin Patch\n*** Update File: /dev/zero\n@@\n-old\n+new\n*** End Patch",
	});
	let devicePreview = "";
	for (let attempt = 0; attempt < 80; attempt++) {
		devicePreview = plainRender(devicePatch);
		if (!devicePreview.includes("rendering")) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.match(devicePreview, /Update \/dev\/zero/, "apply_patch preview never reads model-selected devices to infer coordinates");
}

// --- Bullet is the status signal: gray while running, green once it succeeded.
const running = component(pi, "write", "chrome-running", { path: "src/a.ts", content: "x\n" });
const runningRaw = running.render(100).join("\n");
assert.ok(runningRaw.includes(CC_DOT_PENDING), "pending bullet is gray");
assert.ok(!runningRaw.includes(CC_DOT_SUCCESS), "pending bullet is not green");

running.updateResult(
	{ content: [{ type: "text", text: "ok" }], details: { _type: "new", lines: 1, filePath: "src/a.ts" }, isError: false } as any,
	false,
);
const doneRaw = running.render(100).join("\n");
assert.ok(doneRaw.includes(CC_DOT_SUCCESS), "successful bullet turns green");

const failed = component(pi, "write", "chrome-failed", { path: "src/b.ts", content: "x\n" });
failed.updateResult({ content: [{ type: "text", text: "boom" }], details: {}, isError: true } as any, false);
assert.ok(failed.render(100).join("\n").includes(CC_DOT_ERROR), "failed bullet turns red");

// --- Header: bold tool name, plain parens, path as an OSC 8 hyperlink (not tinted).
const read = component(pi, "read", "chrome-read", { path: "src/a.ts" });
const readRaw = read.render(100).join("\n");
assert.ok(readRaw.includes(`${BOLD}Read`), "tool name is bold");

// OSC 8: ESC ] 8 ; ; <uri> BEL <label> ESC ] 8 ; ; BEL
const link = /\x1b\]8;;file:\/\/[^\x07]*src\/a\.ts\x07src\/a\.ts\x1b\]8;;\x07/;
assert.match(readRaw, link, "path is wrapped in an OSC 8 file:// hyperlink");

const runtimePathRead = component(pi, "read", "chrome-runtime-cwd", { path: "same-name.ts" }, "/tmp/claudify-runtime-cwd");
const runtimePathRaw = runtimePathRead.render(120).join("\n");
assert.match(runtimePathRaw, /file:\/\/\/tmp\/claudify-runtime-cwd\/same-name\.ts/, "OSC-8 target resolves against render context cwd, not extension startup cwd");

// The hyperlink must be zero-width to pi's own wrapper, or every row would wrap
// early and padding would drift.
const linked = `\x1b]8;;file:///tmp/a.ts\x07src/a.ts\x1b]8;;\x07`;
assert.equal(visibleWidth(linked), visibleWidth("src/a.ts"), "OSC 8 hyperlinks must measure zero-width");

const plain = readRaw.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "");
assert.match(plain, /^⏺ Read\(src\/a\.ts\)/m, "row reads as ⏺ Read(src/a.ts) once escapes are stripped");

const hostilePath = "src/\x1b]8;;https://evil.test\x07bad\x1b]8;;\x07\x1b(0name#?.ts";
const hostileRead = component(pi, "read", "chrome-hostile-read", { path: hostilePath });
const hostileReadRaw = hostileRead.render(120).join("\n");
assert.doesNotMatch(hostileReadRaw, /https:\/\/evil\.test|\x1b\(0/, "path label cannot terminate or forge the generated OSC-8 link");
assert.match(hostileReadRaw, /%23%3F\.ts/, "file URI percent-encodes path-significant # and ? bytes");
assert.doesNotThrow(() => component(pi, "read", "chrome-surrogate-read", { path: "src/\uD800.ts" }).render(120), "lone-surrogate paths fail closed without breaking rendering");

const hostileGrep = component(pi, "grep", "chrome-hostile-grep", {
	pattern: "needle\x1b(0\nforged",
	path: "src/\x1b[31mevil",
});
const hostileGrepRaw = hostileGrep.render(120).join("\n");
assert.doesNotMatch(hostileGrepRaw, /\x1b\(0|\x1b\[31m|\nforged/, "Grep pattern and path controls are sanitized before styling");
assert.match(hostileGrepRaw.replace(/\x1b\[[0-9;]*m/g, ""), /needle forged/);

const imageRead = component(pi, "read", "chrome-image-read", { path: "pixel.png" });
imageRead.updateResult(
	{ content: [{ type: "image", data: "AA==", mimeType: "image/png" }], details: {}, isError: false } as any,
	false,
);
const imageContainer = new Container();
imageContainer.addChild(imageRead);
const imagePlain = plainRender(imageContainer);
assert.match(imagePlain, /^ {2}Read 1 file$/m, "an image read collapses like an ordinary read");
assert.doesNotMatch(imagePlain, /Image loaded|\[image\/|\(ctrl\+o to show\)/);

// --- Result rows: counts and paths are bold; the ⎿ gutter is Claude's gray.
const write = component(pi, "write", "chrome-write", { path: "src/c.ts", content: "one\ntwo\n" });
write.updateResult(
	{ content: [{ type: "text", text: "ok" }], details: { _type: "new", lines: 2, filePath: "src/c.ts" }, isError: false } as any,
	false,
);
const writeRaw = write.render(100).join("\n");
assert.ok(writeRaw.includes(`${BOLD}2`), "the line count is bold");
assert.ok(writeRaw.includes(CC_DOT_PENDING) || writeRaw.includes("\x1b[38;2;153;153;153m"), "⎿ gutter uses Claude's gray");

const writePlain = writeRaw.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "");
assert.match(writePlain, /⎿ {2}Wrote 2 lines to src\/c\.ts/);

// Fresh Claude Code v2.1.266 detailed-transcript capture: successful reads use
// `Read N lines`; successful Bash with output shows the output directly, with
// no extra `Done (N lines)` row.
const detailedRead = component(pi, "read", "chrome-read-detail", { path: "src/detail.ts" });
detailedRead.updateResult({ content: [{ type: "text", text: "one\ntwo\n" }], details: {}, isError: false } as any, false);
detailedRead.setExpanded(true);
const detailedReadText = plainRender(detailedRead);
assert.match(detailedReadText, /⎿ {2}Read 3 lines/);
assert.doesNotMatch(detailedReadText, /lines loaded/);

const detailedBash = component(pi, "bash", "chrome-bash-detail", { command: "printf color-bash" });
detailedBash.updateResult({ content: [{ type: "text", text: "color-bash" }], details: {}, isError: false } as any, false);
detailedBash.setExpanded(true);
const detailedBashText = plainRender(detailedBash);
assert.match(detailedBashText, /⎿ {2}color-bash/);
assert.doesNotMatch(detailedBashText, /Done \(/);

for (const command of ["true", "printf ''", ":", "test -d ."]) {
	const empty = component(pi, "bash", `empty-${command}`, { command });
	empty.updateResult({ content: [{ type: "text", text: "" }], details: {}, isError: false } as any, false);
	empty.setExpanded(true);
	assert.match(plainRender(empty), /⎿ {2}\(No output\)/, `${command} uses Claude's empty-output wording`);
}
for (const command of ["cd .", "touch /tmp/example", "mkdir -p /tmp/example", "rm -f /tmp/example"]) {
	const emptyMutation = component(pi, "bash", `empty-mutation-${command}`, { command });
	emptyMutation.updateResult({ content: [{ type: "text", text: "" }], details: {}, isError: false } as any, false);
	emptyMutation.setExpanded(true);
	assert.match(plainRender(emptyMutation), /⎿ {2}Done/, `${command} uses Claude's captured mutation wording`);
}

const realEmptyResult = await pi.tools.get("bash").execute("real-empty", { command: "true" }, undefined, undefined, {
	cwd: process.cwd(),
	isProjectTrusted: () => false,
	model: undefined,
	thinkingLevel: "off",
	sessionManager: { getSessionId: () => "tool-chrome", getSessionFile: () => undefined },
});
const realEmpty = component(pi, "bash", "real-empty", { command: "true" });
realEmpty.updateResult(realEmptyResult as any, false);
realEmpty.setExpanded(true);
assert.match(plainRender(realEmpty), /⎿ {2}\(No output\)/, "real Pi Bash empty-output sentinel reaches Claude classification");

const detailedError = component(pi, "read", "chrome-read-error", { path: "missing.ts" });
detailedError.updateResult({ content: [{ type: "text", text: "Error: File does not exist." }], details: {}, isError: true } as any, false);
const detailedErrorRaw = detailedError.render(100).join("\n");
assert.ok(detailedErrorRaw.split(CC_DOT_ERROR).length >= 3, "Claude error pink colors both bullet and error text");

const hostileWriteError = component(pi, "write", "chrome-write-hostile-error", { path: "bad.ts", content: "x" });
hostileWriteError.updateResult({ content: [{ type: "text", text: "boom\x1b(0\x1b]8;;https://evil.test\x07tail\x1b]8;;\x07" }], details: {}, isError: true } as any, false);
const hostileWriteErrorRaw = hostileWriteError.render(100).join("\n");
assert.doesNotMatch(hostileWriteErrorRaw, /\x1b\(0|https:\/\/evil\.test/, "Write errors are sanitized before error styling");

const hostileEditError = component(pi, "edit", "chrome-edit-hostile-error", { path: "bad.ts", oldText: "a", newText: "b" });
hostileEditError.updateResult({ content: [{ type: "text", text: "failed\x1b[31mred\x00" }], details: {}, isError: true } as any, false);
assert.doesNotMatch(hostileEditError.render(100).join("\n"), /\x1b\[31m|\x00/, "Edit errors are sanitized before error styling");

// --- Never-captured OpenAI-style surfaces, captured from Claude Code v2.1.211:
// docs/plans/2026-07-15-uncaptured-surfaces-grammar.md
const fetch = component(pi, "webfetch", "chrome-fetch", { url: "https://example.com" });
fetch.updateResult({ content: [{ type: "text", text: "hello" }], details: {}, isError: false } as any, false);
const fetchPlain = plainRender(fetch);
assert.match(fetchPlain, /^⏺ Fetch\(https:\/\/example\.com\)$/m);
assert.match(fetchPlain, /^ {2}⎿ {2}Received 5 bytes$/m);
assert.doesNotMatch(fetchPlain, /ctrl\+o to expand|lines returned/);

const webSearch = component(pi, "web_search", "chrome-web-search", { query: "Claude Code changelog 2026" });
webSearch.updateResult(
	{ content: [{ type: "text", text: "result one\nresult two" }], details: {}, isError: false } as any,
	false,
);
const webSearchPlain = plainRender(webSearch);
assert.match(webSearchPlain, /^⏺ Web Search\("Claude Code changelog 2026"\)$/m);
assert.match(webSearchPlain, /^ {2}⎿ {2}Did 1 search$/m);
assert.doesNotMatch(webSearchPlain, /ctrl\+o to expand|lines returned/);

const agentInFlight = component(pi, "Agent", "chrome-agent-in-flight", { description: "Count lines with 'fox'" });
agentInFlight.updateResult(
	{
		content: [{ type: "text", text: "0 tool uses..." }],
		details: {
			displayName: "Explore",
			description: "Count lines with 'fox'",
			subagentType: "Explore",
			toolUses: 0,
			tokens: "",
			turnCount: 1,
			durationMs: 80,
			status: "running",
			activity: "running command…",
			spinnerFrame: 1,
		},
		isError: false,
	} as any,
	true,
);
const agentInFlightPlain = plainRender(agentInFlight);
assert.match(agentInFlightPlain, /^⏺ Agent\(Count lines with 'fox'\)$/m);
assert.match(agentInFlightPlain, /^ {2}⎿ {2}Initializing…$/m);
assert.doesNotMatch(agentInFlightPlain, /Agent\.\.\.|running command|Running…|ctrl\+b/);

const agent = component(pi, "Agent", "chrome-agent", { description: "Count lines with 'fox'" });
agent.updateResult(
	{ content: [{ type: "text", text: "child result\nfinal response" }], details: {}, isError: false } as any,
	false,
);
const agentPlain = plainRender(agent);
assert.match(agentPlain, /^⏺ Agent\(Count lines with 'fox'\)$/m);
assert.match(agentPlain, /^ {2}⎿ {2}Done$/m);
assert.doesNotMatch(agentPlain, /ctrl\+o to expand|lines returned|child result|final response/);

// The shared collapsed OpenAI-style result path also drops the uncaptured hint.
const codeSearch = component(pi, "code_search", "chrome-code-search", { query: "render tool row" });
codeSearch.updateResult(
	{ content: [{ type: "text", text: "match one\nmatch two" }], details: {}, isError: false } as any,
	false,
);
const codeSearchPlain = plainRender(codeSearch);
assert.match(codeSearchPlain, /^ {2}⎿ {2}2 lines returned$/m);
assert.doesNotMatch(codeSearchPlain, /ctrl\+o to expand/);

const hostileGeneric = component(pi, "code_search", "chrome-code-search-hostile", { query: "find\x1b(0\nforged" });
hostileGeneric.updateResult({ content: [{ type: "text", text: "match\x1b]8;;https://evil.test\x07bad\x1b]8;;\x07" }], details: {}, isError: true } as any, false);
const hostileGenericRaw = hostileGeneric.render(100).join("\n");
assert.doesNotMatch(hostileGenericRaw, /\x1b\(0|https:\/\/evil\.test|\nforged/, "generic arguments and outputs are sanitized before renderer ANSI");
assert.doesNotMatch((hostileGeneric as any).getTextOutput(), /\x1b|https:\/\/evil\.test/, "native fallback text is sanitized before theme rendering");

// Expanded previews budget VISUAL rows. One 50KB minified logical line must
// not turn the transcript into hundreds of rows after wrapping.
const hugeLine = "x".repeat(50 * 1024);
initTheme("light", false);
const lightError = component(pi, "read", "chrome-light-error", { path: "missing-light.ts" });
lightError.updateResult({ content: [{ type: "text", text: "Error: missing" }], details: {}, isError: true } as any, false);
assert.ok(lightError.render(100).join("\n").includes("\x1b[38;2;175;95;95m"), "Claude light errors use captured xterm-131 equivalent");
initTheme("dark", false);
writeSettingsKey("expandedPreviewMaxLines", 150);
clearSettingsCache();

for (const [name, args] of [
	["read", { path: "dist/bundle.js" }],
	["grep", { pattern: "needle", path: "dist" }],
	["find", { pattern: "*", path: "dist" }],
	["ls", { path: "dist" }],
] as const) {
	const huge = component(pi, name, `huge-${name}`, args);
	huge.updateResult({ content: [{ type: "text", text: hugeLine }], details: {}, isError: false } as any, false);
	huge.setExpanded(true);
	const rows = huge.render(100);
	assert.ok(rows.length <= 157, `${name} huge logical line stays within the 150-row body ceiling plus host chrome, got ${rows.length}`);
	for (const line of rows) assert.ok(visibleWidth(line) <= 100, `${name} visual preview row fits width`);
}
writeSettingsKey("expandedPreviewMaxLines", undefined);
clearSettingsCache();

const fallbackLifecycle = component(pi, "code_search", "fallback-lifecycle", { query: "x" });
fallbackLifecycle.updateResult({ content: [{ type: "text", text: "unsafe\u202etail" }], details: {}, isError: false } as any, false);
assert.doesNotMatch((fallbackLifecycle as any).getTextOutput(), /\u202e/);
releaseToolFallbackSanitization();
const nativeAfterRelease = (ToolExecutionComponent.prototype as any).getTextOutput.call({
	result: { content: [{ type: "text", text: "unsafe\u202etail" }] },
	showImages: false,
});
assert.match(nativeAfterRelease, /\u202e/, "shutdown deactivates the fallback sanitizer delegate");
extension(pi as any);
assert.doesNotMatch((fallbackLifecycle as any).getTextOutput(), /\u202e/, "reload activates exactly the current fallback-sanitizer delegate");

console.log("tool chrome tests passed");
