import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Theme } from "@earendil-works/pi-coding-agent";
import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

// Grammar + captures: docs/plans/2026-07-16-cc-input-box-footer.md.
process.env.TZ = "UTC";

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
	parseAnthropicUsage,
	parseOpenAIUsage,
	patchEditorBorderColor,
	ProviderUsageSource,
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
	usageBar: true,
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
const HOT = "\x1b[38;5;160m";
const LEVEL_1 = "\x1b[38;5;22m";
const LEVEL_7 = "\x1b[38;5;172m";
const RESET = "\x1b[0m";
const SEP = `${GRAY} │ ${RESET}`;

const fullData = {
	directory: "claudify",
	branch: "master",
	modelName: "Fable 5",
	contextPercent: 10,
	usage: [
		{ label: "Usage", percent: 10, resetsAt: Date.UTC(2026, 6, 16, 18, 40) },
		{ label: "Week", percent: 70, resetsAt: Date.UTC(2026, 6, 16, 20, 0) },
	] as const,
};
const colored = { ...defaults } as const;

assert.equal(
	buildFooterLine(fullData, colored),
	`  ${BLUE}claudify${RESET}${SEP}${GREEN}⎇ master${RESET}${SEP}${YELLOW}Fable 5${RESET}${SEP}`
		+ `${CYAN}Ctx: 10%${RESET}${SEP}${LEVEL_1}Usage: 10% ▓░░░░░░░░░ → Reset: 06:40 PM${RESET}${SEP}`
		+ `${LEVEL_7}Week: 70% ▓▓▓▓▓▓▓░░░ → Reset: 08:00 PM${RESET}`,
	"colored mode reproduces the captured context and provider-usage grammar",
);

