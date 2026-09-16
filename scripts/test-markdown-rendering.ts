import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { useSandboxHome } from "./sandbox-home.ts";

const sandbox = useSandboxHome("markdown-rendering");
const settingsPath = `${process.env.HOME}/.pi/settings.json`;
const { clearSettingsCache } = await import("../extensions/settings.ts");
const { default: claudify, DottedParagraph, ThinkingParagraph } = await import("../extensions/index.ts");

class FakePi {
	tools = new Map<string, any>();
	commands = new Map<string, any>();
	events = new Map<string, any[]>();
	registerTool(definition: any): void { this.tools.set(definition.name, definition); }
	registerCommand(name: string, command: any): void { this.commands.set(name, command); }
	on(name: string, handler: any): void { this.events.set(name, [...(this.events.get(name) ?? []), handler]); }
	getAllTools(): any[] { return [...this.tools.values()]; }
	getThinkingLevel(): string { return "off"; }
}
// Wires DottedParagraph/ThinkingParagraph's Markdown/visibleWidth runtime (see
// extensions/render/message-components.ts's configureMessageComponents) before
// any paragraph is constructed below.
claudify(new FakePi() as any);

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const markdown = [
	"# Heading",
	"",
	"Paragraph with `inline()` and a [named link](https://example.com/docs).",
	"",
	"> quote",
	"",
	"- item",
	"",
	"---",
	"",
	"| A | B |",
	"| --- | --- |",
	"| x | y |",
	"",
	"```ts",
	"const value = 42;",
	"```",
].join("\n");

function component(): InstanceType<typeof DottedParagraph> {
	const markdownTheme = getMarkdownTheme();
	return new DottedParagraph(markdown, {
		...markdownTheme,
		// Chalk disables style escapes in this non-TTY unit process. Supply the
		// same SGR explicitly so H1's source-level emphasis remains assertable.
		italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
	});
}

function plain(raw: string): string {
	return raw.replace(OSC_RE, "").replace(ANSI_RE, "");
}

initTheme("dark", false);

const claudeRaw = component().render(100).join("\n");
const claudePlain = plain(claudeRaw);
assert.match(claudeRaw, /\x1b\[38;5;153minline\(\)/, "Claude colors use captured xterm 153 for inline code");
assert.doesNotMatch(claudeRaw, /38;2;240;198;116mHeading/, "Claude colors do not inherit Pi's gold heading");
const complexHeading = new DottedParagraph("# Heading with \\*literal\\* [link](https://example.com) `code` #", getMarkdownTheme());
const complexPlain = plain(complexHeading.render(100).join("\n"));
assert.match(complexPlain, /Heading with \*literal\* link code/, "Claude mode preserves native H1 Markdown semantics instead of rewriting source emphasis");
assert.doesNotMatch(claudePlain, /```/, "Claude Markdown hides fence rows");
assert.match(claudePlain, /^  ---[ \t]*$/m, "Claude Markdown keeps a literal horizontal rule");
assert.match(claudePlain, /^  ▎ quote[ \t]*$/m, "Claude Markdown uses the captured quote glyph");
assert.match(claudePlain, /^  │ A │ B │[ \t]*$/m, "quote conversion does not corrupt table borders");
assert.match(claudePlain, /^  const value = 42;[ \t]*$/m, "Claude Markdown dedents fenced code to two columns");
assert.ok(claudeRaw.includes("\x1b]8;;https://example.com/docs\x1b\\"), "named links retain Pi's OSC-8 target");
assert.doesNotMatch(claudePlain, /named link \(https:\/\/example\.com\/docs\)/, "named links hide the URL suffix like Claude");
const literalGlyphs = plain(new DottedParagraph("````text\n```\nliteral\n````\n\n────\n\n│ value", getMarkdownTheme()).render(100).join("\n"));
assert.match(literalGlyphs, /```/, "literal triple-backtick code content is not mistaken for a fence row");
assert.match(literalGlyphs, /────/, "literal rule glyph text is not rewritten as Markdown HR");
assert.match(literalGlyphs, /│ value/, "literal single-pipe text is not rewritten as a quote");

const hostAssistant = new AssistantMessageComponent({
	role: "assistant",
	content: [{ type: "text", text: "> packed quote\n\n```ts\nconst packed = 1;\n```" }],
	stopReason: "stop",
} as any, false);
const hostAssistantPlain = plain(hostAssistant.render(100).join("\n"));
assert.match(hostAssistantPlain, /▎ packed quote/, "structural Markdown detection works when coding-agent owns a different pi-tui copy");
assert.doesNotMatch(hostAssistantPlain, /```/, "packed-topology host Markdown is replaced by the Claude profile");

const mountedThinking = new ThinkingParagraph("> thought quote\n\n---\n\n```ts\nconst thought = 1;\n```", getMarkdownTheme(), { italic: true });
const claudeThinking = plain(mountedThinking.render(100).join("\n"));
assert.match(claudeThinking, /▎ thought quote/);
assert.doesNotMatch(claudeThinking, /```/);

writeFileSync(settingsPath, JSON.stringify({ colorSource: "theme", markdownStyle: "pi" }));
clearSettingsCache();
const piRaw = component().render(100).join("\n");
const piPlain = plain(piRaw);
assert.match(piRaw, /38;2;240;198;116mHeading/, "Pi color source restores the active theme heading color");
assert.match(piPlain, /```ts/, "Pi-native Markdown keeps language fence rows");
assert.match(piPlain, /^  │ quote[ \t]*$/m, "Pi-native Markdown keeps Pi's quote glyph");
assert.doesNotMatch(piPlain, /^  ---$/m, "Pi-native Markdown keeps Pi's expanded rule");
const piThinking = plain(mountedThinking.render(100).join("\n"));
assert.match(piThinking, /```ts/, "mounted thinking block observes live Pi Markdown style");
assert.match(piThinking, /│ thought quote/, "Pi thinking style restores the native quote marker");

void sandbox;
console.log("markdown rendering profile tests passed");
