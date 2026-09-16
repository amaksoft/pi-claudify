import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isBundledClaudeTheme } from "../extensions/index.ts";

const root = join(import.meta.dir, "..");
const themeDir = join(root, "theme");
const expected = [
	"claude-code-dark-ansi",
	"claude-code-dark-daltonized",
	"claude-code-dark",
	"claude-code-light-ansi",
	"claude-code-light-daltonized",
	"claude-code-light",
];
const requiredColors = [
	"accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text", "thinkingText",
	"scrollbarTrack", "scrollbarThumb", "selectedBg", "userMessageBg", "userMessageText", "customMessageBg", "customMessageText",
	"customMessageLabel", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput", "mdHeading", "mdLink", "mdLinkUrl",
	"mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet", "toolDiffAdded",
	"toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
	"syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation", "thinkingOff", "thinkingMinimal", "thinkingLow",
	"thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode",
];

const files = readdirSync(themeDir).filter((name) => name.endsWith(".json")).sort();
const themes = files.map((file) => JSON.parse(readFileSync(join(themeDir, file), "utf8")));
assert.deepEqual(themes.map((theme) => theme.name).sort(), [...expected].sort(), "all six Claude Code themes ship exactly once");
for (const theme of themes) {
	assert.ok(isBundledClaudeTheme(theme), `${theme.name} is recognized by color-ownership policy`);
	for (const key of requiredColors) assert.ok(Object.hasOwn(theme.colors, key), `${theme.name} defines ${key}`);
	for (const [key, value] of Object.entries(theme.colors)) {
		assert.ok(typeof value === "string" || typeof value === "number", `${theme.name}.${key} is a valid theme value`);
	}
}
assert.equal(isBundledClaudeTheme({ name: "dark" }), false, "built-in/non-Claude themes keep existing claudify defaults");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.deepEqual(pkg.pi?.themes, ["./theme"], "package exposes themes through Pi's native theme discovery");
assert.ok(pkg.files?.includes("theme"), "published package includes theme assets and attribution");
assert.ok(readFileSync(join(themeDir, "LICENSE"), "utf8").includes("Copyright (c) 2026 Demo-0416"));

console.log("theme package and ownership tests passed");