// Context threshold tiers (≤50 cyan, ≤75 yellow, >75 the script's LEVEL_9 red).
assert.match(buildFooterLine({ ...fullData, contextPercent: 50 }, colored), /\x1b\[0;36mCtx: 50%/);
assert.match(buildFooterLine({ ...fullData, contextPercent: 60 }, colored), /\x1b\[0;33mCtx: 60%/);
assert.ok(buildFooterLine({ ...fullData, contextPercent: 90 }, colored).includes(`${HOT}Ctx: 90%`));
assert.match(buildFooterLine({ ...fullData, contextPercent: 100 }, colored), /Ctx: 100%/);
assert.match(buildFooterLine({ ...fullData, contextPercent: 2.9 }, colored), /Ctx: 2%/, "context percent floors like the script's integer math");
assert.match(buildFooterLine({ ...fullData, contextPercent: null }, colored), /\x1b\[0;36mCtx: \?/, "unknown context renders as ?");
assert.doesNotMatch(buildFooterLine(fullData, colored), /Ctx: 10% [▓░]/, "the quota bar does not attach to context");

// Optional segments drop out instead of leaving separators behind.
const noBranch = buildFooterLine({ ...fullData, branch: null, usage: [] }, colored);
assert.doesNotMatch(noBranch, /⎇|Usage|Week|Effort/);
assert.equal(noBranch.split(" │ ").length, 3, "dir, model, context only");

// Bar toggle applies to quota windows, not context.
const noUsageBar = buildFooterLine(fullData, { ...colored, usageBar: false });
assert.match(noUsageBar, /Usage: 10% → Reset: 06:40 PM/);
assert.doesNotMatch(noUsageBar, /[▓░]/, "no quota bar when usageBar is off");

// Single-color mode paints every segment with the configured truecolor.
const single = buildFooterLine(fullData, { ...colored, colorMode: "single", color: "#FF9200" });
const ORANGE = "\x1b[38;2;255;146;0m";
assert.ok(single.startsWith(`  ${ORANGE}claudify${RESET}`));
assert.equal((single.match(/\x1b\[38;2;255;146;0m/g) ?? []).length, 11, "6 segments + 5 separators, all orange");
assert.doesNotMatch(single, /\x1b\[0;3[0-9]m/, "no classic palette codes leak into single mode");

// Monochrome mode emits no SGR at all.
const mono = buildFooterLine(fullData, { ...colored, colorMode: "monochrome" });
assert.doesNotMatch(mono, /\x1b/);
assert.equal(
	mono,
	"  claudify │ ⎇ master │ Fable 5 │ Ctx: 10% │ Usage: 10% ▓░░░░░░░░░ → Reset: 06:40 PM │ Week: 70% ▓▓▓▓▓▓▓░░░ → Reset: 08:00 PM",
);
assert.match(
	buildFooterLine({ ...fullData, usage: [{ label: "Usage", percent: null, resetsAt: null }] }, { ...colored, colorMode: "monochrome" }),
	/ │ Usage: ~$/,
	"unavailable quota renders a compact placeholder without a fake bar or reset",
);

// --- Provider response parsing + OAuth-only in-memory source -----------------

assert.deepEqual(
	parseAnthropicUsage({
		five_hour: { utilization: 23.5, resets_at: "2026-07-16T18:40:00Z" },
		seven_day: { utilization: 61, resets_at: "2026-07-20T20:00:00Z" },
		seven_day_opus: { utilization: 99, resets_at: "2026-07-20T21:00:00Z" },
	}),
	[
		{ label: "Usage", percent: 24, resetsAt: Date.UTC(2026, 6, 16, 18, 40) },
		{ label: "Week", percent: 61, resetsAt: Date.UTC(2026, 6, 20, 20, 0) },
	],
	"Anthropic renders current + general weekly windows and omits family-specific extras",
);
// CLFY-25: the live Anthropic shape (2026-07-17 capture) parses correctly — the
// reported "Week: ~" did NOT originate here. Uses the real field format:
// float utilization and a microsecond ISO timestamp with an explicit +00:00 offset.
assert.deepEqual(
	parseAnthropicUsage({
		five_hour: { utilization: 49.0, resets_at: "2026-07-17T18:09:59.657922+00:00" },
		seven_day: { utilization: 4.0, resets_at: "2026-07-24T15:59:59.657953+00:00" },
		seven_day_opus: null,
		limits: [{ kind: "weekly_all", group: "weekly", percent: 4 }],
	}),
	[
		{ label: "Usage", percent: 49, resetsAt: Date.parse("2026-07-17T18:09:59.657922+00:00") },
		{ label: "Week", percent: 4, resetsAt: Date.parse("2026-07-24T15:59:59.657953+00:00") },
	],
	"Anthropic parses the live capture shape, including a populated seven_day weekly window",
);
assert.deepEqual(
	parseOpenAIUsage({
		rate_limit: {
			primary_window: { used_percent: 5, reset_at: 1_768_500_000, limit_window_seconds: 18_000 },
			secondary_window: { used_percent: 42, reset_at: 1_768_900_000, limit_window_seconds: 604_800 },
		},
	}),
	[{ label: "Week", percent: 42, resetsAt: 1_768_900_000_000 }],
	"OpenAI renders its weekly secondary window only",
);
// CLFY-25: on some plans (observed "prolite", 2026-07-17 capture) secondary_window
// is null and the 7-day window IS primary_window. Reading secondary_window
// unconditionally rendered a permanent "~". Verbatim captured shape:
assert.deepEqual(
	parseOpenAIUsage({
		rate_limit: {
			primary_window: { used_percent: 16, limit_window_seconds: 604_800, reset_after_seconds: 504_192, reset_at: 1_784_815_409 },
			secondary_window: null,
		},
	}),
	[{ label: "Week", percent: 16, resetsAt: 1_784_815_409_000 }],
	"OpenAI reads primary_window as Week when it is the 7-day window and secondary_window is null",
);
// A 5-hour-only window must not be mislabeled "Week" — it is not weekly.
assert.deepEqual(
	parseOpenAIUsage({
		rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18_000, reset_at: 1_768_500_000 }, secondary_window: null },
	}),
	[],
	"OpenAI omits Week when only a sub-weekly window is reported, rather than mislabeling it",
);

let activeModel = { provider: "anthropic", id: "claude-fable-5" };
let fetchCount = 0;
let rerenders = 0;
const openAIAccountPayload = Buffer.from(JSON.stringify({
	"https://api.openai.com/auth": { chatgpt_account_id: "account-test" },
})).toString("base64url");
const openAITestToken = `header.${openAIAccountPayload}.signature`;
const requestedTokens: string[] = [];
const requestedAccounts: string[] = [];
const requestedUrls: string[] = [];
const usageSource = new ProviderUsageSource({
	getModel: () => activeModel,
	modelRegistry: {
		isUsingOAuth: () => true,
		async getApiKeyForProvider(provider) {
			return provider === "openai-codex" ? openAITestToken : "test-oauth-token";
		},
	},
	async fetcher(url: string | URL | Request, init?: RequestInit) {
		fetchCount += 1;
		requestedUrls.push(String(url));
		const headers = new Headers(init?.headers);
		requestedTokens.push(headers.get("authorization") ?? "");
		requestedAccounts.push(headers.get("chatgpt-account-id") ?? "");
		if (String(url).includes("anthropic.com")) {
			return new Response(JSON.stringify({
				five_hour: { utilization: 12, resets_at: "2026-07-16T18:40:00Z" },
			}), { status: 200 });
		}
		return new Response(JSON.stringify({
			rate_limit: { secondary_window: { used_percent: 56, reset_at: 1_768_900_000 } },
		}), { status: 200 });
	},
	onUpdate: () => { rerenders += 1; },
});
assert.deepEqual(
	usageSource.getUsage(),
	[{ label: "Usage", percent: null, resetsAt: null }, { label: "Week", percent: null, resetsAt: null }],
	"supported OAuth providers render placeholders while loading",
);
await usageSource.refresh();
assert.deepEqual(usageSource.getUsage().map(({ label, percent }) => ({ label, percent })), [
	{ label: "Usage", percent: 12 },
	{ label: "Week", percent: null },
], "a partial Anthropic response retains the missing weekly placeholder");
assert.equal(fetchCount, 1);
assert.equal(rerenders, 1);
assert.deepEqual(requestedUrls, ["https://api.anthropic.com/api/oauth/usage"]);
assert.deepEqual(requestedTokens, ["Bearer test-oauth-token"], "the resolved token is used only on the request");
assert.deepEqual(requestedAccounts, [""], "Anthropic requests do not receive OpenAI account metadata");
await usageSource.refresh();
assert.equal(fetchCount, 1, "fresh non-sensitive quota data is reused from memory");

activeModel = { provider: "openai-codex", id: "gpt-5.4" };
await usageSource.refresh();
assert.deepEqual(usageSource.getUsage().map(({ label, percent }) => ({ label, percent })), [
	{ label: "Week", percent: 56 },
]);
assert.equal(fetchCount, 2, "changing active provider selects a separate quota source");
assert.deepEqual(requestedUrls, [
	"https://api.anthropic.com/api/oauth/usage",
	"https://chatgpt.com/backend-api/wham/usage",
]);
assert.equal(requestedTokens[1], `Bearer ${openAITestToken}`);
assert.deepEqual(requestedAccounts, ["", "account-test"], "OpenAI receives the account id derived from pi's OAuth token");

const apiKeySource = new ProviderUsageSource({
	getModel: () => ({ provider: "anthropic", id: "claude-fable-5" }),
	modelRegistry: {
		isUsingOAuth: () => false,
		async getApiKeyForProvider() { throw new Error("must not resolve API keys for quota"); },
	},
	async fetcher() { throw new Error("must not fetch quota in API-key mode"); },
	onUpdate: () => {},
});
assert.deepEqual(apiKeySource.getUsage(), [], "API-key auth never fetches subscription quota");

let switchingModel = { provider: "anthropic", id: "claude-fable-5" };
let releaseObsoleteToken: (token: string | undefined) => void = () => {};
const switchedRequestUrls: string[] = [];
const switchingSource = new ProviderUsageSource({
	getModel: () => switchingModel,
	modelRegistry: {
		isUsingOAuth: () => true,
		async getApiKeyForProvider(provider) {
			if (provider === "anthropic") {
				return new Promise<string | undefined>((resolve) => { releaseObsoleteToken = resolve; });
			}
			return openAITestToken;
		},
	},
	async fetcher(url) {
		switchedRequestUrls.push(String(url));
		return new Response(JSON.stringify({
			rate_limit: { secondary_window: { used_percent: 11, reset_at: 1_768_900_000 } },
		}), { status: 200 });
	},
	onUpdate: () => {},
});
const obsoleteRefresh = switchingSource.refresh();
switchingModel = { provider: "openai-codex", id: "gpt-5.4" };
await switchingSource.refresh();
releaseObsoleteToken("obsolete-token");
await obsoleteRefresh;
assert.deepEqual(
	switchedRequestUrls,
	["https://chatgpt.com/backend-api/wham/usage"],
	"switching providers before credential resolution prevents the obsolete authenticated request",
);

let releaseDisposedToken: (token: string | undefined) => void = () => {};
let disposedFetches = 0;
const disposalSource = new ProviderUsageSource({
	getModel: () => ({ provider: "anthropic", id: "claude-fable-5" }),
	modelRegistry: {
		isUsingOAuth: () => true,
		async getApiKeyForProvider() {
			return new Promise<string | undefined>((resolve) => { releaseDisposedToken = resolve; });
		},
	},
	async fetcher() {
		disposedFetches += 1;
		return new Response("{}", { status: 200 });
	},
	onUpdate: () => {},
});
const disposedRefresh = disposalSource.refresh();
disposalSource.dispose();
releaseDisposedToken("obsolete-token");
await disposedRefresh;
assert.equal(disposedFetches, 0, "disposing the footer prevents a pending credential lookup from launching a request");

// --- ClaudeFooterComponent: statuses survive the footer replacement ----------

setSettings({ footerColorMode: "monochrome" });
const statuses = new Map([["zeta", "z status"], ["alpha", "a\tstatus\nline"], ["mcp", "\x1b[38;2;138;190;183mMCP: 0/8 servers\x1b[39m"]]);
const fakeFooterData = { getGitBranch: () => "main", getExtensionStatuses: () => statuses };
const component = new ClaudeFooterComponent(fakeFooterData, {
	getDirectory: () => "project",
	getBranch: (data) => data.getGitBranch(),
	getModelName: () => "Fable 5",
	getContextPercent: () => 25,
	getUsage: () => [{ label: "Week", percent: 50, resetsAt: Date.UTC(2026, 6, 20, 20, 0) }],
});
const rendered = component.render(200);
assert.equal(rendered[0], "  project │ ⎇ main │ Fable 5 │ Ctx: 25% │ Week: 50% ▓▓▓▓▓░░░░░ → Reset: 08:00 PM");
assert.deepEqual(rendered.slice(1), ["  a status line", "  MCP: 0/8 servers", "  z status"], "extension statuses render sorted, sanitized, and stripped of baked colors");
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

installClaudeFooter(fakeCtx);
assert.equal(setFooterCalls.length, 1);
assert.equal(typeof setFooterCalls[0], "function", "claude style installs a footer factory");
const installed = (setFooterCalls[0] as (t: unknown, th: unknown, fd: unknown) => { render(width: number): string[] })(
	{ requestRender: () => {} },
	undefined,
	{ getGitBranch: () => null, getExtensionStatuses: () => new Map() },
);
const liveLine = installed.render(200)[0].replace(/\x1b\[[0-9;]*m/g, "");
assert.equal(liveLine, "  workspace │ Fable 5 │ Ctx: 2%", "live sources feed directory, model, and model-aware context");

setSettings({ footerStyle: "pi" });
installClaudeFooter(fakeCtx);
assert.equal(setFooterCalls[1], undefined, "pi style restores the stock footer via setFooter(undefined)");

const noUiCalls = setFooterCalls.length;
installClaudeFooter({ hasUI: false, ui: { setFooter: (f: unknown) => setFooterCalls.push(f) } });
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
for (const label of ["Footer style", "Color mode", "Color", "Usage bar", "Input border"]) {
	assert.match(sectionText, new RegExp(label), `Footer section shows the "${label}" row`);
}
assert.match(sectionText, /#FF9200/, "the color row shows the default hex");

// Row order: style, color mode, color, usage bar, input border → Color is index 2.
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
