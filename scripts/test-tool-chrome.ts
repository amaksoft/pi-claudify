import assert from "node:assert/strict";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension from "../extensions/index.ts";

// Chrome captured from Claude Code's raw TTY stream:
// docs/plans/2026-07-13-current-cc-grammar.md
const CC_DOT_PENDING = "\x1b[38;2;153;153;153m";
const CC_DOT_SUCCESS = "\x1b[38;2;78;186;101m";
const CC_DOT_ERROR = "\x1b[38;2;220;90;90m";
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

function component(pi: FakePi, name: string, id: string, args: any): ToolExecutionComponent {
	const tool = pi.tools.get(name);
	assert.ok(tool, `${name} tool registered`);
	const c = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		tool,
		{ requestRender() {}, previousLines: [] } as any,
		process.cwd(),
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

initTheme("dark", false);
const pi = new FakePi();
for (const name of ["webfetch", "web_search", "Agent", "code_search"]) {
	pi.registerTool({
		name,
		label: name,
		description: name,
		execute: async () => ({ content: [], details: {} }),
	});
}
extension(pi as any);

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

// The hyperlink must be zero-width to pi's own wrapper, or every row would wrap
// early and padding would drift.
const linked = `\x1b]8;;file:///tmp/a.ts\x07src/a.ts\x1b]8;;\x07`;
assert.equal(visibleWidth(linked), visibleWidth("src/a.ts"), "OSC 8 hyperlinks must measure zero-width");

const plain = readRaw.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "");
assert.match(plain, /^⏺ Read\(src\/a\.ts\)/m, "row reads as ⏺ Read(src/a.ts) once escapes are stripped");

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

console.log("tool chrome tests passed");
