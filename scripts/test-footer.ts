import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Theme } from "@earendil-works/pi-coding-agent";
import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

// Grammar + captures: docs/plans/2026-07-16-cc-input-box-footer.md.

const sandbox = mkdtempSync(join(tmpdir(), "claudify-footer-"));
const home = join(sandbox, "home");
const settingsPath = join(home, ".pi", "settings.json");
mkdirSync(join(home, ".pi"), { recursive: true });
writeFileSync(settingsPath, "{}\n");
process.env.HOME = home;

const {
	ClaudeFooterComponent,
	DEFAULT_FOOTER_COLOR,
	buildFooterLine,
	installClaudeFooter,
	normalizeHexColor,
	patchEditorBorderColor,
	resolveFooterSettings,
} = await import("../extensions/footer.ts");
const { clearSettingsCache } = await import("../extensions/settings.ts");
const { ClaudifyScreen, CLAUDIFY_SECTIONS } = await import("../extensions/claudify-screen.ts");

function setSettings(values: Record<string, unknown>): void {
	writeFileSync(settingsPath, JSON.stringify(values));
	clearSettingsCache();
}

initTheme("dark", false);

// --- normalizeHexColor -------------------------------------------------------

assert.equal(normalizeHexColor("#ff9200"), "#FF9200");
assert.equal(normalizeHexColor("  FF9200 "), "#FF9200");
assert.equal(normalizeHexColor("#FF92"), null, "short hex is rejected");
assert.equal(normalizeHexColor("#ff92001"), null, "long hex is rejected");
assert.equal(normalizeHexColor("orange"), null, "named colors are rejected");
assert.equal(DEFAULT_FOOTER_COLOR, "#FF9200");

// --- resolveFooterSettings ---------------------------------------------------

const defaults = resolveFooterSettings({});
assert.deepEqual(defaults, {
	style: "claude",
	colorMode: "colored",
	color: "#FF9200",
	contextBar: true,
	editorBorder: "gray",
});
assert.equal(resolveFooterSettings({ footerColor: "not-a-color" }).color, DEFAULT_FOOTER_COLOR, "invalid stored hex falls back");
assert.equal(resolveFooterSettings({ footerStyle: "pi" }).style, "pi");
assert.equal(resolveFooterSettings({ editorBorder: "thinking" }).editorBorder, "thinking");

// --- buildFooterLine: the statusline script's grammar, byte-for-byte ---------

const BLUE = "\x1b[0;34m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[0;33m";
const CYAN = "\x1b[0;36m";
const GRAY = "\x1b[0;90m";
const MAGENTA = "\x1b[0;35m";
const HOT = "\x1b[38;5;160m";
const RESET = "\x1b[0m";
const SEP = `${GRAY} │ ${RESET}`;

const fullData = { directory: "claudify", branch: "master", modelName: "Fable 5", contextPercent: 10, effort: "high" };
const colored = { ...defaults } as const;

assert.equal(
	buildFooterLine(fullData, colored),
	`  ${BLUE}claudify${RESET}${SEP}${GREEN}⎇ master${RESET}${SEP}${YELLOW}Fable 5${RESET}${SEP}`
		+ `${CYAN}Ctx: 10% ▓░░░░░░░░░${RESET}${SEP}${MAGENTA}Effort: high${RESET}`,
	"colored mode reproduces the script's palette, separators, indent, and bar",
);

