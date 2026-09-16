import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import { getMarkdownTheme, initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { useSandboxHome } from "./sandbox-home.ts";

const sandbox = useSandboxHome("markdown-rendering");
const settingsPath = `${process.env.HOME}/.pi/settings.json`;
const { clearSettingsCache } = await import("../extensions/settings.ts");
const { DottedParagraph } = await import("../extensions/index.ts");

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const markdown = [
	"# Heading",
	"",
	"Paragraph with `inline()`.",
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
	return new DottedParagraph(markdown, getMarkdownTheme());
}

function plain(raw: string): string {
	return raw.replace(OSC_RE, "").replace(ANSI_RE, "");
}

initTheme("dark", false);

const claudeRaw = component().render(100).join("\n");
const claudePlain = plain(claudeRaw);
assert.match(claudeRaw, /\x1b\[38;5;153minline\(\)/, "Claude colors use captured xterm 153 for inline code");
assert.doesNotMatch(claudeRaw, /38;2;240;198;116mHeading/, "Claude colors do not inherit Pi's gold heading");
assert.doesNotMatch(claudePlain, /```/, "Claude Markdown hides fence rows");
assert.match(claudePlain, /^  ---$/m, "Claude Markdown keeps a literal horizontal rule");
assert.match(claudePlain, /^  ▎ quote[ \t]*$/m, "Claude Markdown uses the captured quote glyph");
assert.match(claudePlain, /^  │ A │ B │[ \t]*$/m, "quote conversion does not corrupt table borders");
assert.match(claudePlain, /^  const value = 42;[ \t]*$/m, "Claude Markdown dedents fenced code to two columns");

writeFileSync(settingsPath, JSON.stringify({ colorSource: "theme", markdownStyle: "pi" }));
clearSettingsCache();
const piRaw = component().render(100).join("\n");
const piPlain = plain(piRaw);
assert.match(piRaw, /38;2;240;198;116mHeading/, "Pi color source restores the active theme heading color");
assert.match(piPlain, /```ts/, "Pi-native Markdown keeps language fence rows");
assert.match(piPlain, /^  │ quote[ \t]*$/m, "Pi-native Markdown keeps Pi's quote glyph");
assert.doesNotMatch(piPlain, /^  ---$/m, "Pi-native Markdown keeps Pi's expanded rule");

void sandbox;
console.log("markdown rendering profile tests passed");