// Context threshold tiers (≤50 cyan, ≤75 yellow, >75 the script's LEVEL_9 red).
assert.match(buildFooterLine({ ...fullData, contextPercent: 50 }, colored), /\x1b\[0;36mCtx: 50%/);
assert.match(buildFooterLine({ ...fullData, contextPercent: 60 }, colored), /\x1b\[0;33mCtx: 60%/);
assert.ok(buildFooterLine({ ...fullData, contextPercent: 90 }, colored).includes(`${HOT}Ctx: 90% ▓▓▓▓▓▓▓▓▓░`));
assert.match(buildFooterLine({ ...fullData, contextPercent: 100 }, colored), /Ctx: 100% ▓▓▓▓▓▓▓▓▓▓/);
assert.match(buildFooterLine({ ...fullData, contextPercent: 2.9 }, colored), /Ctx: 2% ░░░░░░░░░░/, "percent floors like the script's integer math");
assert.match(buildFooterLine({ ...fullData, contextPercent: null }, colored), /\x1b\[0;36mCtx: \? ░░░░░░░░░░/, "unknown tokens render as ? with an empty bar");

// Optional segments drop out instead of leaving separators behind.
const noBranch = buildFooterLine({ ...fullData, branch: null, effort: null }, colored);
assert.doesNotMatch(noBranch, /⎇|Effort/);
assert.equal(noBranch.split(" │ ").length, 3, "dir, model, context only");

// Bar toggle.
assert.match(buildFooterLine(fullData, { ...colored, contextBar: false }), /Ctx: 10%\x1b\[0m/, "no bar when contextBar is off");

// Single-color mode paints every segment with the configured truecolor.
const single = buildFooterLine(fullData, { ...colored, colorMode: "single", color: "#FF9200" });
const ORANGE = "\x1b[38;2;255;146;0m";
assert.ok(single.startsWith(`  ${ORANGE}claudify${RESET}`));
assert.equal((single.match(/\x1b\[38;2;255;146;0m/g) ?? []).length, 9, "5 segments + 4 separators, all orange");
assert.doesNotMatch(single, /\x1b\[0;3[0-9]m/, "no classic palette codes leak into single mode");

// Monochrome mode emits no SGR at all.
const mono = buildFooterLine(fullData, { ...colored, colorMode: "monochrome" });
assert.doesNotMatch(mono, /\x1b/);
assert.equal(mono, "  claudify │ ⎇ master │ Fable 5 │ Ctx: 10% ▓░░░░░░░░░ │ Effort: high");

// --- ClaudeFooterComponent: statuses survive the footer replacement ----------

setSettings({ footerColorMode: "monochrome" });
const statuses = new Map([["zeta", "z status"], ["alpha", "a\tstatus\nline"]]);
const fakeFooterData = { getGitBranch: () => "main", getExtensionStatuses: () => statuses };
const component = new ClaudeFooterComponent(fakeFooterData, {
	getDirectory: () => "project",
	getBranch: (data) => data.getGitBranch(),
	getModelName: () => "Fable 5",
	getContextPercent: () => 25,
	getEffort: () => "xhigh",
});
const rendered = component.render(200);
assert.equal(rendered[0], "  project │ ⎇ main │ Fable 5 │ Ctx: 25% ▓▓▓░░░░░░░ │ Effort: xhigh");
assert.deepEqual(rendered.slice(1), ["  a status line", "  z status"], "extension statuses render sorted and sanitized");
assert.ok(component.render(20)[0].replace(/\x1b\[[0-9;]*m/g, "").length <= 20, "lines truncate to the viewport");

// --- installClaudeFooter ------------------------------------------------------

setSettings({});
const setFooterCalls: unknown[] = [];
const fakeCtx = {
	hasUI: true,
	ui: { setFooter: (factory: unknown) => setFooterCalls.push(factory) },
	sessionManager: { getCwd: () => join(sandbox, "workspace") },
	model: { name: "Fable 5", id: "claude-fable-5", reasoning: true },
	getContextUsage: () => ({ tokens: 5_000, contextWindow: 200_000, percent: 2.5 }),
};
const fakePi = { getThinkingLevel: () => "high" };

installClaudeFooter(fakeCtx, fakePi);
assert.equal(setFooterCalls.length, 1);
assert.equal(typeof setFooterCalls[0], "function", "claude style installs a footer factory");
const installed = (setFooterCalls[0] as (t: unknown, th: unknown, fd: unknown) => { render(width: number): string[] })(
	undefined,
	undefined,
	{ getGitBranch: () => null, getExtensionStatuses: () => new Map() },
);
const liveLine = installed.render(200)[0].replace(/\x1b\[[0-9;]*m/g, "");
assert.equal(liveLine, "  workspace │ Fable 5 │ Ctx: 2% ░░░░░░░░░░ │ Effort: high", "live sources feed dir, model, context, and effort");

setSettings({ footerStyle: "pi" });
installClaudeFooter(fakeCtx, fakePi);
assert.equal(setFooterCalls[1], undefined, "pi style restores the stock footer via setFooter(undefined)");

const noUiCalls = setFooterCalls.length;
installClaudeFooter({ hasUI: false, ui: { setFooter: (f: unknown) => setFooterCalls.push(f) } }, fakePi);
assert.equal(setFooterCalls.length, noUiCalls, "no UI, no footer install");

// --- patchEditorBorderColor: pinned gray, live-reflecting, idempotent --------

setSettings({});
patchEditorBorderColor();
const patched = (Theme.prototype as any).getThinkingBorderColor;
patchEditorBorderColor();
assert.equal((Theme.prototype as any).getThinkingBorderColor, patched, "border patch is idempotent");

const colorize = theme.getThinkingBorderColor("high");
assert.equal(colorize("─"), theme.fg("borderMuted", "─"), "gray mode pins the border to borderMuted at every thinking level");
assert.equal(theme.getThinkingBorderColor("max")("─"), theme.fg("borderMuted", "─"));

setSettings({ editorBorder: "thinking" });
assert.equal(colorize("─"), theme.fg("thinkingHigh", "─"), "the same colorizer reflects the setting change live");
setSettings({});
assert.equal(colorize("─"), theme.fg("borderMuted", "─"));

// --- Claudify screen: Footer section rows + hex validation -------------------

assert.ok(CLAUDIFY_SECTIONS.some((section) => section.id === "footer"), "the Hub lists a Footer section");

const notices: string[] = [];
const changed: Array<[string, unknown]> = [];
const screen = new ClaudifyScreen(
	{ requestRender: () => {} } as any,
	theme,
	{
		matches: (data: string, action: string) =>
			(action === "tui.select.up" && data === "up")
			|| (action === "tui.select.down" && data === "down")
			|| (action === "tui.select.confirm" && data === "enter")
			|| (action === "tui.select.cancel" && data === "escape"),
	},
	() => {},
	(key, value) => changed.push([key, value]),
	undefined,
	{ diffThemes: [], colorKeys: [] },
	(message) => notices.push(message),
);

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");
const footerIndex = CLAUDIFY_SECTIONS.findIndex((section) => section.id === "footer");
for (let i = 0; i < footerIndex; i += 1) screen.handleInput("down");
screen.handleInput("enter");
const sectionText = stripAnsi(screen.render(100).join("\n"));
for (const label of ["Footer style", "Color mode", "Color", "Context bar", "Input border"]) {
	assert.match(sectionText, new RegExp(label), `Footer section shows the "${label}" row`);
}
assert.match(sectionText, /#FF9200/, "the color row shows the default hex");

// Row order: style, color mode, color, context bar, input border → Color is index 2.
screen.handleInput("down");
screen.handleInput("down");
screen.handleInput("enter");
for (const char of "zzz") screen.handleInput(char);
screen.handleInput("enter");
assert.equal(notices.at(-1), "Enter a hex color like #FF9200.", "invalid hex is rejected with a notice");
assert.doesNotMatch(readFileSync(settingsPath, "utf8"), /footerColor/, "rejected input writes nothing");

screen.handleInput("enter");
for (const char of "00bfff") screen.handleInput(char);
screen.handleInput("enter");
assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).footerColor, "#00BFFF", "valid hex commits normalized");
assert.deepEqual(changed.at(-1), ["footerColor", "#00BFFF"], "the commit reaches onSettingChange for live reflection");

console.log("footer and input-border tests passed");
