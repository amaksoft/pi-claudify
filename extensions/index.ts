import { existsSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type {
	EditToolDetails,
	ExtensionAPI,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	AssistantMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	Container,
	deleteAllKittyImages,
	getCapabilities,
	Markdown,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import * as Diff from "diff";
import { getSingletonHighlighter, type BundledLanguage, type BundledTheme } from "shiki";
import bashLanguage from "@shikijs/langs/bash";
import cLanguage from "@shikijs/langs/c";
import cppLanguage from "@shikijs/langs/cpp";
import csharpLanguage from "@shikijs/langs/csharp";
import cssLanguage from "@shikijs/langs/css";
import dartLanguage from "@shikijs/langs/dart";
import goLanguage from "@shikijs/langs/go";
import graphqlLanguage from "@shikijs/langs/graphql";
import htmlLanguage from "@shikijs/langs/html";
import javaLanguage from "@shikijs/langs/java";
import javascriptLanguage from "@shikijs/langs/javascript";
import jsonLanguage from "@shikijs/langs/json";
import jsxLanguage from "@shikijs/langs/jsx";
import kotlinLanguage from "@shikijs/langs/kotlin";
import luaLanguage from "@shikijs/langs/lua";
import markdownLanguage from "@shikijs/langs/markdown";
import phpLanguage from "@shikijs/langs/php";
import pythonLanguage from "@shikijs/langs/python";
import rubyLanguage from "@shikijs/langs/ruby";
import rustLanguage from "@shikijs/langs/rust";
import scssLanguage from "@shikijs/langs/scss";
import sqlLanguage from "@shikijs/langs/sql";
import svelteLanguage from "@shikijs/langs/svelte";
import swiftLanguage from "@shikijs/langs/swift";
import tomlLanguage from "@shikijs/langs/toml";
import tsxLanguage from "@shikijs/langs/tsx";
import typescriptLanguage from "@shikijs/langs/typescript";
import vueLanguage from "@shikijs/langs/vue";
import xmlLanguage from "@shikijs/langs/xml";
import yamlLanguage from "@shikijs/langs/yaml";
import monokaiTheme from "@shikijs/themes/monokai";

import { registerBanner } from "./banner.ts";
import { CLAUDE_PALETTE } from "./claude-palette.ts";
import { effectiveAgentDir, forwardedToolContract, hostToolSettings, skippedToolOverrides } from "./builtin-contracts.ts";
import { ClaudifyScreen } from "./claudify-screen.ts";
import { debugDiagnostic } from "./debug.ts";
import { bumpDiffPresentationEpoch, diffCard } from "./diff-card.ts";
import { markPointerExpandedMembers } from "./expansion-coordinator.ts";
import { deferGenerationRelease } from "./lifecycle/generation-handoff.ts";
import { installClaudeFooter, normalizeHexColor, patchEditorBorderColor } from "./footer.ts";
import { MessageLifecycle } from "./lifecycle/message-lifecycle.ts";
import { registerPointerExpansionLifecycle } from "./lifecycle/pointer-expansion.ts";
import {
	HOST_CONTAINER_RENDER,
	InspectionGroupComponent,
	isInspectionGroupComponent,
	reconcileInspectionGroups,
	type InspectionGroupFrame,
	type InspectionGroupPolicy,
} from "./inspection-group.ts";

export { InspectionGroupComponent } from "./inspection-group.ts";
import { registerFullscreenTui } from "./fullscreen-tui.ts";
import {
	describeInspectionsActive,
	describeInspectionsDone,
	type InspectionKind,
} from "./inspection-summary.ts";
import { describeEdit, describeWrite, type SummaryEmphasis } from "./mutation-summary.ts";
import { anchorFramedHeights, installMouseLayout } from "./mouse-layout.ts";
import { patchAssistantMessageRenderer } from "./host/assistant-message-patch.ts";
import { BlinkScheduler } from "./host/blink-scheduler.ts";
import { patchCompactionSummaryRenderer, patchCustomMessageRenderer } from "./host/message-patches.ts";
import { applyUserMessageBox as applyUserMessageBoxWithRuntime, patchUserMessageRenderer, type UserMessageBoxMode, type UserMessagePatchRuntime } from "./host/user-message-patch.ts";
import { releaseOwnedState, sharedState } from "./host/shared-state.ts";
import {
	genericToolLabel,
	humanizeToolName,
	isMcpToolCandidate,
	isMcpToolName,
	isOpenAiToolCandidate,
	mcpOriginalName,
	mcpToolServer,
	noteMcpTool,
	resetToolDiscovery,
	shouldUseGenericToolRenderer,
} from "./host/tool-discovery.ts";
import { ToolRegistrationCoordinator } from "./host/tool-registration.ts";
import { installToolPresentations, installToolRendererPatch, releaseToolRendererPatch } from "./host/tool-renderer-patch.ts";
import {
	ansiFromHex,
	bgAnsiFromHex,
	getThemeBg,
	getThemeFg,
	setThemeBg,
	setThemeFg,
	themeAccentIdentity,
	themeFgKeys,
	themePolarity,
	type CustomHexColor,
} from "./host/theme-access.ts";
export { themePolarity } from "./host/theme-access.ts";
import {
	isSettledToolExecution,
	isToolExecutionLike,
	setToolExpanded,
	toolComponentCwd as componentCwd,
	toolComponentRecord,
} from "./pi-tool-adapter.ts";
import { applyPromptPointer, registerPromptPointer } from "./prompt-editor.ts";
import { resolveColorSource, resolveMarkdownStyle, resolveSurfaceColorSource } from "./presentation-profile.ts";
import { registerSessionMetrics } from "./session-metrics.ts";
import { DEFAULT_EXPANDED_PREVIEW_MAX_LINES, getSettingsRevision, readSettings } from "./settings.ts";
import { sanitizeToolContent, sanitizeToolOutput, sanitizeToolText, WRAP_MARK } from "./terminal-sanitize.ts";
import { languageForPath as lang } from "./domain/language.ts";
import { getRawStringArg, getStringArg, getTextContent } from "./domain/tool-arguments.ts";
export { classifyBashCommandForDisplay, type BashDisplayInfo } from "./domain/bash-display.ts";
import {
	colorToRgb,
	hexToBgAnsi,
	hexToFgAnsi,
	mixRgb,
	parseAnsiRgb,
	rgbToBgAnsi,
	type Rgb,
} from "./domain/color-math.ts";
import {
	countDiffHunks,
	getFirstChangedNewLine,
	offsetParsedDiff,
	parseDiff,
	type DiffLine,
	type ParsedDiff,
} from "./domain/diff-model.ts";
export { parseDiff, parseLegacyEditDiff, parsePersistedEditPatch, selectAuthoritativeEditDiff } from "./domain/diff-model.ts";
import { selectVisualItems, selectVisualPreview, widthAwareText, type VisualPreviewMode } from "./visual-preview.ts";
import { registerEditTool } from "./tools/edit-tool.ts";
import { renderApplyPatchCall as renderApplyPatchCallWithRuntime, renderApplyPatchResult as renderApplyPatchResultWithRuntime, type ApplyPatchRuntime } from "./tools/apply-patch-tool.ts";
import { registerBashTool } from "./tools/bash-tool.ts";
import { renderGenericToolCall as renderGenericCall, renderGenericToolResult as renderGenericResult, type GenericToolRuntime } from "./tools/generic-tool.ts";
import { mcpServerForComponent, mcpServerName, renderMcpToolResult as renderMcpResult } from "./tools/mcp-tool.ts";
import { renderOpenAiToolResult as renderOpenAiResult, summarizeOpenAiToolCall as summarizeOpenAiCall } from "./tools/openai-tool.ts";
export { mcpServerName } from "./tools/mcp-tool.ts";
import { firstImageBlock, renderReadImage } from "./tools/read-image.ts";
import { registerReadTool } from "./tools/read-tool.ts";
import { registerSearchTools } from "./tools/search-tools.ts";
import { registerWriteTool } from "./tools/write-tool.ts";

export { anchorFramedHeights } from "./mouse-layout.ts";
export { sanitizeToolText } from "./terminal-sanitize.ts";
import {
	BUILTIN_COMPATIBILITY_TOOL_NAMES,
	isBuiltinCompatibilityToolName,
	parseCompatibilityConfig,
	resolveCompatibilityFeatureEnabled,
	resolveCompatibilityToolEnabled,
	type CompatibilityConfig,
	type CompatibilityFeatureId,
	type CompatibilityToolFamily,
} from "./domain/compatibility.ts";
import {
	DEFAULT_HIDDEN_THINKING_LABEL,
	DEFAULT_USER_PREFIX,
	formatTranscriptLines,
	formatWorkedLine,
	isWorkedLine,
	resolveMessageChromeSettings,
	resolveWorkedVerbs,
	type MessageChromeSettings,
	type MessageSpacing,
	type MessageStyle,
	type WorkedVerbMode,
} from "./message-chrome.ts";

const RESET = "\x1b[0m";
const TRANSPARENT_BG = "\x1b[49m";
const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;

// Border / branch rule colors. Defaults match the previous hardcoded values
// so behavior is identical when the theme is unavailable or themeAdaptive=false.
// `applyThemePaletteIfNeeded(theme)` re-derives these from `theme.fg("borderMuted"|"muted")`.
let BORDER_COLOR = "\x1b[38;5;238m";
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const ANSI_PRESENT_RE = /\x1b\[[0-9;]*m/;
const PATCH_FLAG = Symbol.for("pi-claudify:patched-container-render");
const TOOL_RENDER_CACHE = Symbol.for("pi-claudify:tool-render-cache");
const TOOL_RENDER_SETTINGS_REVISION = Symbol.for("pi-claudify:tool-render-settings-revision");
const TOOL_PRESENTATION_REVISION = Symbol.for("pi-claudify:tool-presentation-revision");
const TOOL_COMPONENT_PRESENTATION_REVISION = Symbol.for("pi-claudify:tool-component-presentation-revision");
const TOOL_CACHE_PATCH_FLAG = Symbol.for("pi-claudify:patched-tool-cache-invalidation");
const TOOL_FALLBACK_SANITIZE_FLAG = Symbol.for("pi-claudify:patched-tool-fallback-sanitize");
const TOOL_IMAGE_EXPAND_PATCH_FLAG = Symbol.for("pi-claudify:patched-read-image-expansion");
const CUSTOM_MESSAGE_PATCH_FLAG = Symbol.for("pi-claudify:patched-custom-message-render");
const COMPACTION_MESSAGE_PATCH_FLAG = Symbol.for("pi-claudify:patched-compaction-message-render");
const USER_MESSAGE_PATCH_FLAG = Symbol.for("pi-claudify:patched-user-message-render");
const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM2_IMAGE_PREFIX = "\x1b]1337;File=";

let toolBackgroundMode: "default" | "transparent" | "outlines" = "transparent";

const CLAUDE_TOOL_GLYPH = "⏺";
const CLAUDE_RESULT_GLYPH = "⎿";
const CLAUDE_RESULT_PREFIX = `  ${CLAUDE_RESULT_GLYPH}  `;
const CLAUDE_RESULT_CONTINUATION = " ".repeat(CLAUDE_RESULT_PREFIX.length);
// The collapsed read-only summary hangs at the bullet's indent, not the ⎿ gutter's.
const CLAUDE_COLLAPSED_INDENT = "  ";

// Status colors read off Claude Code's raw TTY stream. The bullet is the trust
// signal: gray while the tool runs, green once it actually succeeded.
let CC_DOT_PENDING: string = CLAUDE_PALETTE.status.pending;
// Fresh Claude Code v2.1.266 dark capture: xterm 114 (#87D787) success,
// xterm 211 (#FF87AF) error. Diff-removal red is a separate semantic color.
let CC_DOT_SUCCESS: string = CLAUDE_PALETTE.status.success;
let CC_DOT_ERROR: string = CLAUDE_PALETTE.status.error;
let CC_GUTTER_FG: string = CLAUDE_PALETTE.gutter;
const D_BOLD_ON = "\x1b[1m";
const D_BOLD_OFF = "\x1b[22m";
const FG_DEFAULT = "\x1b[39m";

/**
 * Claude Code does not tint file paths — it wraps them in an OSC 8 hyperlink so
 * the terminal makes them clickable, and leaves the color to the terminal. The
 * emphasis comes from bold, not hue.
 */
function osc8Link(target: string, label: string): string {
	const safeLabel = sanitizeToolText(label);
	if (!target) return safeLabel;
	try {
		const wellFormedTarget = typeof target.toWellFormed === "function"
			? target.toWellFormed()
			: target.replace(/[\uD800-\uDFFF]/g, "\ufffd");
		const uri = pathToFileURL(wellFormedTarget).href;
		return `\x1b]8;;${uri}\x07${safeLabel}\x1b]8;;\x07`;
	} catch (error) {
		debugDiagnostic("osc8-path", error);
		return safeLabel;
	}
}

/** Absolute path for the link target; the label stays the short display path. */
function linkedPath(cwd: string, displayPath: string, absolutePath?: string): string {
	if (!displayPath) return displayPath;
	const target = absolutePath ?? (displayPath.startsWith("/") ? displayPath : resolve(cwd, displayPath));
	return osc8Link(target, displayPath);
}

// Cross-extension bust signal for spinner.ts — it watches this counter on
// globalThis and invalidates its settings cache when it changes. Lets
// Claudify screen edits take effect on the next 250ms spinner tick instead
// of waiting for the file-stat TTL.
const SPINNER_BUST_KEY = Symbol.for("pi-claudify:spinner-settings-bust");
const SPINNER_COLOR_PREVIEW_KEY = Symbol.for("pi-claudify:spinner-color-preview");
const SPINNER_STATUS_COLOR_PREVIEW_KEY = Symbol.for("pi-claudify:spinner-status-color-preview");
export const COMMON_COLOR_KEYS: readonly string[] = [
	"accent", "borderAccent", "success", "error", "warning",
	"muted", "dim", "text", "thinkingText",
	"toolTitle", "mdHeading", "mdCode", "mdLink", "mdListBullet",
	"bashMode",
	"thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh",
	"syntaxKeyword", "syntaxFunction", "syntaxString", "syntaxType",
];
function bustSpinnerSettingsCache(): void {
	const current = ((globalThis as any)[SPINNER_BUST_KEY] as number | undefined) ?? 0;
	(globalThis as any)[SPINNER_BUST_KEY] = current + 1;
}

function currentToolPresentationRevision(): number {
	return ((globalThis as any)[TOOL_PRESENTATION_REVISION] as number | undefined) ?? 0;
}

function bumpToolPresentationRevision(): void {
	(globalThis as any)[TOOL_PRESENTATION_REVISION] = currentToolPresentationRevision() + 1;
}

function getMessageChromeSettings(): MessageChromeSettings {
	return resolveMessageChromeSettings(readSettings().values);
}

// ---------------------------------------------------------------------------
// Compatibility control — see extensions/domain/compatibility.ts and
// README.md "Compatibility control". Absent `compatibility` config means
// every feature and every tool stays enabled exactly as before this module
// existed. Every helper below re-parses settings live (readSettings() is
// itself cheaply cached), so toggling `compatibility` — or the `/claudify`
// screen, for the settings it edits — takes effect on the very next
// render/event without a restart, matching how every other live setting in
// this file already behaves.
// ---------------------------------------------------------------------------

function compatibilityConfig(): CompatibilityConfig | undefined {
	return parseCompatibilityConfig(readSettings().values.compatibility);
}

/** Global `enabled: false` disables every feature and every tool below. */
function compatibilityGloballyDisabled(): boolean {
	return compatibilityConfig()?.enabled === false;
}

function featureEnabled(id: CompatibilityFeatureId): boolean {
	return resolveCompatibilityFeatureEnabled(compatibilityConfig(), id);
}

const EMPTY_TOOL_NAME_SET: ReadonlySet<string> = new Set();

/** The legacy `skipToolOverrides` array, normalized like `compatibility.tools` keys. */
function legacySkippedToolNames(): ReadonlySet<string> {
	const raw = readSettings().values.skipToolOverrides;
	if (!Array.isArray(raw)) return EMPTY_TOOL_NAME_SET;
	return new Set(
		raw.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase()),
	);
}

function compatibilityToolFamilyForName(name: string): CompatibilityToolFamily {
	if (isMcpToolName(name)) return "mcp";
	if (isOpenAiToolCandidate({ name })) return "openai";
	return "generic";
}

/**
 * Unifies the legacy `skipToolOverrides` exact-false override with
 * `compatibility.tools` resolution (global enabled -> exact name -> legacy
 * skip -> family `mcp:*`/`openai:*`/`generic:*` -> `default` -> true). Every
 * call site that decides whether a tool gets Claudify's registration,
 * presentation, or grouping goes through this one function, so a disabled
 * builtin/family/tool loses all three consistently.
 */
function presentationOverrideSkipped(toolName: unknown): boolean {
	if (typeof toolName !== "string" || toolName.length === 0) return false;
	const name = toolName.toLowerCase();
	const config = compatibilityConfig();
	const legacySkipped = legacySkippedToolNames().has(name);
	const family = isBuiltinCompatibilityToolName(name) ? undefined : compatibilityToolFamilyForName(name);
	return !resolveCompatibilityToolEnabled(config, name, family, legacySkipped);
}

/**
 * `toolPresentation: false` (or the global switch) disables Claudify's
 * dynamic (mcp/openai/generic/apply_patch) tool call/result rendering —
 * native pi rendering shows through for those tools — without touching the
 * general container border/background chrome or read-only inspection
 * grouping, which are gated independently by presentationOverrideSkipped
 * itself. The seven core tool overrides (read/write/edit/bash/grep/find/ls)
 * are governed only by the tool registry, never by this feature.
 */
function toolPresentationSkipped(toolName: unknown): boolean {
	if (!featureEnabled("toolPresentation")) return true;
	return presentationOverrideSkipped(toolName);
}

function effectiveToolBackgroundMode(): "default" | "transparent" | "outlines" {
	return featureEnabled("toolBackground") ? toolBackgroundMode : "default";
}

// ---------------------------------------------------------------------------
// Builtin tool restoration — a process-stable snapshot of the host's
// pristine read/write/edit/bash/grep/find/ls definitions, captured before
// Claudify's first registerTool() call ever replaces them. A later
// `compatibility.tools` (or legacy `skipToolOverrides`) change that disables
// one of these restores the untouched host definition instead of merely
// skipping re-registration — and never clobbers a *different* extension that
// has since taken ownership of the name.
// ---------------------------------------------------------------------------

type ToolOwnerKind = "builtin" | "self" | "external" | "unknown";

const TOOL_ORIGINAL_DEFINITIONS_KEY = Symbol.for("pi-claudify:tool-original-definitions");
const TOOL_OWNED_NAMES_KEY = Symbol.for("pi-claudify:tool-owned-names");

function toolOriginalDefinitions(): Map<string, unknown> {
	const bag = globalThis as unknown as Record<symbol, unknown>;
	if (!(bag[TOOL_ORIGINAL_DEFINITIONS_KEY] instanceof Map)) bag[TOOL_ORIGINAL_DEFINITIONS_KEY] = new Map<string, unknown>();
	return bag[TOOL_ORIGINAL_DEFINITIONS_KEY] as Map<string, unknown>;
}

function claudifyOwnedToolNames(): Set<string> {
	const bag = globalThis as unknown as Record<symbol, unknown>;
	if (!(bag[TOOL_OWNED_NAMES_KEY] instanceof Set)) bag[TOOL_OWNED_NAMES_KEY] = new Set<string>();
	return bag[TOOL_OWNED_NAMES_KEY] as Set<string>;
}

function classifyToolOwner(tool: unknown): ToolOwnerKind {
	const sourceInfo = (tool as { sourceInfo?: { source?: unknown; path?: unknown } } | undefined)?.sourceInfo;
	if (!sourceInfo) return "unknown";
	if (sourceInfo.source === "builtin") return "builtin";
	const identity = `${sourceInfo.path ?? ""}\n${sourceInfo.source ?? ""}`.toLowerCase();
	const packageBoundary = /(?:^|[\\/:])(?:@owlburtoe[\\/])?pi-claudify(?:$|[\\/:])/m;
	return packageBoundary.test(identity) ? "self" : "external";
}

function findRegisteredTool(pi: ExtensionAPI, name: string): unknown {
	try {
		const tools = typeof (pi as any).getAllTools === "function" ? (pi as any).getAllTools() : [];
		if (!Array.isArray(tools)) return undefined;
		return tools.find((tool: any) => String(tool?.name ?? "").toLowerCase() === name);
	} catch {
		return undefined;
	}
}

function captureOriginalBuiltinDefinition(pi: ExtensionAPI, name: string): void {
	const originals = toolOriginalDefinitions();
	if (originals.has(name)) return;
	const found = findRegisteredTool(pi, name);
	if (found && classifyToolOwner(found) === "builtin") originals.set(name, found);
}

/**
 * Registers `definition` unless `compatibility.tools` (or legacy
 * `skipToolOverrides`) disables it, in which case the pristine host
 * definition captured before Claudify's first registration is restored
 * instead — but only while Claudify still owns the live registration, so a
 * newer external extension's definition for the same name is never
 * clobbered.
 */
function shouldRegisterBuiltinToolOverride(pi: ExtensionAPI, name: string): boolean {
	captureOriginalBuiltinDefinition(pi, name);
	if (toolPresentationSkipped(name)) {
		if (claudifyOwnedToolNames().has(name)) {
			const current = findRegisteredTool(pi, name);
			const currentOwner = current ? classifyToolOwner(current) : "unknown";
			if (currentOwner !== "external") {
				const original = toolOriginalDefinitions().get(name);
				if (original) pi.registerTool(original as any);
			}
			claudifyOwnedToolNames().delete(name);
		}
		return false;
	}
	claudifyOwnedToolNames().add(name);
	return true;
}

function applyHiddenThinkingLabel(ctx: any): void {
	if (!ctx?.hasUI || typeof ctx.ui?.setHiddenThinkingLabel !== "function") return;
	const label = getMessageChromeSettings().hiddenThinkingLabel;
	ctx.ui.setHiddenThinkingLabel(label || DEFAULT_HIDDEN_THINKING_LABEL);
}

let toolBackgroundOverride: "default" | "transparent" | "outlines" | null = null;

function syncToolBackgroundMode(): void {
	if (toolBackgroundOverride) {
		toolBackgroundMode = toolBackgroundOverride;
		return;
	}
	const settings = readSettings().values;
	toolBackgroundMode = settings.toolBackground ?? "transparent";
}

// Claude Code's selection/accent lavender, replacing pi's teal `accent`.
// Extraction + dark/light assignment: docs/plans/2026-07-16-cc-accent-color.md.
// pi's Theme stores READY-MADE ANSI ESCAPES in fgColors — theme.fg() only
// concatenates — so the override must store escapes, never hex (a hex string
// renders as literal text and widens lines past the terminal, crashing pi's
// renderer; shipped broken in 2.3.0). The 256-color indices are precomputed
// with pi's own rgbTo256 quantizer (147 matches the live CC capture).
const CC_ACCENT_ANSI = CLAUDE_PALETTE.accent;
// Every accent escape claudify has imposed on a theme. pi hands us the theme as
// both the instance and a forwarding Proxy, so a second object identity arrives
// with our override already installed; the snapshot guard must recognize it as
// ours, or it memorizes the override as the theme's own accent and accentColor=
// "theme" restores the override forever. A fixed CC list only covered the two
// captured lavenders — a custom hex stranded itself that way.
const appliedAccentValues = new Set<string>([
	CC_ACCENT_ANSI.dark.truecolor,
	CC_ACCENT_ANSI.dark.ansi256,
	CC_ACCENT_ANSI.light.truecolor,
	CC_ACCENT_ANSI.light.ansi256,
]);

interface AccentSnapshot {
	readonly original: string;
	/** fgColors keys (beyond "accent") whose value aliased the accent var at load —
	 * mdCode/mdListBullet in pi's dark theme. The theme says these surfaces are
	 * accent-colored, so the override carries them. */
	readonly aliasKeys: readonly string[];
}

const originalThemeAccent = new WeakMap<object, AccentSnapshot>();

/** pi hands the same logical theme to us as both the instance and a forwarding
 * Proxy — two object identities sharing one fgColors container. Keying the
 * snapshot on the theme object gave each identity its own entry, so whichever
 * arrived second saw the override already installed and never recorded the
 * theme's real accent; accentColor="theme" then had nothing to restore. The
 * container forwards through the Proxy, so it identifies the logical theme. */
function storedHexColor(value: unknown): CustomHexColor | null {
	if (typeof value !== "string") return null;
	return normalizeHexColor(value) as CustomHexColor | null;
}

export function applyAccentOverride(theme: unknown): void {
	// `themeColors: false` also covers the manual re-apply calls the Claudify
	// screen triggers on colorSource/accentColor changes, not only the
	// automatic per-session/turn derivation inside applyThemePaletteIfNeeded.
	if (!featureEnabled("themeColors")) return;
	if (!theme || typeof theme !== "object") return;
	const current = getThemeFg(theme, "accent");
	if (current === undefined) return;
	// Snapshot per logical theme (its fgColors container), not per object identity,
	// so the instance and its forwarding Proxy share one record. Never memorize an
	// already-overridden value as the theme's own accent.
	const identity = themeAccentIdentity(theme) ?? theme;
	if (!originalThemeAccent.has(identity) && !appliedAccentValues.has(current)) {
		const aliasKeys = themeFgKeys(theme)
			.filter((key) => key !== "accent" && getThemeFg(theme, key) === current);
		originalThemeAccent.set(identity, { original: current, aliasKeys });
	}
	const snapshot = originalThemeAccent.get(identity);
	const settings = readSettings().values;
	const accentColor = resolveSurfaceColorSource(settings, "accentColor");
	const customAccent = storedHexColor(accentColor);
	const colorMode = (theme as any).mode === "256color" ? "ansi256" : "truecolor";
	const polarity = themePolarity(theme);
	// Unknown/default foregrounds are not evidence of a dark terminal. Preserve
	// the theme's semantic accent unless polarity is known or a custom hex wins.
	const themeOwnsAccent = accentColor === "theme" || (!customAccent && polarity === "unknown");
	const target = themeOwnsAccent
		? snapshot?.original ?? current
		: customAccent
			? ansiFromHex(theme, customAccent, "foreground")
				?? CC_ACCENT_ANSI[polarity === "light" ? "light" : "dark"][colorMode]
			: CC_ACCENT_ANSI[polarity === "light" ? "light" : "dark"][colorMode];
	// Register only values we impose, never a restored original: a theme whose own
	// accent happens to equal some other theme's custom color must still snapshot.
	if (!themeOwnsAccent) appliedAccentValues.add(target);
	if (current !== target) setThemeFg(theme, "accent", target);
	for (const key of snapshot?.aliasKeys ?? []) {
		if (getThemeFg(theme, key) !== target) setThemeFg(theme, key, target);
	}
}

// Claude Code's settled user-message box, captured under 256 colors (237/239/231).
// Capture + geometry: docs/plans/2026-07-16-cc-user-message-box.md.
const CC_USER_BOX_BG = CLAUDE_PALETTE.userMessage.background;
const CC_USER_BOX_PREFIX_FG = CLAUDE_PALETTE.userMessage.prefix;
const CC_USER_BOX_TEXT_FG = CLAUDE_PALETTE.userMessage.text;
const FG_DEFAULT_ANSI = "\x1b[39m";

const originalUserMessageBg = new WeakMap<object, string>();
let userBoxThemeBg: string | null = null;
let userBoxThemePrefixFg: string | null = null;
let userBoxCustomBg: { hex: CustomHexColor; ansi: string } | null = null;

export function applyToolBackgroundMode(theme: unknown): void {
	syncToolBackgroundMode();
	const customHex = storedHexColor(readSettings().values.userMessageBox);
	const customAnsi = customHex ? ansiFromHex(theme, customHex, "background") : null;
	userBoxCustomBg = customHex && customAnsi ? { hex: customHex, ansi: customAnsi } : null;
	// Remember the theme's own user-message background before blanking it: the
	// user-message box (theme mode) paints with the theme's value even though
	// pi's markdown background stays stripped in every mode.
	if (theme && typeof theme === "object") {
		const current = getThemeBg(theme, "userMessageBg");
		if (current && current !== TRANSPARENT_BG && !originalUserMessageBg.has(theme)) {
			originalUserMessageBg.set(theme, current);
		}
		// bgColors store ready-made ANSI escapes (same as fgColors); hex only
		// appears in test fakes, so pass escapes through and convert hex.
		const original = originalUserMessageBg.get(theme);
		userBoxThemeBg = original ? (original.startsWith("\x1b") ? original : bgAnsiFromHex(original)) : null;
		userBoxThemePrefixFg = safeFgAnsi(theme, "dim") ?? safeFgAnsi(theme, "muted");
	}
	setThemeBg(theme, "userMessageBg", TRANSPARENT_BG);
	if (effectiveToolBackgroundMode() === "default") return;

	setThemeBg(theme, "toolPendingBg", TRANSPARENT_BG);
	setThemeBg(theme, "toolSuccessBg", TRANSPARENT_BG);
	setThemeBg(theme, "toolErrorBg", TRANSPARENT_BG);
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

export function sanitizeRenderedTextBlockLines(lines: string[], _style: "claude" | "pi" = "claude"): string[] {
	// Structural Markdown differences are expressed through parser callbacks in
	// DottedParagraph/ThinkingParagraph. Rendered glyphs have no provenance: a
	// literal ` ``` `, `────`, or single `│` must never be mistaken for syntax.
	return lines;
}

function isBlankLine(text: string): boolean {
	return stripAnsi(text).trim().length === 0;
}

function borderLine(width: number): string {
	return `${BORDER_COLOR}${"─".repeat(Math.max(1, width))}${TRANSPARENT_RESET}`;
}

function clampLineWidth(line: string, width: number): string {
	if (width <= 0) return "";
	return visibleWidth(line) > width ? truncateToWidth(line, width) : line;
}

function isBashToolExecution(value: unknown): boolean {
	// A disabled `bash` tool override drops out of Claudify's stacking/grouping
	// entirely — its row falls back to native pi spacing/presentation.
	return isToolExecutionLike(value) && (value as any).toolName === "bash" && !presentationOverrideSkipped("bash");
}

function shouldStackConsecutiveBash(): boolean {
	return featureEnabled("bashStacking") && readSettings().values.bashStackConsecutive !== false;
}

/** Claude parity by default; off keeps shell rows visible without expanding. */
function shellGroupingEnabled(): boolean {
	return readSettings().values.groupShellCommands !== false;
}

function readOnlyToolGroupingEnabled(): boolean {
	return featureEnabled("inspectionGroups") && readSettings().values.readOnlyToolGrouping !== false;
}

function readOnlyToolGroupLimit(): number {
	const value = readSettings().values.readOnlyToolGroupLimit;
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.max(1, Math.min(20, Math.floor(value)))
		: 5;
}

function isInspectionGroupCandidate(value: unknown): boolean {
	if (!readOnlyToolGroupingEnabled() || !isToolExecutionLike(value)) return false;
	const rec = toolComponentRecord(value);
	if (presentationOverrideSkipped(rec.toolName)) return false;
	if (rec.expanded === true) return false;
	if (rec.toolName === "read" || rec.toolName === "grep" || rec.toolName === "find" || rec.toolName === "ls") return true;
	// Every MCP call aggregates, whatever it does. Claude Code renders a mutating
	// or failing MCP tool exactly like a read-only one — there is no separate row.
	if (isMcpToolName(rec.toolName)) return true;
	// Claude Code aggregates every shell command ("running 1 shell command"), not
	// just the ones that look like file reads — so that is the default. Turning
	// groupShellCommands off keeps shell calls as their own always-visible rows:
	// aggregation is recoverable (ctrl+o shows the command), but ctrl+o opens the
	// whole transcript, so a user who wants to see commands as they happen has no
	// per-row alternative.
	if (rec.toolName === "bash") return shellGroupingEnabled();
	return false;
}

function isMcpToolExecution(value: unknown): boolean {
	return isToolExecutionLike(value) && isMcpToolName(toolComponentRecord(value).toolName);
}

function plural(count: number, noun: string): string {
	if (count === 1) return `1 ${noun}`;
	const suffix = /(?:s|x|z|ch|sh)$/i.test(noun) ? "es" : "s";
	return `${count} ${noun}${suffix}`;
}

function formatOffsetLimit(args: any): string {
	const parts: string[] = [];
	if (args?.offset !== undefined && args?.offset !== null) parts.push(`offset=${args.offset}`);
	if (args?.limit !== undefined && args?.limit !== null) parts.push(`limit=${args.limit}`);
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function readInspectionTarget(value: unknown): string {
	const rec = toolComponentRecord(value);
	return `${shortPath(componentCwd(value), rec.args?.path ?? "")}${formatOffsetLimit(rec.args)}`;
}

/** Claude Code shows the bare quoted pattern — never the search path. */
function grepInspectionTarget(value: unknown): string {
	const rec = toolComponentRecord(value);
	return `"${summarizeText(rec.args?.pattern ?? "", 40)}"`;
}

function findInspectionTarget(value: unknown): string {
	const rec = toolComponentRecord(value);
	const pattern = summarizeText(rec.args?.pattern ?? "", 40);
	const path = rec.args?.path ? ` in ${shortPath(componentCwd(value), rec.args.path)}` : "";
	return `"${pattern}"${path}`;
}

function listInspectionTarget(value: unknown): string {
	const rec = toolComponentRecord(value);
	return shortPath(componentCwd(value), rec.args?.path ?? ".");
}

/** Raw shell command, for the `$ cmd` row under an aggregate header. */
function bashInspectionCommand(value: unknown): string {
	const rec = toolComponentRecord(value);
	const command = rec.args?.command ?? rec.args?.cmd ?? "";
	return summarizeText(typeof command === "string" ? command : String(command), 80);
}

/**
 * A tool is settled once it has a NON-partial result.
 *
 * pi assigns `.result` when execution STARTS and streams into it with
 * `isPartial === true` (replacing the object per update); completion flips
 * `isPartial` to false, and restored history rows are already false. So
 * result-presence alone reads "settled" for the entire run, which collapsed the
 * aggregate a frame after it appeared and made the active "Running…" header
 * effectively unreachable.
 * Capture: docs/plans/2026-09-07-inspection-group-interaction.md
 */
export const isSettledInspectionTool = isSettledToolExecution;

function inspectionKind(value: unknown): InspectionKind {
	const rec = toolComponentRecord(value);
	if (rec.toolName === "read") return "read";
	if (rec.toolName === "grep") return "grep";
	// Claude Code folds Glob into the grep clause — a glob for `src/*.ts` renders
	// as "Searching for 1 pattern" with ⎿ "src/*.ts", not a clause of its own.
	if (rec.toolName === "find") return "grep";
	if (rec.toolName === "ls") return "ls";
	if (isMcpToolName(rec.toolName)) return "mcp";
	return "bash";
}

/** Servers addressed by the group's MCP calls, in first-seen order. */
function mcpServersInGroup(group: unknown[]): string[] {
	return group.filter(isMcpToolExecution).map(mcpServerForComponent);
}

/**
 * The ⎿ row under an aggregate header is the bare target — a path for file
 * tools, `$ command` for shell. No tool name, no status suffix.
 */
function summarizeReadOnlyInspectionTool(value: unknown): string {
	const rec = toolComponentRecord(value);
	// Paths and patterns are model output just like commands, and this row prints
	// them verbatim: an ESC(0 in a path survives the row's SGR reset and redraws
	// everything below as line art, while visibleWidth measures those bytes as
	// zero and lets the row overflow the terminal.
	return sanitizeToolText(inspectionTargetText(rec, value));
}

function inspectionTargetText(rec: { toolName?: unknown }, value: unknown): string {
	if (rec.toolName === "read") return readInspectionTarget(value);
	if (rec.toolName === "grep") return grepInspectionTarget(value);
	if (rec.toolName === "find") return findInspectionTarget(value);
	if (rec.toolName === "ls") return listInspectionTarget(value);
	return `$ ${bashInspectionCommand(value)}`;
}

function fitInspectionLine(line: string, width: number): string[] {
	if (width <= 0) return [];
	return wrapMarkedLine(line.replace(/\t/g, "   "), width)
		.map((part) => padToWidth(visibleWidth(part) > width ? truncateToWidth(part, width, "") : part, width));
}

/** Frame aggregate content and report the exact clickable row range. */
function frameInspectionLines(rendered: string[], width: number): InspectionGroupFrame {
	syncToolBackgroundMode();
	let start = 0;
	let lines: string[];
	if (effectiveToolBackgroundMode() === "outlines") {
		lines = [" ".repeat(width), borderLine(width), ...rendered, borderLine(width)];
		start = 2;
	} else if (effectiveToolBackgroundMode() === "transparent") {
		lines = [" ".repeat(width), ...rendered];
		start = 1;
	} else {
		lines = rendered;
	}
	return { lines, interactiveRows: { start, end: start + rendered.length } };
}

/** Claude's settled group is one dim, indented, bullet-less summary. */
function renderSettledInspectionGroup(group: unknown[], width: number): InspectionGroupFrame {
	const summary = `${CLAUDE_COLLAPSED_INDENT}${WRAP_MARK}${WORKED_LINE_FG}${describeInspectionsDone(
		group.map(inspectionKind),
		mcpServersInGroup(group),
	)}${RESET}`;
	return frameInspectionLines(fitInspectionLine(summary, width), width);
}

function renderActiveInspectionGroup(group: unknown[], width: number): InspectionGroupFrame {
	// MCP calls contribute a clause to the header but never a ⎿ row of their own.
	const targets = group.filter((entry) => !isMcpToolExecution(entry));
	const shown = targets.slice(0, readOnlyToolGroupLimit());
	const remaining = targets.length - shown.length;
	const core: string[] = [`${WRAP_MARK}${CLAUDE_TOOL_GLYPH} ${describeInspectionsActive(
		group.map(inspectionKind),
		mcpServersInGroup(group),
	)}`];
	for (const entry of shown) {
		core.push(`${TOOL_RULE}${CLAUDE_RESULT_PREFIX}${TRANSPARENT_RESET}${WRAP_MARK}${summarizeReadOnlyInspectionTool(entry)}`);
	}
	if (remaining > 0) {
		core.push(`${TOOL_RULE}${CLAUDE_RESULT_PREFIX}${TRANSPARENT_RESET}${WRAP_MARK}… +${remaining} more`);
	}
	return frameInspectionLines(core.flatMap((line) => fitInspectionLine(line, width)), width);
}

const inspectionGroupPolicy: InspectionGroupPolicy = {
	isEligible: isInspectionGroupCandidate,
	isSettled: isSettledInspectionTool,
	setExpanded: setToolExpanded,
	onPointerExpand: markPointerExpandedMembers,
	renderActive: renderActiveInspectionGroup,
	renderSettled: renderSettledInspectionGroup,
};

export function ensureInspectionGroups(container: unknown): void {
	reconcileInspectionGroups(container, inspectionGroupPolicy);
}

function hasConsecutiveBashToolChildren(children: unknown[]): boolean {
	let previousWasBash = false;
	for (const child of children) {
		const currentIsBash = isBashToolExecution(child);
		if (currentIsBash && previousWasBash) return true;
		previousWasBash = currentIsBash;
	}
	return false;
}

function dropLeadingSpacerLine(lines: string[]): string[] {
	return lines.length > 0 && isBlankLine(lines[0]) ? lines.slice(1) : lines;
}

function renderWithStackedConsecutiveBash(
	container: any,
	width: number,
): { lines: string[]; layout: Array<{ component: unknown; height: number }> } | null {
	if (!shouldStackConsecutiveBash()) return null;
	const children = Array.isArray(container?.children) ? container.children : null;
	if (!children || !hasConsecutiveBashToolChildren(children)) return null;

	const lines: string[] = [];
	const layout: Array<{ component: unknown; height: number }> = [];
	let previousWasBash = false;
	for (const child of children) {
		const currentIsBash = isBashToolExecution(child);
		const childLines = typeof child?.render === "function" ? child.render(width) : [];
		const painted = currentIsBash && previousWasBash ? dropLeadingSpacerLine(childLines) : childLines;
		lines.push(...painted);
		layout.push({ component: child, height: painted.length });
		previousWasBash = currentIsBash;
	}
	return { lines, layout };
}

function isTerminalImageLine(line: string): boolean {
	return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM2_IMAGE_PREFIX);
}

function normalizeLeadingCheckGlyph(line: string): string {
	return line.replace(/^((?:\x1b\[[0-9;]*m|[ \t])*)[✓✔](?=\s)/, "$1●");
}

function firstImageBlockStart(lines: string[]): number {
	const imageLineIndex = lines.findIndex(isTerminalImageLine);
	if (imageLineIndex === -1) return -1;
	let start = imageLineIndex;
	while (start > 0 && isBlankLine(lines[start - 1])) start--;
	return start;
}

function splitRenderedImageBlock(lines: string[]): { textLines: string[]; imageLines: string[] } {
	const imageStart = firstImageBlockStart(lines);
	if (imageStart === -1) return { textLines: lines, imageLines: [] };
	const textLines = lines.slice(0, imageStart);
	while (textLines.length > 0 && isBlankLine(textLines[textLines.length - 1])) textLines.pop();
	return { textLines, imageLines: lines.slice(imageStart) };
}

interface GlobalRenderPatchRegistry {
	originalRender: (width: number) => string[];
}
interface ActiveGlobalRenderState {
	owner?: object;
	delegate?: (this: unknown, width: number, originalRender: (this: unknown, width: number) => string[]) => string[];
}
function activeGlobalRenderState(): ActiveGlobalRenderState {
	return sharedState(GLOBAL_RENDER_STATE_KEY, () => ({}));
}

function hostContainerPrototype(): any {
	const candidate = Object.getPrototypeOf(ToolExecutionComponent.prototype);
	return candidate && typeof candidate.render === "function" ? candidate : Container.prototype;
}

function patchGlobalToolBordersOn(proto: any, owner: object): void {
	const legacyPatch = proto[PATCH_FLAG] === true;
	let registry = legacyPatch ? undefined : proto[PATCH_FLAG] as GlobalRenderPatchRegistry | undefined;
	if (!registry) {
		// Migrate the old boolean-guard generation by recovering the process-level
		// pristine host renderer captured before any claudify patch was installed.
		registry = { originalRender: legacyPatch ? HOST_CONTAINER_RENDER : proto.render };
		proto[PATCH_FLAG] = registry;
		proto.render = function stableClaudifyContainerRender(this: unknown, width: number): string[] {
			const active = activeGlobalRenderState().delegate;
			return active ? active.call(this, width, registry!.originalRender) : registry!.originalRender.call(this, width);
		};
	}
	const delegate = function patchedContainerRender(
		this: unknown,
		width: number,
		originalRender: (this: unknown, width: number) => string[],
	): string[] {
		if (isToolExecutionLike(this) && presentationOverrideSkipped(toolComponentRecord(this).toolName)) {
			return originalRender.call(this, width);
		}
		if (!isToolExecutionLike(this)) {
			const children = Array.isArray((this as any).children) ? (this as any).children as unknown[] : [];
			// The prototype patch reaches every Container; only transcript containers
			// with a candidate/group need tree reconciliation.
			if (children.some((child) => isInspectionGroupComponent(child) || isInspectionGroupCandidate(child))) {
				try { ensureInspectionGroups(this); } catch (error) {
					debugDiagnostic("inspection-reconcile", error);
					// Native rows are the fallback.
				}
			}
			// The host's original render owns parent mouseLayout; wrappers own only
			// the geometry of the aggregate lines they paint.

			const stacked = renderWithStackedConsecutiveBash(this, width);
			if (stacked) {
				// This path still bypasses originalRender; preserve the geometry of the
				// spacer lines we actually dropped so rows below stay clickable.
				installMouseLayout(this, { width, children: stacked.layout });
				return stacked.lines;
			}
		}

		const settingsRevision = isToolExecutionLike(this) ? getSettingsRevision() : 0;
		if (isToolExecutionLike(this)) {
			const presentationRevision = currentToolPresentationRevision();
			if ((this as any)[TOOL_COMPONENT_PRESENTATION_REVISION] !== presentationRevision) {
				(this as any)[TOOL_COMPONENT_PRESENTATION_REVISION] = presentationRevision;
				try { (this as any).updateDisplay?.(); }
				catch (error) { debugDiagnostic("presentation-refresh", error); }
				delete (this as any)[TOOL_RENDER_CACHE];
			}
			if ((this as any)[TOOL_RENDER_SETTINGS_REVISION] !== settingsRevision) {
				(this as any)[TOOL_RENDER_SETTINGS_REVISION] = settingsRevision;
				delete (this as any)[TOOL_RENDER_CACHE];
			}
			const cached = (this as any)[TOOL_RENDER_CACHE];
			if (cached?.width === width && cached?.mode === effectiveToolBackgroundMode() && cached?.settingsRevision === settingsRevision) {
				return cached.lines;
			}
		}

		const rendered = originalRender.call(this, width);
		if (!Array.isArray(rendered) || rendered.length === 0) return rendered;
		if (!isToolExecutionLike(this)) return rendered;
		if (effectiveToolBackgroundMode() === "default") {
			(this as any)[TOOL_RENDER_CACHE] = { width, mode: effectiveToolBackgroundMode(), settingsRevision, lines: rendered };
			return rendered;
		}

		let start = 0;
		while (start < rendered.length && isBlankLine(rendered[start])) start++;
		let end = rendered.length - 1;
		while (end >= start && isBlankLine(rendered[end])) end--;
		if (start > end) return rendered;

		const { textLines, imageLines } = splitRenderedImageBlock(rendered.slice(start, end + 1));
		if (imageLines.length > 0) {
			(this as any)[TOOL_RENDER_CACHE] = { width, mode: effectiveToolBackgroundMode(), settingsRevision, lines: rendered };
			return rendered;
		}
		const core = textLines.map((line) => clampLineWidth(normalizeLeadingCheckGlyph(line), width));
		const spacerLine = " ".repeat(width);
		let result: string[];

		if (effectiveToolBackgroundMode() === "outlines") {
			const ruleWidth = Math.max(1, width);
			const framed = core.length > 0 ? [borderLine(ruleWidth), ...core, borderLine(ruleWidth)] : [];
			result = [spacerLine, ...framed, ...imageLines];
		} else {
			result = [spacerLine, ...core, ...imageLines];
		}

		// The host hit-tests clicks from mouseLayout, which originalRender wrote
		// for the UNFRAMED lines. We trimmed blanks and added framing, so without
		// an update every painted line below this row routes off by the framing
		// height (header clicks miss while result clicks still toggle). Re-anchor
		// first/last child heights to what we actually painted; framing lines
		// belong to the block, so the whole row stays clickable.
		try {
			const layout = (this as any).mouseLayout;
			const kids = Array.isArray((this as any).children) ? (this as any).children : [];
			if (layout && layout.width === width && Array.isArray(layout.children) && layout.children.length === kids.length && kids.length > 0) {
				const natural = layout.children.map((entry: any) => (typeof entry?.height === "number" ? entry.height : 0));
				const topFraming = 1 + (effectiveToolBackgroundMode() === "outlines" && core.length > 0 ? 1 : 0);
				const bottomFraming = effectiveToolBackgroundMode() === "outlines" && core.length > 0 ? 1 : 0;
				const heights = anchorFramedHeights(natural, start, rendered.length - 1 - end, topFraming, bottomFraming);
				installMouseLayout(this, { width, children: kids.map((component: unknown, index: number) => ({ component, height: heights[index] ?? 0 })) });
			}
		} catch { /* hit-testing keeps the host layout */ }

		(this as any)[TOOL_RENDER_CACHE] = { width, mode: effectiveToolBackgroundMode(), settingsRevision, lines: result };
		return result;
	};
	const active = activeGlobalRenderState();
	active.owner = owner;
	active.delegate = delegate;
}

function patchGlobalToolBorders(owner: object): void {
	for (const proto of new Set([hostContainerPrototype(), Container.prototype])) patchGlobalToolBordersOn(proto, owner);
}

function releaseGlobalToolBorders(owner: object): void {
	releaseOwnedState(activeGlobalRenderState(), owner, (state) => { state.delegate = undefined; });
}

function summarizeText(text: string, max = 60): string {
	const oneLine = text.replace(/\n/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

function hashText(text: string): string {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function expandHint(theme: Theme): string {
	return theme.fg("muted", " (ctrl+o to expand)");
}

function clearStateKeys(state: Record<string, unknown> | undefined, ...keys: string[]): void {
	if (!state) return;
	for (const key of keys) {
		delete state[key];
	}
}

function clearToolRenderCache(value: unknown): void {
	if (!value || typeof value !== "object") return;
	delete (value as any)[TOOL_RENDER_CACHE];
}

const ASSISTANT_PATCH_FLAG = Symbol.for("pi-claudify:patched-assistant-message");
const TOOL_EXECUTION_PATCH_FLAG = Symbol.for("pi-claudify:patched-tool-execution");
const GLOBAL_RENDER_STATE_KEY = Symbol.for("pi-claudify:global-render-state");
const TOOL_INDENT_PATCH_FLAG = Symbol.for("pi-claudify:patched-tool-row-indent");
const WORKED_DURATION_KEY = "_piClaudeStyleWorkedDurationMs";
const WORKED_START_KEY = "_piClaudeStyleWorkedStartMs";
// The worked-line verb rotates per turn ("Cooked", "Sautéed", …), so only the
// glyph is a stable fast-path marker. isWorkedLine() does the real matching.
const WORKED_DURATION_GLYPH = "✻";
// WORKED_LINE_FG is theme-derived (from "muted") when themeAdaptive is on.
let WORKED_LINE_FG = "\x1b[38;2;140;140;140m";
function workedVerbs(): readonly string[] {
	const settings = readSettings().values;
	const mode: WorkedVerbMode = settings.workedVerbMode === "replace" ? "replace" : "append";
	return resolveWorkedVerbs(settings.workedVerbs, mode);
}

function workedDurationText(ms: number, seed?: number, verbs: readonly string[] = workedVerbs()): string {
	return `${WORKED_LINE_FG}${formatWorkedLine(ms, { seed, verbs })}${RESET}`;
}

function inlineWorkedDurationText(ms: number, seed?: number, verbs?: readonly string[]): string {
	return workedDurationText(ms, seed, verbs);
}

function isWorkedDurationLine(line: string): boolean {
	return isWorkedLine(stripAnsi(line));
}

function stripWorkedDurationLine(text: string): string {
	if (!text.includes(WORKED_DURATION_GLYPH)) return text;
	return text
		.split(/\r?\n/)
		.filter((line) => !isWorkedDurationLine(line))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
}

function hasWorkedDurationLine(message: any): boolean {
	if (!Array.isArray(message?.content)) return false;
	return message.content.some((block: any) => {
		if (block?.type !== "text" || typeof block.text !== "string" || !block.text.includes(WORKED_DURATION_GLYPH)) return false;
		return block.text.split(/\r?\n/).some(isWorkedDurationLine);
	});
}

export function appendWorkedDurationLine(message: any, durationMs: number, seed?: number, verbs?: readonly string[]): void {
	if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return;
	const textBlocks = message.content.filter((block: any) => block?.type === "text" && typeof block.text === "string" && block.text.trim());
	const lastText = textBlocks[textBlocks.length - 1];
	if (!lastText) return;
	const text = lastText.text.includes(WORKED_DURATION_GLYPH) ? stripWorkedDurationLine(lastText.text) : lastText.text;
	// Seed the verb with the turn's start timestamp: stable across repaints (baked
	// in here once at message_end), yet varies per turn. A seedless call pins the
	// verb to pool[0] forever (CLFY-24); a duration-derived seed would cluster
	// short turns on the same few verbs, so the start time is the right choice.
	lastText.text = `${text.trimEnd()}\n\n${inlineWorkedDurationText(durationMs, seed, verbs)}`;
}

function messageChromeCacheKey(settings: MessageChromeSettings, kind: "assistant" | "thinking"): string {
	return [
		settings.messageStyle,
		settings.messageSpacing,
		kind === "assistant" ? settings.assistantPrefix : settings.thinkingPrefix,
	].join(":");
}

function renderClassicPrefixedLines(lines: string[], prefix: string, normalizeChecks = true): string[] {
	let prefixPlaced = false;
	return lines.map((line: string) => {
		const displayLine = normalizeChecks ? normalizeLeadingCheckGlyph(line) : line;
		if (!prefixPlaced && stripAnsi(displayLine).trim()) {
			prefixPlaced = true;
			return ` ${prefix} ${displayLine}`;
		}
		return `   ${displayLine}`;
	});
}

function colorFirstTranscriptPrefix(lines: string[], prefixGlyph: string, coloredPrefixGlyph: string): string[] {
	const plainPrefix = ` ${prefixGlyph} `;
	const coloredPrefix = ` ${coloredPrefixGlyph} `;
	let replaced = false;
	return lines.map((line) => {
		if (!replaced && line.startsWith(plainPrefix)) {
			replaced = true;
			return `${coloredPrefix}${line.slice(plainPrefix.length)}`;
		}
		return line;
	});
}

export class DottedParagraph {
	private md: InstanceType<typeof Markdown>;
	private claudeMd: InstanceType<typeof Markdown>;
	private claudeAccentMd: InstanceType<typeof Markdown>;
	private cachedWidth?: number;
	private cachedChromeKey?: string;
	private cachedLines?: string[];

	constructor(text: string, markdownTheme: ConstructorParameters<typeof Markdown>[3]) {
		this.md = new Markdown(text, 0, 0, markdownTheme);
		const defaultFg = (value: string) => `${FG_DEFAULT}${value}${FG_DEFAULT}`;
		const claudeTheme: ConstructorParameters<typeof Markdown>[3] = {
			...markdownTheme,
			heading: defaultFg,
			listBullet: defaultFg,
			code: (value: string) => `${CLAUDE_PALETTE.inlineCode}${value}${FG_DEFAULT}`,
			link: (value: string) => `${CLAUDE_PALETTE.link}${value}${FG_DEFAULT}`,
			codeBlockIndent: "",
			codeBlockBorder: () => "",
			hr: () => "---",
			quoteBorder: () => "▎ ",
		};
		const claudeAccentTheme: ConstructorParameters<typeof Markdown>[3] = {
			...claudeTheme,
			// An explicit Accent remains the advanced override for these surfaces.
			listBullet: markdownTheme.listBullet,
			code: markdownTheme.code,
		};
		this.claudeMd = new Markdown(text, 0, 0, claudeTheme);
		this.claudeAccentMd = new Markdown(text, 0, 0, claudeAccentTheme);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedChromeKey = undefined;
		this.cachedLines = undefined;
		this.md.invalidate();
		this.claudeMd.invalidate();
		this.claudeAccentMd.invalidate();
	}

	render(width: number): string[] {
		const settings = getMessageChromeSettings();
		const presentation = readSettings().values;
		const markdownStyle = resolveMarkdownStyle(presentation);
		const markdownColors = resolveColorSource(presentation);
		const explicitAccent = presentation.accentColor !== undefined;
		const chromeKey = `${messageChromeCacheKey(settings, "assistant")}:${markdownStyle}:${markdownColors}:${String(presentation.accentColor)}`;
		if (this.cachedLines && this.cachedWidth === width && this.cachedChromeKey === chromeKey) return this.cachedLines;
		const isClassic = settings.messageStyle === "classic";
		const prefixGlyph = isClassic ? "●" : settings.assistantPrefix;
		// Claude style puts the glyph at column 0; classic keeps its leading space.
		const prefix = isClassic ? ` ${prefixGlyph} ` : `${prefixGlyph} `;
		const prefixWidth = Math.max(1, visibleWidth(prefix));
		if (width <= prefixWidth) {
			this.cachedWidth = width;
			this.cachedChromeKey = chromeKey;
			this.cachedLines = [prefix];
			return this.cachedLines;
		}
		const markdown = markdownColors === "claude"
			? explicitAccent ? this.claudeAccentMd : this.claudeMd
			: this.md;
		const lines = sanitizeRenderedTextBlockLines(markdown.render(width - prefixWidth), markdownStyle);
		const looksLikeTaskStatus = lines.some((line) => /\b(?:transcript:|No output\.|Wrapped up)/.test(stripAnsi(line)));
		const rendered = settings.messageStyle === "classic"
			? renderClassicPrefixedLines(lines, "●", looksLikeTaskStatus)
			: formatTranscriptLines(lines, {
				prefix: settings.assistantPrefix,
				spacing: settings.messageSpacing,
				normalizeChecks: looksLikeTaskStatus,
				visibleWidth,
				dedentWorkedLine: true,
			});
		this.cachedWidth = width;
		this.cachedChromeKey = chromeKey;
		this.cachedLines = rendered;
		return rendered;
	}
}

export class ThinkingParagraph {
	private claudeMd: InstanceType<typeof Markdown>;
	private piMd: InstanceType<typeof Markdown>;
	private cachedWidth?: number;
	private cachedChromeKey?: string;
	private cachedLines?: string[];

	constructor(
		text: string,
		markdownTheme: ConstructorParameters<typeof Markdown>[3],
		defaultTextStyle?: ConstructorParameters<typeof Markdown>[4],
	) {
		// Use a plain theme that strips all color/formatting from thinking blocks.
		// Every element gets the same dim italic treatment, tracking the active
		// pi theme's "muted" color (falls back to the previous gray when no theme).
		const DIM_FG = WORKED_LINE_FG;
		const ITALIC = "\x1b[3m";
		const wrap = (s: string) => `${DIM_FG}${ITALIC}${s}`;
		const plainTheme: ConstructorParameters<typeof Markdown>[3] = {
			heading: wrap,
			link: wrap,
			linkUrl: wrap,
			code: wrap,
			codeBlock: wrap,
			codeBlockIndent: "",
			codeBlockBorder: () => "",
			quote: wrap,
			quoteBorder: () => `${DIM_FG}${ITALIC}▎ `,
			hr: () => `${DIM_FG}${ITALIC}---`,
			listBullet: wrap,
			bold: wrap,
			italic: wrap,
			strikethrough: wrap,
			underline: wrap,
			// Override code highlighting to return plain lines (no syntax colors)
			highlightCode: (code: string, _lang?: string) => code.split("\n").map(line => `${DIM_FG}${ITALIC}${line}`),
		};
		// Same dim gray italic as the base style for all inline text
		const plainStyle: ConstructorParameters<typeof Markdown>[4] = {
			italic: true,
			color: (s: string) => `${DIM_FG}${ITALIC}${s}`,
		};
		this.claudeMd = new Markdown(text, 0, 0, plainTheme, plainStyle);
		this.piMd = new Markdown(text, 0, 0, markdownTheme, defaultTextStyle);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedChromeKey = undefined;
		this.cachedLines = undefined;
		this.claudeMd.invalidate();
		this.piMd.invalidate();
	}

	render(width: number): string[] {
		const settings = getMessageChromeSettings();
		const markdownStyle = resolveMarkdownStyle(readSettings().values);
		const chromeKey = `${messageChromeCacheKey(settings, "thinking")}:${markdownStyle}`;
		if (this.cachedLines && this.cachedWidth === width && this.cachedChromeKey === chromeKey) return this.cachedLines;
		const isClassic = settings.messageStyle === "classic";
		const prefixGlyph = isClassic ? "✻" : settings.thinkingPrefix;
		const coloredPrefixGlyph = `${WORKED_LINE_FG}${prefixGlyph}${RESET}`;
		const prefix = isClassic ? ` ${prefixGlyph} ` : `${prefixGlyph} `;
		const prefixWidth = Math.max(1, visibleWidth(prefix));
		if (width <= prefixWidth) {
			this.cachedWidth = width;
			this.cachedChromeKey = chromeKey;
			this.cachedLines = [isClassic ? ` ${coloredPrefixGlyph} ` : `${coloredPrefixGlyph} `];
			return this.cachedLines;
		}
		const markdown = markdownStyle === "pi" ? this.piMd : this.claudeMd;
		const lines = sanitizeRenderedTextBlockLines(markdown.render(width - prefixWidth), markdownStyle);
		const rendered = settings.messageStyle === "classic"
			? renderClassicPrefixedLines(lines, coloredPrefixGlyph, false)
			: colorFirstTranscriptPrefix(
				formatTranscriptLines(lines, {
					prefix: prefixGlyph,
					spacing: settings.messageSpacing,
					normalizeChecks: false,
					visibleWidth,
				}),
				prefixGlyph,
				coloredPrefixGlyph,
			);
		this.cachedWidth = width;
		this.cachedChromeKey = chromeKey;
		this.cachedLines = rendered;
		return rendered;
	}
}

function userMessageBoxMode(): UserMessageBoxMode {
	const settings = readSettings().values;
	const value = resolveSurfaceColorSource(settings, "userMessageBox");
	if (value === "theme" || value === "claude" || value === "off") return value;
	return storedHexColor(value) ?? "claude";
}

function userMessagePatchRuntime(): UserMessagePatchRuntime {
	return {
		transparentBg: () => TRANSPARENT_BG,
		transparentReset: () => TRANSPARENT_RESET,
		defaultForeground: () => FG_DEFAULT_ANSI,
		workedLineForeground: () => WORKED_LINE_FG,
		claudeBoxBackground: () => CC_USER_BOX_BG,
		claudeBoxTextForeground: () => CC_USER_BOX_TEXT_FG,
		claudeBoxPrefixForeground: () => CC_USER_BOX_PREFIX_FG,
		themeBoxBackground: () => userBoxThemeBg,
		themeBoxPrefixForeground: () => userBoxThemePrefixFg,
		customBoxBackground: (mode) => userBoxCustomBg?.hex === mode ? userBoxCustomBg.ansi : null,
		boxMode: userMessageBoxMode,
		enabled: () => featureEnabled("userMessages"),
	};
}

export function applyUserMessageBox(lines: string[], mode: Exclude<UserMessageBoxMode, "off">, maxWidth: number): string[] {
	return applyUserMessageBoxWithRuntime(userMessagePatchRuntime(), lines, mode, maxWidth);
}

interface ToolFallbackPatchRegistry {
	originalGetTextOutput?: Function;
	originalCreateCallFallback?: Function;
	originalFormatToolExecution?: Function;
	owner?: object;
	sanitize?: boolean;
}
let legacyToolFallbackPatchDetected = false;

function patchToolFallbackSanitization(owner: object): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[TOOL_FALLBACK_SANITIZE_FLAG] === true) {
		legacyToolFallbackPatchDetected = true;
		return;
	}
	let registry = proto[TOOL_FALLBACK_SANITIZE_FLAG] as ToolFallbackPatchRegistry | undefined;
	if (!registry) {
		registry = {
			originalGetTextOutput: proto.getTextOutput,
			originalCreateCallFallback: proto.createCallFallback,
			originalFormatToolExecution: proto.formatToolExecution,
		};
		proto[TOOL_FALLBACK_SANITIZE_FLAG] = registry;
		if (typeof registry.originalGetTextOutput === "function") {
			proto.getTextOutput = function stableGetTextOutput(this: any, ...args: any[]) {
				const output = registry!.originalGetTextOutput!.apply(this, args);
				return registry!.sanitize ? sanitizeToolOutput(output) : output;
			};
		}
		for (const [method, original] of [
			["createCallFallback", registry.originalCreateCallFallback],
			["formatToolExecution", registry.originalFormatToolExecution],
		] as const) {
			if (typeof original !== "function") continue;
			proto[method] = function stableFallbackCall(this: any, ...args: any[]) {
				if (!registry!.sanitize) return original.apply(this, args);
				const toolName = this.toolName;
				if (typeof toolName === "string") this.toolName = sanitizeToolText(toolName);
				try { return original.apply(this, args); }
				finally { this.toolName = toolName; }
			};
		}
	}
	registry.owner = owner;
	registry.sanitize = true;
}

export function releaseToolFallbackSanitization(owner?: object): void {
	const registry = (ToolExecutionComponent.prototype as any)[TOOL_FALLBACK_SANITIZE_FLAG] as ToolFallbackPatchRegistry | undefined;
	if (registry && (owner === undefined || registry.owner === owner)) {
		registry.owner = undefined;
		registry.sanitize = false;
	}
}

function patchToolRenderCacheInvalidation(): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[TOOL_CACHE_PATCH_FLAG]) return;

	const methods = [
		"updateDisplay",
		"updateArgs",
		"markExecutionStarted",
		"setArgsComplete",
		"updateResult",
		"setExpanded",
		"setShowImages",
		"setImageWidthCells",
		"invalidate",
	];

	for (const method of methods) {
		const original = proto[method];
		if (typeof original !== "function") continue;
		proto[method] = function patchedToolMutation(...args: any[]) {
			clearToolRenderCache(this);
			const result = original.apply(this, args);
			clearToolRenderCache(this);
			return result;
		};
	}

	proto[TOOL_CACHE_PATCH_FLAG] = true;
}

function deleteRenderedKittyImages(component: any): void {
	if (!process.stdout.isTTY || getCapabilities().images !== "kitty" || !Array.isArray(component.imageComponents) || component.imageComponents.length === 0) return;
	try { process.stdout.write(deleteAllKittyImages()); } catch { /* noop */ }
}

function removeImageChildren(component: any): void {
	deleteRenderedKittyImages(component);
	const children = [
		...(Array.isArray(component.imageComponents) ? component.imageComponents : []),
		...(Array.isArray(component.imageSpacers) ? component.imageSpacers : []),
	];
	for (const child of children) {
		try { component.removeChild?.(child); } catch { /* noop */ }
	}
	component.imageComponents = [];
	component.imageSpacers = [];
}

function patchReadImageExpansion(): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[TOOL_IMAGE_EXPAND_PATCH_FLAG]) return;
	const originalUpdateDisplay = proto.updateDisplay;
	if (typeof originalUpdateDisplay !== "function") return;
	proto.updateDisplay = function patchedReadImageUpdateDisplay(...args: any[]) {
		const result = originalUpdateDisplay.apply(this, args);
		const hasImage = Array.isArray(this.result?.content) && this.result.content.some((block: any) => block?.type === "image");
		if (this.toolName === "read" && hasImage && this.expanded !== true && !presentationOverrideSkipped("read")) {
			removeImageChildren(this);
			clearToolRenderCache(this);
		}
		return result;
	};
	proto[TOOL_IMAGE_EXPAND_PATCH_FLAG] = true;
}

/**
 * pi wraps each tool row in a Box(paddingX: 1), which indents every ⏺ header one
 * column further than assistant text. Claude Code aligns both at column 0.
 */
function patchToolRowIndent(): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[TOOL_INDENT_PATCH_FLAG]) return;
	const originalUpdateDisplay = proto.updateDisplay;
	if (typeof originalUpdateDisplay !== "function") return;
	proto.updateDisplay = function patchedToolIndentUpdateDisplay(...args: any[]) {
		if (!featureEnabled("toolBackground")) return originalUpdateDisplay.apply(this, args);
		for (const box of [this.contentBox, this.contentText]) {
			if (!box) continue;
			let changed = false;
			if (box.paddingX !== 0) { box.paddingX = 0; changed = true; }
			// The global tool frame removes Box's vertical padding from rendered
			// rows. Leaving it in Box.handleMouse shifts the first visible header
			// into the discarded padding row, so only the result body is clickable.
			if (typeof box.paddingY === "number" && box.paddingY !== 0) { box.paddingY = 0; changed = true; }
			if (changed) box.invalidate?.();
		}
		const result = originalUpdateDisplay.apply(this, args);
		syncToolBackgroundMode();
		if (effectiveToolBackgroundMode() !== "default") {
			// Do not depend on extension ordering or theme mutation timing: reload may
			// construct a settled row while Pi's success background is still green.
			// Neutralize the row's own background functions after updateDisplay installs
			// them, while diff rows retain their intentional add/remove backgrounds.
			this.contentBox?.setBgFn?.((text: string) => text);
			this.contentText?.setCustomBgFn?.((text: string) => text);
		}
		return result;
	};
	proto[TOOL_INDENT_PATCH_FLAG] = true;
}

let legacyToolRendererPatchDetected = false;

function patchToolExecutionRenderers(owner: object): void {
	legacyToolRendererPatchDetected = installToolRendererPatch(owner, {
		presentationSkipped: presentationOverrideSkipped,
		shouldUseGeneric: shouldUseGenericToolRenderer,
		renderApplyCall: (args, theme, ctx) => renderApplyPatchCall(args, theme, ctx, (path) => shortPath(ctx.cwd ?? process.cwd(), path)),
		renderApplyResult: (result, options, theme, ctx) => renderApplyPatchResult(result, !!options?.isPartial, theme, ctx),
		renderGenericCall: renderGenericToolCall,
		renderGenericResult: renderGenericToolResult,
		diagnostic: (key, error) => debugDiagnostic(key, error),
	});
}

function installCompatibleToolPresentations(owner: object, adapters: Iterable<any>): void {
	if (installToolPresentations(owner, adapters)) bumpToolPresentationRevision();
}

function releaseToolExecutionRenderers(owner: object): void {
	releaseToolRendererPatch(owner);
}

function shortPath(cwd: string, filePath: string): string {
	if (!filePath) return "";
	const rel = relative(cwd, filePath);
	const display = !rel.startsWith("..") && !rel.startsWith("/")
		? rel || "."
		: (process.env.HOME ?? "") ? filePath.replace(process.env.HOME ?? "", "~") : filePath;
	return sanitizeToolText(display);
}

// ---------------------------------------------------------------------------
// Status dot — flickers green/gray while pending
// ---------------------------------------------------------------------------

function isBlinkOn(): boolean {
	return Math.floor(Date.now() / 500) % 2 === 0;
}

/**
 * Claude Code's header is `⏺ ` + bold tool name + `(` + argument + `)`, all in the
 * default foreground — the argument is emphasized by an OSC 8 hyperlink and the
 * name by bold, never by hue. Callers pass the argument already linked.
 */
function toolLineBackgroundReset(): string {
	syncToolBackgroundMode();
	return toolBackgroundMode === "default" ? "" : TRANSPARENT_BG;
}

function toolHeader(tool: string, summary: string, theme: Theme, prefix = ""): string {
	applyThemePaletteIfNeeded(theme);
	const rowBg = toolLineBackgroundReset();
	if (!claudeChromeEnabled()) {
		const themed = theme.fg("toolTitle", theme.bold(tool));
		if (!summary) return `${rowBg}${prefix}${themed}`;
		return `${rowBg}${prefix}${themed}${theme.fg("muted", "(")}${WRAP_MARK}${theme.fg("accent", summary)}${theme.fg("muted", ")")}`;
	}
	const label = `${FG_DEFAULT}${D_BOLD_ON}${tool}${D_BOLD_OFF}`;
	if (!summary) return `${rowBg}${prefix}${label}${RESET}`;
	return `${rowBg}${prefix}${label}(${WRAP_MARK}${summary}${FG_DEFAULT})${RESET}`;
}

/** Claude Code bolds the counts and paths inside result rows. */
function ccEmphasis(): SummaryEmphasis {
	if (!claudeChromeEnabled()) return {};
	return { emphasize: (text: string) => `${D_BOLD_ON}${text}${D_BOLD_OFF}` };
}

/** Result sentences read in the default foreground under Claude chrome, not muted. */
function resultSentence(theme: Theme, text: string): string {
	return claudeChromeEnabled() ? `${FG_DEFAULT}${text}${RESET}` : theme.fg("muted", text);
}

function errorText(theme: Theme, text: string): string {
	return claudeChromeEnabled() ? `${CC_DOT_ERROR}${text}${RESET}` : theme.fg("error", text);
}

function setToolStatus(ctx: any, status: "pending" | "success" | "error"): void {
	ctx.state._toolStatus = status;
}

function syncToolCallStatus(ctx: any): void {
	if (!ctx?.executionStarted || ctx?.isPartial) {
		setToolStatus(ctx, "pending");
		return;
	}
	setToolStatus(ctx, ctx.isError ? "error" : "success");
}

function shouldRevealCallArgs(ctx: any): boolean {
	if (ctx?.argsComplete === true || ctx?.executionStarted === true) return true;
	const args = ctx?.args;
	if (!args || typeof args !== "object") return false;
	return Object.keys(args).some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "");
}

function stableCallSummary(ctx: any, key: string, build: () => string, reveal = shouldRevealCallArgs(ctx)): string {
	const state = ctx?.state;
	const cached = state?.[key];
	const completeKey = `${key}Complete`;
	if (!reveal) return typeof cached === "string" ? cached : "";
	if (ctx?.argsComplete === true && state?.[completeKey] === true && typeof cached === "string") return cached;
	if (!shouldRevealCallArgs(ctx) && typeof cached === "string" && cached) return cached;
	const summary = build();
	if (state) {
		state[key] = summary;
		if (ctx?.argsComplete === true) state[completeKey] = true;
		else delete state[completeKey];
	}
	return summary;
}

function hasOwnArg(args: any, key: string): boolean {
	return !!args && Object.prototype.hasOwnProperty.call(args, key);
}

function fileExistsForTool(cwd: string, filePath: string): boolean {
	if (!filePath) return false;
	try {
		return existsSync(resolve(cwd, filePath));
	} catch {
		return false;
	}
}

function toolStatusDot(ctx: any, theme: Theme): string {
	applyThemePaletteIfNeeded(theme);
	const status = ctx.state?._toolStatus as "pending" | "success" | "error" | undefined;
	if (!claudeChromeEnabled()) {
		if (status === "error") return `${theme.fg("error", CLAUDE_TOOL_GLYPH)} `;
		if (status === "success") return `${theme.fg("accent", CLAUDE_TOOL_GLYPH)} `;
		return `${blinkDot(ctx, theme)} `;
	}
	// Claude Code: gray while running, green on success, red on failure.
	if (status === "error") return `${CC_DOT_ERROR}${CLAUDE_TOOL_GLYPH}${RESET} `;
	if (status === "success") return `${CC_DOT_SUCCESS}${CLAUDE_TOOL_GLYPH}${RESET} `;
	return `${CC_DOT_PENDING}${CLAUDE_TOOL_GLYPH}${RESET} `;
}

// ---------------------------------------------------------------------------
// Branch connector — visual tree from header to output
// ---------------------------------------------------------------------------

function branchIndent(text: string, _continued = false): string {
	return `${toolLineBackgroundReset()}${CLAUDE_RESULT_CONTINUATION}${WRAP_MARK}${text}`;
}

function branchLead(text: string, _continued = false): string {
	const gutter = claudeChromeEnabled() ? CC_GUTTER_FG : TOOL_RULE;
	return `${toolLineBackgroundReset()}${gutter}${CLAUDE_RESULT_PREFIX}${TRANSPARENT_RESET}${WRAP_MARK}${text}`;
}

function withBranch(content: string, _theme: Theme, _isError = false, continued = false): string {
	if (!content || !content.trim()) return "";
	const lines = content.split("\n");
	const first = lines[0] ?? "";
	if (lines.length === 1) return branchLead(first, continued);
	const rest = lines.slice(1).map((line) => branchIndent(line, continued));
	return `${branchLead(first, continued)}\n${rest.join("\n")}`;
}

function withFinalBranchBlock(content: string, theme: Theme, isError = false): string {
	return withBranch(content, theme, isError);
}

function indentBranchBlock(block: string): string {
	return block;
}

// ---------------------------------------------------------------------------
// Blink timer for partial (running) states
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Global blink timer — single timer invalidates all active contexts
// ---------------------------------------------------------------------------

const blinkScheduler = new BlinkScheduler(5, 500);

function setupBlinkTimer(ctx: any): void { blinkScheduler.start(ctx); }
function clearBlinkTimer(ctx: any): void { blinkScheduler.stop(ctx); }
function blinkDot(ctx: any, theme: Theme): string {
	return blinkScheduler.isBright(ctx) ? theme.fg("accent", CLAUDE_TOOL_GLYPH) : theme.fg("muted", CLAUDE_TOOL_GLYPH);
}

function lineCount(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

/** Lines actually written — a single trailing newline terminates, it doesn't add a line. */
function writtenLineCount(text: string): number {
	if (!text) return 0;
	const body = text.endsWith("\n") ? text.slice(0, -1) : text;
	return body.length === 0 ? 0 : body.split("\n").length;
}

function padToWidth(line: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(line));
	return `${line}${" ".repeat(padding)}`;
}

function markedContinuationPrefix(prefix: string): string {
	const plain = stripAnsi(prefix);
	const branchMatch = /^(\s*)(?:│  |├─ |└─ )/.exec(plain);
	if (branchMatch) {
		return `${branchMatch[1]}${TOOL_RULE}│${TRANSPARENT_RESET}  `;
	}
	const resultMatch = /^(\s*)⎿\s+/.exec(plain);
	if (resultMatch) return " ".repeat(visibleWidth(prefix));
	return " ".repeat(visibleWidth(prefix));
}

function wrapMarkedLine(line: string, width: number): string[] {
	const markerIndex = line.indexOf(WRAP_MARK);
	if (markerIndex === -1) return wrapTextWithAnsi(line, width);
	const prefix = line.slice(0, markerIndex);
	const body = line.slice(markerIndex + WRAP_MARK.length);
	const prefixWidth = visibleWidth(prefix);
	const bodyWidth = Math.max(1, width - prefixWidth);
	const wrapped = wrapTextWithAnsi(body, bodyWidth);
	const continuation = markedContinuationPrefix(prefix);
	return wrapped.map((part, index) => (index === 0 ? `${prefix}${part}` : `${continuation}${part}`));
}

function renderToolTextLines(text: string, width: number): string[] {
	return new ToolText(text).render(width);
}

/** Diff builders already wrap and pad against the exact component width. Running
 * those rows through Text again strips their styled trailing cells, so the green
 * or red background ends at the last token instead of the terminal edge. */
function renderPrewrappedDiffLines(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => {
		const clean = line.split(WRAP_MARK).join("");
		return visibleWidth(clean) <= width ? [clean] : wrapTextWithAnsi(clean, width);
	});
}

class ToolText extends Text {
	private value = "";
	private toolCachedValue?: string;
	private toolCachedWidth?: number;
	private toolCachedLines?: string[];

	constructor(text = "") {
		super("", 0, 0);
		this.value = text;
	}

	setText(text: string): void {
		if (this.value === text) return;
		this.value = text;
		this.invalidate();
	}

	invalidate(): void {
		this.toolCachedValue = undefined;
		this.toolCachedWidth = undefined;
		this.toolCachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.toolCachedLines && this.toolCachedValue === this.value && this.toolCachedWidth === width) return this.toolCachedLines;
		if (!this.value || this.value.trim() === "") {
			this.toolCachedValue = this.value;
			this.toolCachedWidth = width;
			this.toolCachedLines = [];
			return this.toolCachedLines;
		}
		const contentWidth = Math.max(1, width);
		const lines = this.value.replace(/\t/g, "   ").split("\n");
		const rendered = lines.flatMap((line) => wrapMarkedLine(line, contentWidth)).map((line) => padToWidth(line, width));
		this.toolCachedValue = this.value;
		this.toolCachedWidth = width;
		this.toolCachedLines = rendered;
		return rendered;
	}
}

function makeText(last: unknown, text: string): Text {
	const component = last instanceof ToolText ? last : new ToolText();
	component.setText(text);
	return component;
}

function previewLimit(): number {
	const value = readSettings().values.previewLines;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 8;
}

function expandedPreviewLimit(): number {
	const value = readSettings().values.expandedPreviewMaxLines;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_EXPANDED_PREVIEW_MAX_LINES;
}

function bashCollapsedLimit(): number {
	const value = readSettings().values.bashCollapsedLines;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 10;
}

function bashRunningPreview(): "head" | "tail" {
	return getMode(readSettings().values.bashRunningPreview, ["head", "tail"] as const, "head");
}

function bashOutputMode(): "opencode" | "summary" | "preview" {
	return getMode(readSettings().values.bashOutputMode, ["opencode", "summary", "preview"] as const, "opencode");
}

function bashSemanticDisplayEnabled(): boolean {
	return readSettings().values.bashSemanticDisplay !== false;
}

function diffCollapsedLimit(): number {
	const value = readSettings().values.diffCollapsedLines;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 10;
}

function collapsedPreviewCount(expanded: boolean, fallback: number): number {
	return expanded ? expandedPreviewLimit() : fallback;
}

function buildPreviewText(lines: string[], expanded: boolean, theme: Theme, fallbackCollapsed = 8): string {
	if (lines.length === 0) return theme.fg("muted", "(no output)");
	const maxLines = collapsedPreviewCount(expanded, fallbackCollapsed);
	const shown = lines.slice(0, maxLines);
	let text = shown.join("\n");
	const remaining = lines.length - shown.length;
	if (remaining > 0) {
		text += `\n${theme.fg("muted", `… +${remaining} lines${expanded ? "" : " (ctrl+o to expand)"}`)}`;
	}
	if (expanded && lines.length > maxLines) {
		text += `\n${theme.fg("warning", `(display capped at ${maxLines} lines)`)}`;
	}
	return text;
}

function visualPreviewText(
	text: string,
	width: number,
	rows: number,
	mode: VisualPreviewMode,
	theme: Theme,
	style: "dim" | "error" | "claudeError",
	options: { expandHint?: boolean; expandedCap?: boolean; laterQualifier?: "more" } = {},
): string {
	const preview = selectVisualPreview(text, Math.max(10, width - visibleWidth(CLAUDE_RESULT_PREFIX)), rows, mode);
	const lines = preview.rows.map((line) => style === "claudeError"
		? errorText(theme, line || " ")
		: theme.fg(style, line || " "));
	if (preview.hiddenPosition) {
		const qualifier = preview.hiddenPosition === "earlier" ? " earlier" : options.laterQualifier ? ` ${options.laterQualifier}` : "";
		const hint = options.expandHint ? " (ctrl+o to expand)" : "";
		lines[preview.hiddenPosition === "earlier" ? "unshift" : "push"](
			theme.fg("muted", `… +${preview.hiddenRows}${qualifier} lines${hint}`),
		);
		if (options.expandedCap) lines.push(theme.fg("warning", `(display capped at ${rows} lines)`));
	}
	return lines.join("\n");
}

// ===========================================================================
// Diff rendering — adapted from /tmp/pi-diff
// ===========================================================================

interface DiffPreset {
	name: string;
	description: string;
	shikiTheme?: string;
	bgAdd?: string;
	bgDel?: string;
	bgAddHighlight?: string;
	bgDelHighlight?: string;
	bgGutterAdd?: string;
	bgGutterDel?: string;
	bgEmpty?: string;
	fgAdd?: string;
	fgDel?: string;
	fgDim?: string;
	fgLnum?: string;
	fgRule?: string;
	fgStripe?: string;
	fgSafeMuted?: string;
}

interface DiffUserConfig {
	diffTheme?: string;
	diffColors?: Record<string, string>;
}

const DIFF_PRESETS: Record<string, DiffPreset> = {
	default: {
		name: "default",
		description: "Original pi-diff colors",
		bgAdd: "#162620",
		bgDel: "#2d1919",
		bgAddHighlight: "#234b32",
		bgDelHighlight: "#502323",
		bgGutterAdd: "#12201a",
		bgGutterDel: "#261616",
		bgEmpty: "#121212",
		fgDim: "#505050",
		fgLnum: "#646464",
		fgRule: "#323232",
		fgStripe: "#282828",
		fgSafeMuted: "#8b949e",
	},
	midnight: {
		name: "midnight",
		description: "Subtle tints for black backgrounds",
		bgAdd: "#0d1a12",
		bgDel: "#1a0d0d",
		bgAddHighlight: "#1a3825",
		bgDelHighlight: "#381a1a",
		bgGutterAdd: "#091208",
		bgGutterDel: "#120908",
		bgEmpty: "#080808",
		fgDim: "#404040",
		fgLnum: "#505050",
		fgRule: "#282828",
		fgStripe: "#1e1e1e",
		fgSafeMuted: "#8b949e",
	},
	neon: {
		name: "neon",
		description: "Higher contrast backgrounds",
		bgAdd: "#1a3320",
		bgDel: "#331a16",
		bgAddHighlight: "#2d5c3a",
		bgDelHighlight: "#5c2d2d",
		bgGutterAdd: "#142818",
		bgGutterDel: "#28120e",
		bgEmpty: "#141414",
		fgDim: "#606060",
		fgLnum: "#787878",
		fgRule: "#404040",
		fgStripe: "#303030",
		fgSafeMuted: "#9da5ae",
	},
};

export const DIFF_PRESET_KEYS: readonly string[] = Object.keys(DIFF_PRESETS);

let diffThemePreview: string | null | undefined;

function loadDiffConfig(): DiffUserConfig {
	const settings = readSettings().values;
	// `diffPresentation: false` ignores diffTheme/diffColors (and any live
	// picker preview) entirely, so diffs always reset to Claude's built-in
	// default palette — existing style settings stay subordinate to the gate.
	if (!featureEnabled("diffPresentation")) return {};
	return {
		diffTheme: diffThemePreview === undefined ? settings.diffTheme : (diffThemePreview ?? undefined),
		diffColors: settings.diffColors,
	};
}

// ---------------------------------------------------------------------------
// Theme palette extraction — pull RGB from the active pi theme so our
// hardcoded greys and accent colors track the user's selected theme.
//
// `theme.getFgAnsi(name)` / `theme.getBgAnsi(name)` return raw ANSI escapes
// (either truecolor or 256color depending on the terminal). We parse those
// back into RGB so we can mix tints for diff backgrounds.
// ---------------------------------------------------------------------------

function safeFgAnsi(theme: any, key: string): string | null {
	try {
		const ansi = theme?.getFgAnsi?.(key);
		return typeof ansi === "string" && ansi.length > 0 ? ansi : null;
	} catch {
		return null;
	}
}

function safeBgAnsi(theme: any, key: string): string | null {
	try {
		const ansi = theme?.getBgAnsi?.(key);
		return typeof ansi === "string" && ansi.length > 0 ? ansi : null;
	} catch {
		return null;
	}
}

function themeFgRgb(theme: any, key: string): Rgb | null {
	const ansi = safeFgAnsi(theme, key);
	return ansi ? parseAnsiRgb(ansi) : null;
}

function themeBgRgb(theme: any, key: string): Rgb | null {
	const ansi = safeBgAnsi(theme, key);
	return ansi ? parseAnsiRgb(ansi) : null;
}

// Cache theme identity so we only recompute on theme change. The Theme
// object is reused across renders within a single session unless the user
// switches themes via the picker.
let _themePaletteCacheTheme: unknown = null;

function themeAdaptiveEnabled(): boolean {
	const settings = readSettings().values;
	return settings.themeAdaptive !== false;
}

/**
 * When on (the default), diffs use Claude Code's fixed palette and unified layout
 * instead of deriving colors from the active pi theme. Set `diffPalette: "theme"`
 * to get the theme-derived tints back.
 */
function claudeDiffPaletteEnabled(): boolean {
	// This setting also selects unified versus legacy split grammar, so a global
	// color-source change must not alter it implicitly.
	return readSettings().values.diffPalette !== "theme";
}

/**
 * When on (the default), tool rows use Claude Code's chrome: status-colored bullet
 * (gray → green), bold tool name in the default foreground, and OSC 8 hyperlinked
 * paths. Set `toolChrome: "theme"` to keep the themed/accent-tinted rows.
 */
function claudeChromeEnabled(): boolean {
	// Tool chrome changes wording and hyperlink grammar as well as color.
	return readSettings().values.toolChrome !== "theme";
}

// Claude Code highlights diff content with a Monokai palette (fg 248,248,242,
// keywords 102,217,239, numbers 190,132,255).
let DIFF_THEME: BundledTheme = (process.env.DIFF_THEME as BundledTheme | undefined) ?? "monokai";
const SPLIT_MIN_WIDTH = 150;
const SPLIT_MIN_CODE_WIDTH = 60;
const SPLIT_MAX_WRAP_RATIO = 0.2;
const SPLIT_MAX_WRAP_LINES = 8;
const MAX_TERM_WIDTH = 210;
const DEFAULT_TERM_WIDTH = 200;
const MAX_PREVIEW_LINES = 60;
const MAX_RENDER_LINES = 150;
const MAX_HL_CHARS = 32_000;
const CACHE_LIMIT = 48;
const WORD_DIFF_MIN_SIM = 0.15;
const MAX_WRAP_ROWS_WIDE = 3;
const MAX_WRAP_ROWS_MED = 2;
const MAX_WRAP_ROWS_NARROW = 1;

let D_RST = "\x1b[0m";
const D_BOLD = "\x1b[1m";
const D_DIM = "\x1b[2m";

// Claude Code's diff palette, read off the raw TTY stream. The line background is
// painted across gutter and content; the changed token gets the brighter variant.
// See docs/plans/2026-07-13-current-cc-grammar.md.
// Fresh v2.1.266 capture uses xterm 22/52 line backgrounds and xterm 28
// only for the changed word on additions. Store their exact RGB equivalents.
const CC_BG_ADD = "\x1b[48;2;0;95;0m";
const CC_BG_DEL = "\x1b[48;2;95;0;0m";
const CC_BG_ADD_WORD = "\x1b[48;2;0;135;0m";
const CC_BG_DEL_WORD = CC_BG_DEL;
const CC_FG_ADD = "\x1b[38;2;95;215;95m";
const CC_FG_DEL = "\x1b[38;2;215;95;95m";
const CC_FG_DIFF_TEXT_DARK = "\x1b[38;2;255;255;255m";
const CC_BG_ADD_LIGHT = "\x1b[48;2;215;255;215m";
const CC_BG_DEL_LIGHT = "\x1b[48;2;255;215;215m";
const CC_BG_ADD_WORD_LIGHT = "\x1b[48;2;175;255;175m";
const CC_FG_ADD_LIGHT = "\x1b[38;2;0;135;95m";
const CC_FG_DEL_LIGHT = "\x1b[38;2;215;0;0m";
const CC_FG_DIFF_TEXT_LIGHT = "\x1b[38;2;48;48;48m";
let CC_FG_DIFF_TEXT = CC_FG_DIFF_TEXT_DARK;
let claudeDiffLightMode = false;

// Diff backgrounds default to Claude Code's palette; autoDeriveBgFromTheme only
// overrides them when the user opts out of the Claude palette.
let BG_ADD = CC_BG_ADD;
let BG_DEL = CC_BG_DEL;
let BG_ADD_W = CC_BG_ADD_WORD;
let BG_DEL_W = CC_BG_DEL_WORD;
let BG_GUTTER_ADD = CC_BG_ADD;
let BG_GUTTER_DEL = CC_BG_DEL;
let BG_EMPTY = "\x1b[49m";
let BG_BASE = "\x1b[49m";

let FG_ADD = CC_FG_ADD;
let FG_DEL = CC_FG_DEL;
let FG_DIM = "\x1b[38;2;80;80;80m";
let FG_LNUM = "\x1b[38;2;100;100;100m";
let FG_RULE = "\x1b[38;2;50;50;50m";
let TOOL_RULE = "\x1b[38;2;153;153;153m";
let FG_SAFE_MUTED = "\x1b[38;2;139;148;158m";
let FG_STRIPE = "\x1b[38;2;40;40;40m";

let DIVIDER = `${FG_RULE}│${D_RST}`;

interface DiffColors {
	fgAdd: string;
	fgDel: string;
	fgCtx: string;
}

let DEFAULT_DIFF_COLORS: DiffColors = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
let autoDerivePending = true;
let hasExplicitBgConfig = false;
let explicitDiffLightMode: boolean | undefined;

function mixBg(
	base: { r: number; g: number; b: number },
	accent: { r: number; g: number; b: number },
	intensity: number,
): string {
	const r = Math.round(base.r + (accent.r - base.r) * intensity);
	const g = Math.round(base.g + (accent.g - base.g) * intensity);
	const b = Math.round(base.b + (accent.b - base.b) * intensity);
	return `\x1b[48;2;${r};${g};${b}m`;
}

// pi-tool-display tint targets for diff palette derivation
const ADDITION_TINT_TARGET = { r: 84, g: 190, b: 118 };
const DELETION_TINT_TARGET = { r: 232, g: 95, b: 122 };
// Fallback base that matches most dark themes (NOT black)
const FALLBACK_BASE_BG = { r: 32, g: 35, b: 42 };
const UNIVERSAL_DIFF_ADD_FG = { r: 110, g: 210, b: 130 };
const UNIVERSAL_DIFF_DEL_FG = { r: 225, g: 110, b: 110 };

function applyClaudeDiffPalette(theme: any): boolean {
	const polarity = themePolarity(theme);
	if (polarity === "unknown") return false;
	claudeDiffLightMode = polarity === "light";
	if (claudeDiffLightMode) {
		BG_ADD = CC_BG_ADD_LIGHT;
		BG_DEL = CC_BG_DEL_LIGHT;
		BG_ADD_W = CC_BG_ADD_WORD_LIGHT;
		BG_DEL_W = CC_BG_DEL_LIGHT;
		BG_GUTTER_ADD = CC_BG_ADD_LIGHT;
		BG_GUTTER_DEL = CC_BG_DEL_LIGHT;
		FG_ADD = CC_FG_ADD_LIGHT;
		FG_DEL = CC_FG_DEL_LIGHT;
		CC_FG_DIFF_TEXT = CC_FG_DIFF_TEXT_LIGHT;
	} else {
		BG_ADD = CC_BG_ADD;
		BG_DEL = CC_BG_DEL;
		BG_ADD_W = CC_BG_ADD_WORD;
		BG_DEL_W = CC_BG_DEL_WORD;
		BG_GUTTER_ADD = CC_BG_ADD;
		BG_GUTTER_DEL = CC_BG_DEL;
		FG_ADD = CC_FG_ADD;
		FG_DEL = CC_FG_DEL;
		CC_FG_DIFF_TEXT = CC_FG_DIFF_TEXT_DARK;
	}
	BG_EMPTY = TRANSPARENT_BG;
	BG_BASE = TRANSPARENT_BG;
	D_RST = TRANSPARENT_RESET;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
	return true;
}

function applyUnknownPolarityDiffPalette(theme: any): void {
	claudeDiffLightMode = false;
	BG_ADD = BG_DEL = BG_ADD_W = BG_DEL_W = TRANSPARENT_BG;
	BG_GUTTER_ADD = BG_GUTTER_DEL = TRANSPARENT_BG;
	BG_EMPTY = BG_BASE = TRANSPARENT_BG;
	FG_ADD = safeFgAnsi(theme, "toolDiffAdded") ?? safeFgAnsi(theme, "success") ?? FG_DEFAULT;
	FG_DEL = safeFgAnsi(theme, "toolDiffRemoved") ?? safeFgAnsi(theme, "error") ?? FG_DEFAULT;
	CC_FG_DIFF_TEXT = safeFgAnsi(theme, "text") ?? FG_DEFAULT;
	D_RST = TRANSPARENT_RESET;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: safeFgAnsi(theme, "toolDiffContext") ?? FG_DEFAULT };
}

function autoDeriveBgFromTheme(theme: any): void {
	// Claude has dedicated dark and light semantic palettes; neither is derived
	// from Pi success/error colors. Unknown polarity stays transparent and uses
	// theme semantic foreground escapes without inventing a dark RGB base.
	if (claudeDiffPaletteEnabled()) {
		if (!applyClaudeDiffPalette(theme)) applyUnknownPolarityDiffPalette(theme);
		return;
	}
	if (themePolarity(theme) === "unknown") {
		applyUnknownPolarityDiffPalette(theme);
		return;
	}
	// Diff palette derivation.
	//
	// `toolDiffAdded` / `toolDiffRemoved` from the active pi theme give us the
	// fg accents. The base background is taken from `toolSuccessBg` (close to
	// the panel color the row will sit on) so the tinted backgrounds blend in
	// instead of forcing a hardcoded dark hue. Falls back to the universal
	// dark palette when the theme is unavailable or themeAdaptive=false.
	const useTheme = themeAdaptiveEnabled() && theme;
	const addFgRgb = (useTheme && themeFgRgb(theme, "toolDiffAdded")) || UNIVERSAL_DIFF_ADD_FG;
	const delFgRgb = (useTheme && themeFgRgb(theme, "toolDiffRemoved")) || UNIVERSAL_DIFF_DEL_FG;
	const base = (useTheme && themeBgRgb(theme, "toolSuccessBg")) || FALLBACK_BASE_BG;

	const addTint = mixRgb(addFgRgb, ADDITION_TINT_TARGET, 0.35);
	const delTint = mixRgb(delFgRgb, DELETION_TINT_TARGET, 0.65);

	FG_ADD = `\x1b[38;2;${Math.round(addFgRgb.r)};${Math.round(addFgRgb.g)};${Math.round(addFgRgb.b)}m`;
	FG_DEL = `\x1b[38;2;${Math.round(delFgRgb.r)};${Math.round(delFgRgb.g)};${Math.round(delFgRgb.b)}m`;
	BG_ADD = rgbToBgAnsi(mixRgb(base, addTint, 0.24));
	BG_DEL = rgbToBgAnsi(mixRgb(base, delTint, 0.12));
	BG_ADD_W = rgbToBgAnsi(mixRgb(base, addTint, 0.44));
	BG_DEL_W = rgbToBgAnsi(mixRgb(base, delTint, 0.26));
	BG_GUTTER_ADD = rgbToBgAnsi(mixRgb(base, addTint, 0.14));
	BG_GUTTER_DEL = rgbToBgAnsi(mixRgb(base, delTint, 0.08));
	BG_EMPTY = TRANSPARENT_BG;
	BG_BASE = TRANSPARENT_BG;
	D_RST = TRANSPARENT_RESET;
	DIVIDER = `${FG_RULE}│${D_RST}`;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
}

// Track which palette fields the user explicitly set so theme-derived
// updates don't clobber their config.
const _explicitFgFields = new Set<"fgAdd" | "fgDel" | "fgDim" | "fgLnum" | "fgRule" | "fgStripe" | "fgSafeMuted">();

export function applyThemePaletteIfNeeded(theme: any): void {
	if (!theme || !featureEnabled("themeColors")) return;
	// Runs before the adaptive/cache guards: captured Claude dark/light palettes
	// and accent overrides apply even when theme-derived colors are disabled.
	applyAccentOverride(theme);
	const polarity = themePolarity(theme);
	if (polarity === "unknown") {
		CC_DOT_PENDING = safeFgAnsi(theme, "muted") ?? CLAUDE_PALETTE.status.pending;
		CC_DOT_SUCCESS = safeFgAnsi(theme, "success") ?? CLAUDE_PALETTE.status.success;
		CC_DOT_ERROR = safeFgAnsi(theme, "error") ?? CLAUDE_PALETTE.status.error;
		CC_GUTTER_FG = safeFgAnsi(theme, "muted") ?? CLAUDE_PALETTE.gutter;
	} else {
		const light = polarity === "light";
		CC_DOT_PENDING = light ? CLAUDE_PALETTE.statusLight.pending : CLAUDE_PALETTE.status.pending;
		CC_DOT_SUCCESS = light ? CLAUDE_PALETTE.statusLight.success : CLAUDE_PALETTE.status.success;
		CC_DOT_ERROR = light ? CLAUDE_PALETTE.statusLight.error : CLAUDE_PALETTE.status.error;
		CC_GUTTER_FG = light ? CLAUDE_PALETTE.gutterLight : CLAUDE_PALETTE.gutter;
	}
	if (claudeDiffPaletteEnabled() && !hasExplicitBgConfig) {
		if (!applyClaudeDiffPalette(theme)) applyUnknownPolarityDiffPalette(theme);
	} else {
		claudeDiffLightMode = explicitDiffLightMode ?? polarity === "light";
	}
	if (!themeAdaptiveEnabled()) return;
	if (_themePaletteCacheTheme === theme) return; // already applied for this theme instance
	_themePaletteCacheTheme = theme;
	bumpDiffPresentationEpoch();

	// Borders (top/bottom outlines, user-message frame, branch rule).
	const borderMuted = safeFgAnsi(theme, "borderMuted");
	if (borderMuted) BORDER_COLOR = borderMuted;

	// "Worked for Ns" line + thinking-block italics share pi's `muted` color.
	const muted = safeFgAnsi(theme, "muted");
	if (muted) WORKED_LINE_FG = muted;

	// Tool branch rule (├─ / └─ connectors). Use `dim` if present, else `muted`.
	const dim = safeFgAnsi(theme, "dim") ?? muted;
	if (dim) TOOL_RULE = dim;

	// Diff support text colors. These are user-overridable via diffColors.* so
	// we only touch the ones not explicitly set.
	if (!_explicitFgFields.has("fgDim") && muted) FG_DIM = muted;
	if (!_explicitFgFields.has("fgLnum") && muted) FG_LNUM = muted;
	if (!_explicitFgFields.has("fgRule") && borderMuted) FG_RULE = borderMuted;
	if (!_explicitFgFields.has("fgStripe") && borderMuted) FG_STRIPE = borderMuted;
	if (!_explicitFgFields.has("fgSafeMuted") && muted) FG_SAFE_MUTED = muted;

	DIVIDER = `${FG_RULE}│${D_RST}`;

	// Re-trigger background derivation against the new theme unless the user
	// set explicit bg overrides via diffTheme/diffColors.
	if (!hasExplicitBgConfig) {
		autoDeriveBgFromTheme(theme);
		autoDerivePending = false;
	}
}

export function applyDiffPalette(): void {
	BG_ADD = CC_BG_ADD;
	BG_DEL = CC_BG_DEL;
	BG_ADD_W = CC_BG_ADD_WORD;
	BG_DEL_W = CC_BG_DEL_WORD;
	BG_GUTTER_ADD = CC_BG_ADD;
	BG_GUTTER_DEL = CC_BG_DEL;
	BG_EMPTY = TRANSPARENT_BG;
	BG_BASE = TRANSPARENT_BG;
	FG_ADD = CC_FG_ADD;
	FG_DEL = CC_FG_DEL;
	FG_DIM = "\x1b[38;2;80;80;80m";
	FG_LNUM = "\x1b[38;2;100;100;100m";
	FG_RULE = "\x1b[38;2;50;50;50m";
	FG_STRIPE = "\x1b[38;2;40;40;40m";
	FG_SAFE_MUTED = "\x1b[38;2;139;148;158m";
	DIFF_THEME = (process.env.DIFF_THEME as BundledTheme | undefined) ?? "monokai";
	hasExplicitBgConfig = false;
	explicitDiffLightMode = undefined;
	_explicitFgFields.clear();

	const config = loadDiffConfig();
	const preset = config.diffTheme ? DIFF_PRESETS[config.diffTheme] : null;
	if (preset) hasExplicitBgConfig = true;
	const overrides = config.diffColors ?? {};
	if (Object.keys(overrides).length > 0) hasExplicitBgConfig = true;

	const applyBg = (key: string, presetValue: string | undefined, set: (value: string) => void) => {
		const hex = overrides[key] ?? presetValue;
		if (!hex) return;
		const ansi = hexToBgAnsi(hex);
		if (ansi) set(ansi);
	};
	const applyFg = (
		key: "fgAdd" | "fgDel" | "fgDim" | "fgLnum" | "fgRule" | "fgStripe" | "fgSafeMuted",
		presetValue: string | undefined,
		set: (value: string) => void,
	) => {
		const hex = overrides[key] ?? presetValue;
		if (!hex) return;
		const ansi = hexToFgAnsi(hex);
		if (!ansi) return;
		set(ansi);
		_explicitFgFields.add(key);
	};

	applyBg("bgAdd", preset?.bgAdd, (v) => {
		BG_ADD = v;
	});
	applyBg("bgDel", preset?.bgDel, (v) => {
		BG_DEL = v;
	});
	applyBg("bgAddHighlight", preset?.bgAddHighlight, (v) => {
		BG_ADD_W = v;
	});
	applyBg("bgDelHighlight", preset?.bgDelHighlight, (v) => {
		BG_DEL_W = v;
	});
	applyBg("bgGutterAdd", preset?.bgGutterAdd, (v) => {
		BG_GUTTER_ADD = v;
	});
	applyBg("bgGutterDel", preset?.bgGutterDel, (v) => {
		BG_GUTTER_DEL = v;
	});
	applyBg("bgEmpty", preset?.bgEmpty, (v) => {
		BG_EMPTY = v;
	});

	applyFg("fgAdd", preset?.fgAdd, (v) => {
		FG_ADD = v;
	});
	applyFg("fgDel", preset?.fgDel, (v) => {
		FG_DEL = v;
	});
	applyFg("fgDim", preset?.fgDim, (v) => {
		FG_DIM = v;
	});
	applyFg("fgLnum", preset?.fgLnum, (v) => {
		FG_LNUM = v;
	});
	applyFg("fgRule", preset?.fgRule, (v) => {
		FG_RULE = v;
	});
	applyFg("fgStripe", preset?.fgStripe, (v) => {
		FG_STRIPE = v;
	});
	applyFg("fgSafeMuted", preset?.fgSafeMuted, (v) => {
		FG_SAFE_MUTED = v;
	});

	const effectiveBackground = overrides.bgAdd ?? preset?.bgAdd;
	const effectiveBackgroundRgb = effectiveBackground ? colorToRgb(effectiveBackground) : null;
	if (effectiveBackgroundRgb) {
		const luminance = 0.2126 * effectiveBackgroundRgb.r + 0.7152 * effectiveBackgroundRgb.g + 0.0722 * effectiveBackgroundRgb.b;
		explicitDiffLightMode = luminance > 128;
	}
	const shiki = overrides.shikiTheme ?? preset?.shikiTheme;
	if (shiki) DIFF_THEME = shiki as BundledTheme;

	DIVIDER = `${FG_RULE}│${D_RST}`;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
	// Only trigger auto-derive when the user did NOT supply an explicit
	// preset or per-color override; otherwise we would overwrite their config
	// with the hardcoded dark palette on first render.
	autoDerivePending = !hasExplicitBgConfig;
}

function resolveDiffColors(theme?: any): DiffColors {
	applyThemePaletteIfNeeded(theme);
	if (autoDerivePending && theme?.getFgAnsi) {
		autoDeriveBgFromTheme(theme);
		autoDerivePending = false;
	}
	return DEFAULT_DIFF_COLORS;
}

function diffStrip(value: string): string {
	return value.replace(ANSI_RE, "");
}

function tabs(text: string): string {
	return text.replace(/\t/g, "  ");
}

function termW(): number {
	const raw =
		process.stdout.columns ||
		(process.stderr as any).columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		DEFAULT_TERM_WIDTH;
	return Math.max(40, Math.min(raw - 4, MAX_TERM_WIDTH));
}

function branchDiffWidth(): number {
	return Math.max(40, termW() - 8);
}

function adaptiveWrapRows(tw?: number): number {
	const width = tw ?? termW();
	if (width >= 180) return MAX_WRAP_ROWS_WIDE;
	if (width >= 120) return MAX_WRAP_ROWS_MED;
	return MAX_WRAP_ROWS_NARROW;
}

interface AnsiCell {
	text: string;
	width: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** ANSI escapes are zero-width cells; visible text advances by grapheme cluster. */
function ansiCells(text: string): AnsiCell[] {
	const cells: AnsiCell[] = [];
	let index = 0;
	let plainStart = 0;
	const flushPlain = (end: number) => {
		if (end <= plainStart) return;
		for (const { segment } of graphemeSegmenter.segment(text.slice(plainStart, end))) {
			cells.push({ text: segment, width: visibleWidth(segment) });
		}
	};
	while (index < text.length) {
		if (text[index] === "\x1b") {
			const end = text.indexOf("m", index);
			if (end !== -1) {
				flushPlain(index);
				cells.push({ text: text.slice(index, end + 1), width: 0 });
				index = end + 1;
				plainStart = index;
				continue;
			}
		}
		index++;
	}
	flushPlain(text.length);
	return cells;
}

function fit(value: string, width: number): string {
	if (width <= 0) return "";
	const valueWidth = visibleWidth(value);
	if (valueWidth <= width) return value + " ".repeat(width - valueWidth);
	const showWidth = width > 2 ? width - 1 : width;
	let used = 0;
	let out = "";
	for (const cell of ansiCells(value)) {
		if (cell.width > 0 && used + cell.width > showWidth) break;
		out += cell.text;
		used += cell.width;
	}
	return width > 2 ? `${out}${D_RST}${FG_DIM}›${D_RST}` : `${out}${D_RST}`;
}

function ansiState(text: string): string {
	const matches = text.match(/\x1b\[[0-9;]*m/g) ?? [];
	let fg = "";
	let bg = "";
	let bold = false;
	let dim = false;
	let italic = false;
	for (const seq of matches) {
		const params = seq.slice(2, -1);
		if (params === "0") {
			fg = "";
			bg = "";
			bold = false;
			dim = false;
			italic = false;
		} else if (params === "39") fg = "";
		else if (params === "49") bg = "";
		else if (params === "1") bold = true;
		else if (params === "2") dim = true;
		else if (params === "22") { bold = false; dim = false; }
		else if (params === "3") italic = true;
		else if (params === "23") italic = false;
		else if (params.startsWith("38;")) fg = seq;
		else if (params.startsWith("48;")) bg = seq;
	}
	return bg + fg + (bold ? D_BOLD : "") + (dim ? D_DIM : "") + (italic ? "\x1b[3m" : "");
}

function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(/\x1b\[([0-9;]*)m/g, (seq, params: string) => {
		if (params === "30" || params === "90" || params === "38;5;0" || params === "38;5;8") return FG_SAFE_MUTED;
		if (!params.startsWith("38;2;")) return seq;
		const parts = params.split(";").map(Number);
		if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return seq;
		const [, , r, g, b] = parts;
		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		return luminance < 72 ? FG_SAFE_MUTED : seq;
	});
}

function wrapAnsi(text: string, width: number, maxRows = adaptiveWrapRows(), fillBg = ""): string[] {
	if (width <= 0) return [""];
	const cells = ansiCells(text);
	const totalWidth = cells.reduce((sum, cell) => sum + cell.width, 0);
	if (totalWidth <= width) {
		const pad = width - totalWidth;
		return pad > 0 ? [text + fillBg + " ".repeat(pad) + (fillBg ? D_RST : "")] : [text];
	}

	const rows: string[] = [];
	let row = "";
	let used = 0;
	let cellIndex = 0;
	let onLastRow = false;
	let effectiveWidth = width;
	while (cellIndex < cells.length) {
		if (!onLastRow && rows.length >= maxRows - 1) {
			onLastRow = true;
			effectiveWidth = width > 2 ? width - 1 : width;
		}
		const cell = cells[cellIndex];
		if (cell.width === 0) {
			row += cell.text;
			cellIndex++;
			continue;
		}
		if (used + cell.width > effectiveWidth && used > 0) {
			if (onLastRow) {
				const hasMore = cells.slice(cellIndex).some((remaining) => remaining.width > 0);
				if (hasMore && width > 2) row += `${D_RST}${FG_DIM}›${D_RST}`;
				else row += fillBg + " ".repeat(Math.max(0, width - used)) + D_RST;
				rows.push(row);
				return rows;
			}
			const state = ansiState(row);
			rows.push(row + fillBg + " ".repeat(Math.max(0, width - used)) + D_RST);
			row = state + fillBg;
			used = 0;
			if (rows.length >= maxRows - 1) {
				onLastRow = true;
				effectiveWidth = width > 2 ? width - 1 : width;
			}
			continue;
		}
		row += cell.text;
		used += cell.width;
		cellIndex++;
	}
	if (row.length > 0 || rows.length === 0) {
		rows.push(row + fillBg + " ".repeat(Math.max(0, width - used)) + D_RST);
	}
	return rows;
}

function lnum(n: number | null, width: number, fg = FG_LNUM): string {
	if (n === null) return " ".repeat(width);
	const value = String(n);
	return `${fg}${" ".repeat(Math.max(0, width - value.length))}${value}${D_RST}`;
}

/** Right-aligned line number with no color of its own — the row's fg carries. */
function lnumPlain(n: number | null, width: number): string {
	if (n === null) return " ".repeat(width);
	const value = String(n);
	return `${" ".repeat(Math.max(0, width - value.length))}${value}`;
}

/** Extend a row's background to the full width, as Claude Code does. */
function padRowToWidth(row: string, width: number, bg: string): string {
	const padding = Math.max(0, width - visibleWidth(row));
	return `${row}${bg}${" ".repeat(padding)}${D_RST}`;
}

function stripes(width: number): string {
	return BG_BASE + FG_STRIPE + "╱".repeat(width) + D_RST;
}

function renderDiffStatBar(added: number, removed: number, width = termW()): string {
	const total = added + removed;
	if (total === 0 || width < 20) return "";
	const slots = Math.max(8, Math.min(20, Math.floor(width / 14)));
	let addSlots = Math.max(0, Math.min(slots, Math.round((added / total) * slots)));
	if (added > 0 && addSlots === 0) addSlots = 1;
	if (removed > 0 && addSlots >= slots) addSlots = slots - 1;
	const removeSlots = Math.max(0, slots - addSlots);
	const addBar = addSlots > 0 ? `${FG_ADD}${"━".repeat(addSlots)}${D_RST}` : "";
	const removeBar = removeSlots > 0 ? `${FG_DEL}${"━".repeat(removeSlots)}${D_RST}` : "";
	return `${FG_DIM}[${D_RST}${addBar}${removeBar}${FG_DIM}]${D_RST}`;
}

function summarizeDiff(added: number, removed: number): string {
	const parts: string[] = [];
	if (added > 0) parts.push(`${FG_ADD}+${added}${D_RST}`);
	if (removed > 0) parts.push(`${FG_DEL}-${removed}${D_RST}`);
	if (!parts.length) return `${FG_DIM}no changes${D_RST}`;
	const bar = renderDiffStatBar(added, removed);
	return bar ? `${parts.join(" ")} ${bar}` : parts.join(" ");
}

function diffSummaryWithMeta(added: number, removed: number, hunks: number, mode: string): string {
	const base = summarizeDiff(added, removed);
	const extras: string[] = [];
	if (hunks > 0) extras.push(`${FG_DIM}${hunks} hunk${hunks === 1 ? "" : "s"}${D_RST}`);
	if (mode) extras.push(`${FG_DIM}${mode}${D_RST}`);
	return extras.length ? `${base} ${FG_DIM}•${D_RST} ${extras.join(` ${FG_DIM}•${D_RST} `)}` : base;
}

function collapsedDiffHint(remainingLines: number, hiddenHunks: number): string {
	const width = termW();
	const candidates = [
		`… +${remainingLines} lines${hiddenHunks > 0 ? ` · ${hiddenHunks} more hunks` : ""} (ctrl+o to expand)`,
		`… +${remainingLines} lines${hiddenHunks > 0 ? ` · ${hiddenHunks} hunks` : ""}`,
		`… +${remainingLines}${hiddenHunks > 0 ? ` · +${hiddenHunks}h` : ""}`,
		"…",
	];
	for (const candidate of candidates) {
		if (visibleWidth(candidate) <= width) return candidate;
	}
	return truncateToWidth("…", width, "");
}

function diffRule(width: number): string {
	return `${BG_BASE}${FG_RULE}${"─".repeat(width)}${D_RST}`;
}

function shouldUseSplit(diff: ParsedDiff, tw: number, maxRows = MAX_PREVIEW_LINES): boolean {
	if (!diff.lines.length) return false;
	// Claude Code always renders a unified hunk — it has no split view.
	if (claudeDiffPaletteEnabled()) return false;
	if (tw < SPLIT_MIN_WIDTH) return false;
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const half = Math.floor((tw - 1) / 2);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);
	if (cw < SPLIT_MIN_CODE_WIDTH) return false;
	const vis = diff.lines.slice(0, maxRows);
	let contentLines = 0;
	let wrapCandidates = 0;
	for (const line of vis) {
		if (line.type === "sep") continue;
		contentLines++;
		if (tabs(line.content).length > cw) wrapCandidates++;
	}
	if (contentLines === 0) return true;
	const wrapRatio = wrapCandidates / contentLines;
	if (wrapCandidates >= SPLIT_MAX_WRAP_LINES) return false;
	if (wrapRatio >= SPLIT_MAX_WRAP_RATIO) return false;
	return true;
}

const SHIKI_LANGUAGES = [
	bashLanguage, cLanguage, cppLanguage, csharpLanguage, cssLanguage, dartLanguage,
	goLanguage, graphqlLanguage, htmlLanguage, javaLanguage, javascriptLanguage,
	jsonLanguage, jsxLanguage, kotlinLanguage, luaLanguage, markdownLanguage,
	phpLanguage, pythonLanguage, rubyLanguage, rustLanguage, scssLanguage,
	sqlLanguage, svelteLanguage, swiftLanguage, tomlLanguage, tsxLanguage,
	typescriptLanguage, vueLanguage, xmlLanguage, yamlLanguage,
];
let shikiHighlighterLoader: Promise<any> | null = null;

interface ShikiAnsiToken {
	content: string;
	color?: string;
	explanation?: Array<{ scopes?: Array<{ scopeName?: string }> }>;
}

function tokenHasScope(token: ShikiAnsiToken, fragment: string): boolean {
	return token.explanation?.some((part) => part.scopes?.some((scope) => scope.scopeName?.includes(fragment))) === true;
}

function shikiTokenAnsi(token: ShikiAnsiToken, colorOverride: string | undefined, lightMode: boolean): string {
	let color = (colorOverride ?? token.color)?.slice(0, 7).toLowerCase();
	const isMonokaiOperator = color === "#f92672" && /^[^\p{L}\p{N}_$]+$/u.test(token.content);
	if (isMonokaiOperator || color === "#f8f8f2") color = "#ffffff";
	if (lightMode) {
		const lightColors: Record<string, string> = {
			"#ffffff": "#303030",
			"#66d9ef": "#af005f",
			"#ae81ff": "#0087af",
			"#e6db74": "#005f87",
			"#a6e22e": "#875faf",
			"#f92672": "#af005f",
		};
		color = color ? lightColors[color] ?? color : color;
	}
	const fg = color ? hexToFgAnsi(color) : "";
	// Claude's edit capture uses Monokai token colors without Monokai's optional
	// italic keyword font style. Reset only foreground: 0m/49m would punch holes
	// in the green row background between adjacent tokens.
	return `${fg}${token.content}\x1b[39m`;
}

function shikiLineAnsi(tokens: ShikiAnsiToken[], language: BundledLanguage, lightMode: boolean): string {
	return tokens.map((token, index) => {
		let color: string | undefined;
		if (language === "json") {
			const following = tokens.slice(index + 1).map((item) => item.content).join("").trimStart();
			if (/^"[\s\S]*"$/.test(token.content.trim()) && following.startsWith(":")) color = "#a6e22e";
			else if (/^(?:true|false|null)$/.test(token.content.trim())) color = "#f92672";
		}
		if (language === "python" && tokenHasScope(token, "support.function.builtin")) color = "#a6e22e";
		return shikiTokenAnsi(token, color, lightMode);
	}).join("");
}

async function codeToAnsiLazy(code: string, language: BundledLanguage, theme: BundledTheme, lightMode: boolean): Promise<string> {
	// Pi's extension sandbox cannot resolve Shiki's hidden dynamic theme/language
	// imports. Statically declare registrations and initialize Shiki lazily. Shiki
	// still owns parsing, scopes, and token colors; this function only serializes
	// the returned tokens as SGR, replacing @shikijs/cli's tiny ANSI adapter.
	if (theme !== "monokai") {
		throw new Error(`Unsupported dynamically-loaded Shiki theme: ${theme}`);
	}
	shikiHighlighterLoader ??= getSingletonHighlighter({
		themes: [monokaiTheme],
		langs: SHIKI_LANGUAGES as any,
	});
	const highlighter = await shikiHighlighterLoader;
	const lines = highlighter.codeToTokensBase(code, {
		lang: language,
		theme: "monokai",
		includeExplanation: language === "python",
	});
	return lines.map((line: ShikiAnsiToken[]) => shikiLineAnsi(line, language, lightMode)).join("\n");
}

const hlCache = new Map<string, string[]>();

function clearHighlightCache(): void {
	hlCache.clear();
}

function touchCache(key: string, value: string[]): string[] {
	hlCache.delete(key);
	hlCache.set(key, value);
	while (hlCache.size > CACHE_LIMIT) {
		const first = hlCache.keys().next().value;
		if (first === undefined) break;
		hlCache.delete(first);
	}
	return value;
}

async function hlBlock(code: string, language: BundledLanguage | undefined): Promise<string[]> {
	if (!code) return [""];
	if (readSettings().values.diffSyntaxHighlighting === false) return code.split("\n");
	if (!language || code.length > MAX_HL_CHARS) return code.split("\n");
	const lightMode = claudeDiffLightMode;
	const themeName = DIFF_THEME;
	const key = `${themeName}\0${lightMode ? "light" : "dark"}\0${language}\0${code}`;
	const hit = hlCache.get(key);
	if (hit) return touchCache(key, hit);
	try {
		const highlighted = await codeToAnsiLazy(code, language, themeName, lightMode);
		const ansi = lightMode ? highlighted : normalizeShikiContrast(highlighted);
		const out = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split("\n");
		return touchCache(key, out);
	} catch (error) {
		debugDiagnostic("syntax-highlight", error, String(language));
		return code.split("\n");
	}
}

function getCachedParsedDiff(ctx: any, key: string, oldContent: string, newContent: string): ParsedDiff {
	if (ctx.state?._parsedDiffKey === key && ctx.state._parsedDiff) {
		return ctx.state._parsedDiff as ParsedDiff;
	}
	const diff = parseDiff(oldContent, newContent);
	if (ctx.state) {
		ctx.state._parsedDiffKey = key;
		ctx.state._parsedDiff = diff;
	}
	return diff;
}

function diffContentWidth(width: number): number {
	return Math.max(20, Math.min(MAX_TERM_WIDTH, Math.floor(width) - visibleWidth(CLAUDE_RESULT_PREFIX)));
}

function renderWidthAwareDiff(
	lastComponent: unknown,
	key: string,
	placeholder: string,
	summary: string,
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	maxLines: number,
	theme: Theme,
	invalidate: () => void,
) {
	return diffCard(
		lastComponent,
		key,
		placeholder,
		async (width) => {
			const rendered = await renderSplit(diff, language, maxLines, resolveDiffColors(theme), diffContentWidth(width));
			return withFinalBranchBlock(`${summary}\n${rendered}`, theme);
		},
		invalidate,
		renderPrewrappedDiffLines,
		withBranch(summary, theme),
	);
}

function wordDiffAnalysis(
	oldText: string,
	newText: string,
): { similarity: number; oldRanges: Array<[number, number]>; newRanges: Array<[number, number]> } {
	if (!oldText && !newText) return { similarity: 1, oldRanges: [], newRanges: [] };
	const parts = Diff.diffWords(oldText, newText);
	const oldRanges: Array<[number, number]> = [];
	const newRanges: Array<[number, number]> = [];
	let oldPos = 0;
	let newPos = 0;
	let same = 0;
	for (const part of parts) {
		if (part.removed) {
			oldRanges.push([oldPos, oldPos + part.value.length]);
			oldPos += part.value.length;
		} else if (part.added) {
			newRanges.push([newPos, newPos + part.value.length]);
			newPos += part.value.length;
		} else {
			const len = part.value.length;
			same += len;
			oldPos += len;
			newPos += len;
		}
	}
	const maxLen = Math.max(oldText.length, newText.length);
	return { similarity: maxLen > 0 ? same / maxLen : 1, oldRanges, newRanges };
}

function injectBg(ansiLine: string, ranges: Array<[number, number]>, baseBg: string, hlBg: string): string {
	if (!ranges.length) return baseBg + ansiLine + D_RST;
	let out = baseBg;
	let vis = 0;
	let inHL = false;
	let rangeIndex = 0;
	let i = 0;
	while (i < ansiLine.length) {
		if (ansiLine[i] === "\x1b") {
			const end = ansiLine.indexOf("m", i);
			if (end !== -1) {
				const seq = ansiLine.slice(i, end + 1);
				out += seq;
				if (seq === "\x1b[0m") out += inHL ? hlBg : baseBg;
				i = end + 1;
				continue;
			}
		}
		while (rangeIndex < ranges.length && vis >= ranges[rangeIndex][1]) rangeIndex++;
		const want = rangeIndex < ranges.length && vis >= ranges[rangeIndex][0] && vis < ranges[rangeIndex][1];
		if (want !== inHL) {
			inHL = want;
			out += inHL ? hlBg : baseBg;
		}
		out += ansiLine[i];
		vis++;
		i++;
	}
	return out + D_RST;
}

function plainWordDiff(oldText: string, newText: string): { old: string; new: string } {
	const parts = Diff.diffWords(oldText, newText);
	let oldOut = "";
	let newOut = "";
	for (const part of parts) {
		if (part.removed) oldOut += `${BG_DEL_W}${part.value}${D_RST}${BG_DEL}`;
		else if (part.added) newOut += `${BG_ADD_W}${part.value}${D_RST}${BG_ADD}`;
		else {
			oldOut += part.value;
			newOut += part.value;
		}
	}
	return { old: oldOut, new: newOut };
}

/**
 * A write renders as a plain numbered listing in Claude Code — dim line numbers,
 * syntax-highlighted content, no sign column and no added-line background:
 *
 *   ⎿  Wrote 3 lines to ../../../../tmp/ccdiff.ts
 *       1 const a = 1;
 *       2 const b = 2;
 */
export async function renderFileListing(
	content: string,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	width = termW(),
): Promise<string> {
	const all = content.split("\n").map(sanitizeToolContent);
	if (all.length > 0 && all[all.length - 1] === "") all.pop();
	if (all.length === 0) return "";
	const vis = all.slice(0, max);
	const nw = Math.max(1, String(vis.length).length);
	const cw = Math.max(20, width - (nw + 2));
	const visibleSource = vis.join("\n");
	const canHL = visibleSource.length <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;
	const highlighted = canHL ? await hlBlock(visibleSource, language) : vis;

	const out: string[] = [];
	for (let i = 0; i < vis.length; i++) {
		const gutter = `${D_DIM} ${lnumPlain(i + 1, nw)} ${D_RST}`;
		const rows = wrapAnsi(tabs(highlighted[i] ?? vis[i]), cw, adaptiveWrapRows(), "");
		out.push(`${gutter}${rows[0]}${D_RST}`);
		for (let r = 1; r < rows.length; r++) out.push(`${" ".repeat(nw + 2)}${rows[r]}${D_RST}`);
	}
	if (all.length > vis.length) {
		out.push(`${FG_DIM}${" ".repeat(nw + 2)}${collapsedDiffHint(all.length - vis.length, 0)}${D_RST}`);
	}
	return out.join("\n");
}

export async function renderUnified(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
	width = termW(),
): Promise<string> {
	if (!diff.lines.length) return "";
	const vis = diff.lines.slice(0, max).map((line) => line.type === "sep" ? line : { ...line, content: sanitizeToolContent(line.content) });
	const tw = width;
	// Claude Code sizes the number column to the widest line number, minimum one.
	const nw = claudeDiffPaletteEnabled()
		? Math.max(1, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length)
		: Math.max(2, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	// Claude gutter is " N " plus the sign column; the legacy one adds a border and divider.
	const gw = claudeDiffPaletteEnabled() ? nw + 3 : nw + 5;
	const cw = Math.max(20, tw - gw);

	const oldSrc: string[] = [];
	const newSrc: string[] = [];
	for (const line of vis) {
		if (line.type === "ctx" || line.type === "del") oldSrc.push(line.content);
		if (line.type === "ctx" || line.type === "add") newSrc.push(line.content);
	}
	// Shiki receives only these visible hunk strings. Budgeting the entire source
	// file made small edits in large files silently lose syntax highlighting.
	const highlightChars = oldSrc.join("\n").length + newSrc.join("\n").length;
	const canHL = highlightChars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;
	const [oldHL, newHL] = canHL
		? await Promise.all([hlBlock(oldSrc.join("\n"), language), hlBlock(newSrc.join("\n"), language)])
		: [oldSrc, newSrc];

	let oldIndex = 0;
	let newIndex = 0;
	let index = 0;
	const claude = claudeDiffPaletteEnabled();
	const out: string[] = claude ? [] : [diffRule(tw)];

	// Claude Code's row: " N " gutter, sign column, content — the line background
	// runs across all three to the full width. No border bar, no divider, no rules.
	function emitClaudeRow(num: number | null, sign: string, bg: string, signFg: string, body: string): void {
		const gutterFg = sign === " " ? `${D_DIM}` : signFg;
		const gutter = `${bg}${gutterFg} ${lnumPlain(num, nw)} ${sign}${D_RST}${bg}`;
		const rows = wrapAnsi(tabs(body), cw, adaptiveWrapRows(), bg);
		const contGutter = `${bg}${" ".repeat(nw + 3)}`;
		out.push(padRowToWidth(`${gutter}${rows[0]}`, tw, bg));
		for (let r = 1; r < rows.length; r++) out.push(padRowToWidth(`${contGutter}${rows[r]}`, tw, bg));
	}

	function emitRow(num: number | null, sign: string, gutterBg: string, signFg: string, body: string, bodyBg = ""): void {
		if (claude) {
			emitClaudeRow(num, sign, bodyBg || BG_BASE, signFg, body);
			return;
		}
		const borderFg = sign === "-" ? dc.fgDel : sign === "+" ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}▌${D_RST}` : `${BG_BASE} `;
		const numFg = borderFg || FG_LNUM;
		const gutter = `${border}${gutterBg}${lnum(num, nw, numFg)}${signFg}${sign}${D_RST} ${DIVIDER} `;
		const cont = `${border}${gutterBg}${" ".repeat(nw + 1)}${D_RST} ${DIVIDER} `;
		const rows = wrapAnsi(tabs(body), cw, adaptiveWrapRows(), bodyBg);
		out.push(`${gutter}${rows[0]}${D_RST}`);
		for (let r = 1; r < rows.length; r++) out.push(`${cont}${rows[r]}${D_RST}`);
	}

	while (index < vis.length) {
		const line = vis[index];
		if (line.type === "sep") {
			const gap = line.newNum;
			if (claude) {
				const label = gap && gap > 0 ? `… +${gap} unmodified lines` : "…";
				out.push(`${BG_BASE}${FG_DIM}${" ".repeat(nw + 3)}${label}${D_RST}`);
				index++;
				continue;
			}
			const label = gap && gap > 0 ? ` ${gap} unmodified lines ` : "···";
			const totalW = Math.min(tw, 72);
			const pad = Math.max(0, totalW - label.length - 2);
			const half1 = Math.floor(pad / 2);
			const half2 = pad - half1;
			out.push(`${BG_BASE}${FG_DIM}${"─".repeat(half1)}${label}${"─".repeat(half2)}${D_RST}`);
			index++;
			continue;
		}
		if (line.type === "ctx") {
			const hl = oldHL[oldIndex] ?? line.content;
			// Claude Code dims only the line number on context rows, not the code.
			emitRow(line.newNum, " ", BG_BASE, dc.fgCtx, claude ? `${BG_BASE}${CC_FG_DIFF_TEXT}${hl}\x1b[39m` : `${BG_BASE}${D_DIM}${hl}`, BG_BASE);
			oldIndex++;
			newIndex++;
			index++;
			continue;
		}

		// Claude Code does not syntax-highlight removed lines — they render in the
		// plain foreground, and only additions and context keep their tokens.
		const dels: Array<{ l: DiffLine; hl: string }> = [];
		while (index < vis.length && vis[index].type === "del") {
			const plain = vis[index].content;
			dels.push({ l: vis[index], hl: claude ? `${CC_FG_DIFF_TEXT}${plain}\x1b[39m` : (oldHL[oldIndex] ?? plain) });
			oldIndex++;
			index++;
		}
		const adds: Array<{ l: DiffLine; hl: string }> = [];
		while (index < vis.length && vis[index].type === "add") {
			const highlighted = newHL[newIndex] ?? vis[index].content;
			adds.push({ l: vis[index], hl: claude ? `${CC_FG_DIFF_TEXT}${highlighted}\x1b[39m` : highlighted });
			newIndex++;
			index++;
		}

		// Claude Code word-diffs every aligned removal/addition pair in a hunk, not
		// just lone one-for-one swaps — so emphasis survives multi-line edits. Rows
		// still emit as all-removals-then-all-additions.
		const pairable = dels.length > 0 && dels.length === adds.length;
		const pairs = pairable
			? dels.map((d, i) => ({ d, a: adds[i], wd: wordDiffAnalysis(d.l.content, adds[i].l.content) }))
			: [];
		const emphasized = pairable && pairs.every((p) => p.wd && p.wd.similarity >= WORD_DIFF_MIN_SIM);

		const delMarker = claude ? dc.fgDel : `${dc.fgDel}${D_BOLD}`;
		const addMarker = claude ? dc.fgAdd : `${dc.fgAdd}${D_BOLD}`;
		if (emphasized && canHL) {
			for (const { d, wd } of pairs) {
				// Fresh Claude capture keeps deletions on one uniform red background.
				emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, delMarker, injectBg(d.hl, claude ? [] : wd!.oldRanges, BG_DEL, BG_DEL_W), BG_DEL);
			}
			for (const { a, wd } of pairs) {
				emitRow(a.l.newNum, "+", BG_GUTTER_ADD, addMarker, injectBg(a.hl, wd!.newRanges, BG_ADD, BG_ADD_W), BG_ADD);
			}
			continue;
		}
		if (emphasized && !canHL) {
			const plainPairs = pairs.map(({ d, a }) => ({ d, a, pwd: plainWordDiff(d.l.content, a.l.content) }));
			for (const { d, pwd } of plainPairs) {
				emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, delMarker, `${BG_DEL}${claude ? d.hl : pwd.old}`, BG_DEL);
			}
			for (const { a, pwd } of plainPairs) {
				emitRow(a.l.newNum, "+", BG_GUTTER_ADD, addMarker, `${BG_ADD}${pwd.new}`, BG_ADD);
			}
			continue;
		}
		for (const d of dels) emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, delMarker, `${BG_DEL}${canHL ? d.hl : d.l.content}`, BG_DEL);
		for (const a of adds) emitRow(a.l.newNum, "+", BG_GUTTER_ADD, addMarker, `${BG_ADD}${canHL ? a.hl : a.l.content}`, BG_ADD);
	}

	if (!claude) out.push(diffRule(tw));
	if (diff.lines.length > vis.length) out.push(`${BG_BASE}${FG_DIM}  ${collapsedDiffHint(diff.lines.length - vis.length, 0)}${D_RST}`);
	return out.join("\n");
}

async function renderSplit(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_PREVIEW_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
	width = termW(),
): Promise<string> {
	diff = {
		...diff,
		lines: diff.lines.map((line) => line.type === "sep" ? line : { ...line, content: sanitizeToolContent(line.content) }),
	};
	const tw = width;
	if (!shouldUseSplit(diff, tw, max)) return renderUnified(diff, language, max, dc, width);
	if (!diff.lines.length) return "";

	type Row = { left: DiffLine | null; right: DiffLine | null };
	const rows: Row[] = [];
	let i = 0;
	while (i < diff.lines.length) {
		const line = diff.lines[i];
		if (line.type === "sep" || line.type === "ctx") {
			rows.push({ left: line, right: line });
			i++;
			continue;
		}
		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];
		while (i < diff.lines.length && diff.lines[i].type === "del") dels.push(diff.lines[i++]);
		while (i < diff.lines.length && diff.lines[i].type === "add") adds.push(diff.lines[i++]);
		const n = Math.max(dels.length, adds.length);
		for (let j = 0; j < n; j++) rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
	}

	const vis = rows.slice(0, max);
	const half = Math.floor((tw - 1) / 2);
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);

	const leftSrc: string[] = [];
	const rightSrc: string[] = [];
	for (const row of vis) {
		if (row.left && row.left.type !== "sep") leftSrc.push(row.left.content);
		if (row.right && row.right.type !== "sep") rightSrc.push(row.right.content);
	}
	const highlightChars = leftSrc.join("\n").length + rightSrc.join("\n").length;
	const canHL = highlightChars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;
	const [leftHL, rightHL] = canHL
		? await Promise.all([hlBlock(leftSrc.join("\n"), language), hlBlock(rightSrc.join("\n"), language)])
		: [leftSrc, rightSrc];

	let leftIndex = 0;
	let rightIndex = 0;

	type HalfResult = { gutter: string; contGutter: string; bodyRows: string[] };
	function halfBuild(
		line: DiffLine | null,
		hl: string,
		ranges: Array<[number, number]> | null,
		side: "left" | "right",
	): HalfResult {
		if (!line) {
			const gPat = FG_STRIPE + "╱".repeat(nw + 2) + D_RST;
			const gutter = ` ${gPat}${FG_RULE}│${D_RST} `;
			return { gutter, contGutter: gutter, bodyRows: [stripes(cw)] };
		}
		if (line.type === "sep") {
			const gap = line.newNum;
			const label = gap && gap > 0 ? `··· ${gap} lines ···` : "···";
			const gutter = `${BG_BASE} ${FG_DIM}${fit("", nw + 2)}${D_RST}${FG_RULE}│${D_RST} `;
			return { gutter, contGutter: gutter, bodyRows: [`${BG_BASE}${FG_DIM}${fit(label, cw)}${D_RST}`] };
		}
		const isDel = line.type === "del";
		const isAdd = line.type === "add";
		const gBg = isDel ? BG_GUTTER_DEL : isAdd ? BG_GUTTER_ADD : BG_BASE;
		const cBg = isDel ? BG_DEL : isAdd ? BG_ADD : BG_BASE;
		const sFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : dc.fgCtx;
		const sign = isDel ? "-" : isAdd ? "+" : " ";
		const num = isDel ? line.oldNum : isAdd ? line.newNum : side === "left" ? line.oldNum : line.newNum;
		const borderFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}▌${D_RST}` : ` ${BG_BASE}`;
		const numFg = borderFg || FG_LNUM;
		let body: string;
		if (ranges && ranges.length > 0) body = injectBg(hl, ranges, cBg, isDel ? BG_DEL_W : BG_ADD_W);
		else if (isDel || isAdd) body = `${cBg}${hl}`;
		else body = `${BG_BASE}${D_DIM}${hl}`;
		const gutter = `${border}${gBg}${lnum(num, nw, numFg)}${sFg}${D_BOLD}${sign}${D_RST} ${FG_RULE}│${D_RST} `;
		const contGutter = `${border}${gBg}${" ".repeat(nw + 1)}${D_RST} ${FG_RULE}│${D_RST} `;
		return { gutter, contGutter, bodyRows: wrapAnsi(tabs(body), cw, adaptiveWrapRows(), cBg) };
	}

	const out: string[] = [];
	const hdrOld = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgDel}${D_DIM}old${D_RST}`;
	const hdrNew = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgAdd}${D_DIM}new${D_RST}`;
	out.push(`${BG_BASE}${hdrOld}${" ".repeat(Math.max(0, half - nw - 1))}${FG_RULE}┊${D_RST}${hdrNew}`);
	out.push(`${diffRule(half)}${FG_RULE}┊${D_RST}${diffRule(half)}`);

	for (const row of vis) {
		const leftLine = row.left;
		const rightLine = row.right;
		const paired = Boolean(leftLine && rightLine && leftLine.type === "del" && rightLine.type === "add");
		const wd = paired && leftLine && rightLine ? wordDiffAnalysis(leftLine.content, rightLine.content) : null;
		let leftResult: HalfResult;
		let rightResult: HalfResult;
		if (paired && wd && leftLine && rightLine && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			leftResult = halfBuild(leftLine, leftHL[leftIndex++] ?? leftLine.content, wd.oldRanges, "left");
			rightResult = halfBuild(rightLine, rightHL[rightIndex++] ?? rightLine.content, wd.newRanges, "right");
		} else if (paired && wd && leftLine && rightLine && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(leftLine.content, rightLine.content);
			leftIndex++;
			rightIndex++;
			leftResult = halfBuild(leftLine, pwd.old, null, "left");
			rightResult = halfBuild(rightLine, pwd.new, null, "right");
		} else {
			leftResult = halfBuild(
				row.left,
				row.left && row.left.type !== "sep" ? (leftHL[leftIndex++] ?? row.left.content) : "",
				null,
				"left",
			);
			rightResult = halfBuild(
				row.right,
				row.right && row.right.type !== "sep" ? (rightHL[rightIndex++] ?? row.right.content) : "",
				null,
				"right",
			);
		}
		const maxRows = Math.max(leftResult.bodyRows.length, rightResult.bodyRows.length);
		for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
			const lg = rowIndex === 0 ? leftResult.gutter : leftResult.contGutter;
			const rg = rowIndex === 0 ? rightResult.gutter : rightResult.contGutter;
			const lb = leftResult.bodyRows[rowIndex] ?? (!row.left ? stripes(cw) : `${BG_EMPTY}${" ".repeat(cw)}${D_RST}`);
			const rb = rightResult.bodyRows[rowIndex] ?? (!row.right ? stripes(cw) : `${BG_EMPTY}${" ".repeat(cw)}${D_RST}`);
			out.push(`${lg}${lb}${DIVIDER}${rg}${rb}`);
		}
	}

	out.push(`${diffRule(half)}${FG_RULE}┊${D_RST}${diffRule(half)}`);
	if (rows.length > vis.length) out.push(`${BG_BASE}${FG_DIM}  ${collapsedDiffHint(rows.length - vis.length, 0)}${D_RST}`);
	return out.join("\n");
}

function normalizeToLf(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripBomText(text: string): string {
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function normalizeTextForFuzzyMatch(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function findEditMatch(content: string, oldText: string): { found: boolean; index: number; matchLength: number; usedFuzzyMatch: boolean } {
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzyMatch: false };
	const fuzzyContent = normalizeTextForFuzzyMatch(content);
	const fuzzyOldText = normalizeTextForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
	return fuzzyIndex === -1
		? { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false }
		: { found: true, index: fuzzyIndex, matchLength: fuzzyOldText.length, usedFuzzyMatch: true };
}

function countFuzzyOccurrences(content: string, oldText: string): number {
	const fuzzyContent = normalizeTextForFuzzyMatch(content);
	const fuzzyOldText = normalizeTextForFuzzyMatch(oldText);
	return fuzzyContent.split(fuzzyOldText).length - 1;
}

function lineNumberAtIndex(text: string, index: number): number {
	return text.slice(0, Math.max(0, index)).split("\n").length;
}

function countLineBreaks(text: string): number {
	return (text.match(/\n/g) ?? []).length;
}

interface LocalizedEditDiff {
	diff: ParsedDiff;
	line: number;
}

function aggregateEditDiffFromContent(
	rawContent: string,
	operations: Array<{ oldText: string; newText: string }>,
): ParsedDiff | null {
	if (operations.length === 0) return null;
	const normalizedContent = normalizeToLf(stripBomText(rawContent));
	const normalizedOps = operations.map((edit) => ({
		oldText: normalizeToLf(edit.oldText),
		newText: normalizeToLf(edit.newText),
	}));
	const baseContent = normalizedOps.some((edit) => findEditMatch(normalizedContent, edit.oldText).usedFuzzyMatch)
		? normalizeTextForFuzzyMatch(normalizedContent)
		: normalizedContent;
	const matches = normalizedOps.map((edit) => {
		const match = findEditMatch(baseContent, edit.oldText);
		if (!match.found || countFuzzyOccurrences(baseContent, edit.oldText) !== 1) return null;
		return { matchIndex: match.index, matchLength: match.matchLength, newText: edit.newText };
	});
	if (matches.some((match) => match === null)) return null;
	const ordered = [...(matches as Array<{ matchIndex: number; matchLength: number; newText: string }>)]
		.sort((a, b) => a.matchIndex - b.matchIndex);
	for (let index = 1; index < ordered.length; index++) {
		const previous = ordered[index - 1];
		if (previous.matchIndex + previous.matchLength > ordered[index].matchIndex) return null;
	}
	let nextContent = baseContent;
	for (const match of [...ordered].reverse()) {
		nextContent = `${nextContent.slice(0, match.matchIndex)}${match.newText}${nextContent.slice(match.matchIndex + match.matchLength)}`;
	}
	const diff = parseDiff(baseContent, nextContent);
	return diff.lines.length > 0 ? diff : null;
}

async function computeAggregateEditDiff(
	filePath: string,
	operations: Array<{ oldText: string; newText: string }>,
	cwd: string,
): Promise<ParsedDiff | null> {
	if (!filePath || operations.length === 0) return null;
	try {
		const rawContent = await readFileAsync(resolve(cwd, filePath), "utf8");
		return aggregateEditDiffFromContent(rawContent, operations);
	} catch {
		return null;
	}
}

async function computeLocalizedEditDiffs(filePath: string, operations: Array<{ oldText: string; newText: string }>, cwd: string): Promise<LocalizedEditDiff[] | null> {
	if (!filePath || operations.length === 0) return null;
	try {
		const rawContent = await readFileAsync(resolve(cwd, filePath), "utf8");
		const normalizedContent = normalizeToLf(stripBomText(rawContent));
		const normalizedOps = operations.map((edit) => ({ oldText: normalizeToLf(edit.oldText), newText: normalizeToLf(edit.newText) }));
		const baseContent = normalizedOps.some((edit) => findEditMatch(normalizedContent, edit.oldText).usedFuzzyMatch)
			? normalizeTextForFuzzyMatch(normalizedContent)
			: normalizedContent;
		const matches = normalizedOps.map((edit, editIndex) => {
			const match = findEditMatch(baseContent, edit.oldText);
			if (!match.found || countFuzzyOccurrences(baseContent, edit.oldText) !== 1) return null;
			return { editIndex, matchIndex: match.index, matchLength: match.matchLength, newText: edit.newText };
		});
		if (matches.some((match) => match === null)) return null;
		const ordered = [...(matches as Array<{ editIndex: number; matchIndex: number; matchLength: number; newText: string }>)].sort((a, b) => a.matchIndex - b.matchIndex);
		for (let i = 1; i < ordered.length; i++) {
			const prev = ordered[i - 1];
			const current = ordered[i];
			if (prev.matchIndex + prev.matchLength > current.matchIndex) return null;
		}
		const localized: Array<LocalizedEditDiff | null> = Array(operations.length).fill(null);
		let lineDelta = 0;
		for (const match of ordered) {
			const oldChunk = baseContent.slice(match.matchIndex, match.matchIndex + match.matchLength);
			const oldStartLine = lineNumberAtIndex(baseContent, match.matchIndex);
			const newStartLine = oldStartLine + lineDelta;
			const diff = offsetParsedDiff(parseDiff(oldChunk, match.newText), oldStartLine - 1, newStartLine - 1);
			localized[match.editIndex] = { diff, line: getFirstChangedNewLine(diff) };
			lineDelta += countLineBreaks(match.newText) - countLineBreaks(oldChunk);
		}
		return localized.every(Boolean) ? (localized as LocalizedEditDiff[]) : null;
	} catch {
		return null;
	}
}

async function buildAggregateEditPreviewText(
	theme: Theme,
	language: BundledLanguage | undefined,
	diff: ParsedDiff,
	expanded: boolean,
	width: number,
): Promise<string> {
	const rendered = await renderSplit(
		diff,
		language,
		expanded ? MAX_PREVIEW_LINES : 32,
		resolveDiffColors(theme),
		diffContentWidth(width),
	);
	return withBranch(
		`${resultSentence(theme, describeEdit(diff.added, diff.removed, ccEmphasis()))}\n${rendered}`,
		theme,
		false,
		true,
	);
}

async function buildEditPreviewText(
	theme: Theme,
	language: BundledLanguage | undefined,
	operations: Array<{ oldText: string; newText: string }>,
	diffs: ParsedDiff[],
	lines: number[],
	summary: string,
	expanded: boolean,
	width: number,
): Promise<string> {
	const dc = resolveDiffColors(theme);
	const branchWidth = diffContentWidth(width);
	if (operations.length === 1) {
		const [diff] = diffs;
		const rendered = await renderSplit(diff, language, expanded ? MAX_PREVIEW_LINES : 32, dc, branchWidth);
		return indentBranchBlock(withBranch(
			`${resultSentence(theme, describeEdit(diff.added, diff.removed, ccEmphasis()))}\n${rendered}`,
			theme,
			false,
			true,
		));
	}
	const maxShown = expanded ? operations.length : Math.min(operations.length, 3);
	const previewLines = expanded
		? Math.max(6, Math.floor(MAX_RENDER_LINES / Math.max(1, maxShown)))
		: Math.max(8, Math.floor(MAX_PREVIEW_LINES / Math.max(1, maxShown)));
	const sections = await Promise.all(
		diffs.slice(0, maxShown).map(async (diff, index) => {
			const line = lines[index] ?? getFirstChangedNewLine(diff);
			try {
				const rendered = await renderSplit(diff, language, previewLines, dc, branchWidth);
				return `Edit ${index + 1}/${operations.length}${formatLineMeta(line, theme)}\n${rendered}`;
			} catch {
				return `Edit ${index + 1}/${operations.length}${formatLineMeta(line, theme)} ${summarizeDiff(diff.added, diff.removed)}`;
			}
		}),
	);
	const remainder = operations.length - maxShown;
	const suffix = remainder > 0
		? `\n${theme.fg("muted", `… ${remainder} more edit blocks${expanded ? "" : " (ctrl+o to expand)"}`)}`
		: "";
	return indentBranchBlock(withBranch(`${operations.length} edits ${summary}\n\n${sections.join("\n\n")}${suffix}`, theme, false, true));
}

function stripThinkingPresentationArtifacts(text: string): string {
	if (!ANSI_PRESENT_RE.test(text) && !/^\s*thinking:\s*/i.test(text)) return text;
	let current = ANSI_PRESENT_RE.test(text) ? text.replace(ANSI_RE, "") : text;
	while (true) {
		const next = current.replace(/^(?:thinking:\s*)+/i, "").trimStart();
		if (next === current) return current;
		current = next;
	}
}

function prefixThinkingLine(text: string, _theme: Theme | undefined): string {
	const settings = getMessageChromeSettings();
	if (settings.messageStyle === "classic" && !ANSI_PRESENT_RE.test(text) && text.startsWith("Thinking: ") && !/^Thinking:\s*thinking:\s*/i.test(text)) {
		return text;
	}
	const normalized = stripThinkingPresentationArtifacts(text).trim();
	if (!normalized) return text;
	// Plain text — no ANSI colors, no theme. The ThinkingParagraph handles styling.
	return settings.messageStyle === "classic" ? `Thinking: ${normalized}` : normalized;
}

function getMode<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function genericToolRuntime(): GenericToolRuntime {
	return {
		cwd: process.cwd(),
		syncCallStatus: syncToolCallStatus,
		stableSummary: stableCallSummary,
		makeText,
		header: toolHeader,
		statusDot: toolStatusDot,
		shortPath,
		summarize: summarizeText,
		renderMcp: renderMcpToolResult,
		renderOpenAi: renderOpenAiToolResult,
	};
}

function renderGenericToolCall(name: string, args: any, theme: Theme, ctx: any): Text {
	return renderGenericCall(genericToolRuntime(), name, args, theme, ctx);
}

function renderGenericToolResult(name: string, result: any, options: any, theme: Theme, ctx: any): Text {
	return renderGenericResult(genericToolRuntime(), name, result, options, theme, ctx);
}

function formatLineMeta(line: number, theme: Theme): string {
	return line > 0 ? ` ${theme.fg("muted", `at line ${line}`)}` : "";
}

function applyPatchRuntime(shortPathForDisplay: (path: string) => string): ApplyPatchRuntime {
	return {
		syncCallStatus: syncToolCallStatus,
		stableSummary: stableCallSummary,
		makeText,
		header: toolHeader,
		statusDot: toolStatusDot,
		withBranch,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		displayPath: (path, moveTo) => moveTo
			? `${shortPathForDisplay(path)} ${BORDER_COLOR}→${TRANSPARENT_RESET} ${shortPathForDisplay(moveTo)}`
			: shortPathForDisplay(path),
		language: lang,
		summarizeDiff,
		summarizeCall: (args, theme, sp) => summarizeOpenAiToolCall("apply_patch", args, theme, sp),
		branchWidth: branchDiffWidth,
		resolveDiffColors,
		renderSplit,
		diffSummaryWithMeta,
		maxPreviewLines: MAX_PREVIEW_LINES,
		maxRenderLines: MAX_RENDER_LINES,
		hash: hashText,
	};
}

function renderApplyPatchCall(args: any, theme: Theme, ctx: any, sp: (path: string) => string): Text {
	return renderApplyPatchCallWithRuntime(applyPatchRuntime(sp), args, theme, ctx);
}

function renderApplyPatchResult(result: any, isPartial: boolean, theme: Theme, ctx: any): Text {
	const sp = (path: string) => shortPath(ctx.cwd ?? process.cwd(), path);
	return renderApplyPatchResultWithRuntime(applyPatchRuntime(sp), result, isPartial, theme, ctx);
}

// ===========================================================================
// MCP rendering.
//
// Claude Code does not give MCP calls their own tool rows: no `Tool(args)`
// header, no ⎿ result row, no argument or result display, and no distinction
// between read-only, mutating, and failing tools. An MCP call contributes one
// clause — naming the *server* — to the aggregated inspection group, which
// collapses to a dim line when the turn settles:
//
//   ⏺ Calling openosint, forgejo, obsidian, plane 6 times…
//     Called openosint, forgejo, obsidian, plane 6 times
//
// Captured live from claude v2.1.x against four real MCP servers plus a probe
// server: docs/plans/2026-07-13-mcp-grammar.md
//
// So the only thing rendering needs from an MCP call is its server name. Two
// naming conventions are supported, and neither hardcodes any server:
//
//   name `mcp`                 pi's meta-tool; the server is in the arguments
//                              ({ tool: "plane_list_work_items", server? },
//                              or { describe }/{ search }/{ connect }/{ action })
//   name `mcp__plane__list_…`  MCP tools exposed directly, Claude Code style
// ===========================================================================

/**
 * `plane_list_work_items` → `plane`. The qualified name carries its own prefix.
 *
 * Returns "" when there is no separator yet. The proxy tool receives this name
 * inside *streamed* arguments, so a half-emitted `forgejo_get_my_user_info` reads
 * as `forge` — taking that as the server would render (and cache) `Calling forge…`.
 * Requiring the underscore means the prefix is complete before it is believed.
 */
function renderMcpToolResult(result: any, expanded: boolean, isPartial: boolean, theme: Theme, ctx: any): Text {
	return renderMcpResult({
		makeText,
		withBranch,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		outputMode: () => getMode(readSettings().values.mcpOutputMode, ["hidden", "summary", "preview"] as const, "hidden"),
		buildPreview: buildPreviewText,
		previewRows: previewLimit,
		resultSentence,
		plural,
		summarize: summarizeText,
	}, result, expanded, isPartial, theme, ctx);
}

function summarizeOpenAiToolCall(name: string, args: any, theme: Theme, sp: (path: string) => string): string {
	return summarizeOpenAiCall(name, args, theme, sp, summarizeText);
}

function renderOpenAiToolResult(name: string, result: any, expanded: boolean, isPartial: boolean, theme: Theme, ctx: any): Text {
	return renderOpenAiResult({
		makeText,
		withBranch,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		buildPreview: buildPreviewText,
		previewRows: previewLimit,
		summarize: summarizeText,
	}, name, result, expanded, isPartial, theme, ctx);
}

// ===========================================================================
// Extension
// ===========================================================================

export default function (pi: ExtensionAPI): void {
	if (compatibilityGloballyDisabled()) return;
	const messageLifecycle = new MessageLifecycle();
	const fallbackSanitizerOwner = {};
	const toolRendererOwner = {};
	const globalRenderOwner = {};
	if (featureEnabled("toolPresentation")) { patchToolFallbackSanitization(fallbackSanitizerOwner); patchToolRenderCacheInvalidation(); }
	if (!presentationOverrideSkipped("read")) patchReadImageExpansion();
	if (featureEnabled("toolBackground") || featureEnabled("inspectionGroups") || featureEnabled("bashStacking")) patchGlobalToolBorders(globalRenderOwner);
	patchCustomMessageRenderer(CustomMessageComponent, CUSTOM_MESSAGE_PATCH_FLAG, (line) => featureEnabled("customMessages") ? normalizeLeadingCheckGlyph(line) : line);
	patchCompactionSummaryRenderer(
		CompactionSummaryMessageComponent,
		COMPACTION_MESSAGE_PATCH_FLAG,
		() => `${CC_GUTTER_FG}${CLAUDE_RESULT_PREFIX}${FG_DEFAULT}Compacted ${WORKED_LINE_FG}(ctrl+o to see full summary)${RESET}`,
		() => featureEnabled("compactionSummary"),
	);
	patchUserMessageRenderer(UserMessageComponent, USER_MESSAGE_PATCH_FLAG, userMessagePatchRuntime());
	patchAssistantMessageRenderer(AssistantMessageComponent, ASSISTANT_PATCH_FLAG, {
		workedStartKey: WORKED_START_KEY,
		workedDurationKey: WORKED_DURATION_KEY,
		currentAgentStart: messageLifecycle.currentAgentStart,
		createParagraph: (text, markdownTheme, style, thinking) => thinking
			? new ThinkingParagraph(text, markdownTheme, style)
			: new DottedParagraph(text, markdownTheme),
		hasWorkedDuration: hasWorkedDurationLine,
		workedDurationText,
		enabled: () => featureEnabled("assistantMessages"),
	});
	if (featureEnabled("toolBackground")) patchToolRowIndent();
	patchToolExecutionRenderers(toolRendererOwner);
	if (featureEnabled("footer")) patchEditorBorderColor();
	if (featureEnabled("diffPresentation")) applyDiffPalette();
	if (featureEnabled("assistantMessages")) messageLifecycle.register(pi, {
		workedStartKey: WORKED_START_KEY,
		workedDurationKey: WORKED_DURATION_KEY,
		patchThinking: (text, theme) => {
			if (theme) applyThemePaletteIfNeeded(theme);
			return prefixThinkingLine(text, theme);
		},
		stripThinking: stripThinkingPresentationArtifacts,
		stripWorked: stripWorkedDurationLine,
		appendWorked: appendWorkedDurationLine,
	});
	if (featureEnabled("fullscreenTui")) registerFullscreenTui(pi);
	if (featureEnabled("footer")) registerSessionMetrics(pi);
	if (featureEnabled("banner")) registerBanner(pi);
	if (featureEnabled("promptPointer")) registerPromptPointer(pi);

	if (featureEnabled("inspectionGroups")) registerPointerExpansionLifecycle(pi, {
		shouldWarnRestart: () => legacyToolRendererPatchDetected || legacyToolFallbackPatchDetected,
		warning: "Restart Pi once to finish upgrading Claudify's renderer hooks",
	});

	if (featureEnabled("settingsCommand")) pi.registerCommand("claudify", {
		description: "Open the Claudify settings screen",
		async handler(_args, ctx) {
			const mode = (ctx as any).mode;
			if ((mode !== undefined && mode !== "tui") || !ctx.hasUI) {
				ctx.ui.notify("/claudify needs the interactive TUI", "info");
				return;
			}

			await ctx.ui.custom<void>(
				(tui, theme, keybindings, done) => {
					const refreshDiffPalette = (): void => {
						applyDiffPalette();
						_themePaletteCacheTheme = null;
						autoDerivePending = !hasExplicitBgConfig;
						applyThemePaletteIfNeeded(ctx.ui.theme);
						clearHighlightCache();
						bumpDiffPresentationEpoch();
						tui.requestRender();
					};
					return new ClaudifyScreen(
						tui,
						theme,
						keybindings,
						() => done(undefined),
						(key) => {
							if (key === "colorSource") {
								applyAccentOverride(ctx.ui.theme);
								applyToolBackgroundMode(ctx.ui.theme);
								bustSpinnerSettingsCache();
							}
							if (key === "toolBackground") {
								toolBackgroundOverride = null;
								applyToolBackgroundMode(ctx.ui.theme);
							}
							if (key === "hiddenThinkingLabel") applyHiddenThinkingLabel(ctx);
							if (key === "accentColor") applyAccentOverride(ctx.ui.theme);
							if (key === "userMessageBox") applyToolBackgroundMode(ctx.ui.theme);
							if (key === "promptPointer") applyPromptPointer(ctx);
							if (key === "spinnerPlacement") applyPromptPointer(ctx, true);
							if (key === "spinnerColor"
								|| key === "spinnerStatusColor"
								|| key === "spinnerShimmer"
								|| key === "spinnerVerbs"
								|| key === "spinnerVerbMode"
								|| key === "themeAdaptive") {
								bustSpinnerSettingsCache();
							}
							if (key === "diffSyntaxHighlighting") {
								clearHighlightCache();
								bumpDiffPresentationEpoch();
							}
							if (key === "diffTheme" || key === "diffPalette" || key === "themeAdaptive") refreshDiffPalette();
							// footerStyle installs/uninstalls the footer; the other footer/border
							// keys are read at render time, so the requestRender below suffices.
							if (key === "footerStyle") installClaudeFooter(ctx, pi);
							tui.requestRender();
						},
						(key, value) => {
							if (key === "diffTheme") {
								diffThemePreview = value === null ? null : typeof value === "string" ? value : undefined;
								refreshDiffPalette();
								return;
							}
							const previewKey = key === "spinnerColor" ? SPINNER_COLOR_PREVIEW_KEY : SPINNER_STATUS_COLOR_PREVIEW_KEY;
							if (typeof value === "string") (globalThis as any)[previewKey] = value;
							else delete (globalThis as any)[previewKey];
							bustSpinnerSettingsCache();
							tui.requestRender();
						},
						{ diffThemes: DIFF_PRESET_KEYS, colorKeys: COMMON_COLOR_KEYS },
						(message, type) => ctx.ui.notify(message, type),
					);
				},
				// Render inline (not as an overlay), exactly like pi's Extensions Manager: the screen
				// frames itself and fills the viewport height, sitting above the input instead of
				// floating in the top-left corner where it was easy to miss. See
				// docs/plans/2026-07-16-claudify-framed-panel.md.
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyToolBackgroundMode(ctx.ui.theme);
		applyThemePaletteIfNeeded(ctx.ui.theme);
		// Reload can reconstruct settled rows once with Pi's default green success
		// background before session_start reapplies transparent Claude chrome. Force
		// those cached rows through one post-theme rebuild.
		bumpToolPresentationRevision();
		(ctx.ui as any).requestRender?.();
		if (featureEnabled("assistantMessages")) applyHiddenThinkingLabel(ctx);
		if (featureEnabled("footer")) installClaudeFooter(ctx, pi);
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyToolBackgroundMode(ctx.ui.theme);
		applyThemePaletteIfNeeded(ctx.ui.theme);
		if (featureEnabled("assistantMessages")) applyHiddenThinkingLabel(ctx);
	});

	const cwd = process.cwd();
	const sp = (path: string, runtimeCwd = cwd) => sanitizeToolText(shortPath(runtimeCwd, path));
	/** Short display path, clickable via OSC 8 — resolved against the tool's runtime cwd. */
	const spl = (path: string, runtimeCwd = cwd) => {
		if (!path || !claudeChromeEnabled()) return sp(path, runtimeCwd);
		return linkedPath(runtimeCwd, sp(path, runtimeCwd), resolve(runtimeCwd, path));
	};
	const skippedOverrides = skippedToolOverrides(readSettings().values);
	const compatibilityDisabledBuiltins = BUILTIN_COMPATIBILITY_TOOL_NAMES.filter(
		(name) => name !== "apply_patch" && toolPresentationSkipped(name),
	);
	const effectiveSkippedOverrides = new Set<string>([...skippedOverrides, ...compatibilityDisabledBuiltins]);
	type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
	const toolRegistration = new ToolRegistrationCoordinator<RegisteredTool>(
		{
			registerTool: (definition) => pi.registerTool(definition),
			getAllTools: () => (pi as any).getAllTools?.(),
		},
		{
			skipped: effectiveSkippedOverrides,
			onDiagnostic: (key, error) => debugDiagnostic(key, error),
		},
	);
	const registerBuiltinOverride = (definition: RegisteredTool): void => toolRegistration.add(definition);
	const installDeferredBuiltinOverrides = (ctx?: any): void => toolRegistration.installDeferred(
		ctx?.hasUI ? (message, kind) => ctx.ui?.notify?.(message, kind) : undefined,
	);

	const getAgentDirCapability: unknown = (PiCodingAgent as any).getAgentDir;
	const hostSettingsContext = (ctx: any) => {
		let projectTrusted = false;
		try {
			projectTrusted = ctx?.isProjectTrusted?.() === true;
		} catch {
			// Missing or failing trust capabilities are untrusted.
		}
		return { agentDir: effectiveAgentDir(getAgentDirCapability), projectTrusted };
	};

	registerReadTool({
		cwd,
		register: registerBuiltinOverride,
		forwardContract: forwardedToolContract,
		autoResizeImages: (runtimeCwd, ctx) => hostToolSettings(runtimeCwd, hostSettingsContext(ctx)).autoResizeImages,
		linkedPath: spl,
		syncCallStatus: syncToolCallStatus,
		stableSummary: stableCallSummary,
		makeText,
		header: toolHeader,
		statusDot: toolStatusDot,
		withBranch,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		firstImage: firstImageBlock,
		renderImage: (result, expanded, theme, ctx) => renderReadImage({ makeText, withBranch, shortPath }, result, expanded, theme, ctx),
		errorText,
		formatReadCount: (theme, count) => resultSentence(
			theme,
			claudeChromeEnabled()
				? `Read ${D_BOLD_ON}${count}${D_BOLD_OFF} ${count === 1 ? "line" : "lines"}`
				: `${plural(count, "line")} loaded`,
		),
		widthAware: widthAwareText,
		visualPreview: (text, width, rows, mode, theme, expanded) => visualPreviewText(text, width, rows, "head", theme, mode, {
			expandHint: !expanded,
			expandedCap: expanded,
		}),
		renderLines: renderToolTextLines,
		collapsedRows: (expanded) => collapsedPreviewCount(expanded, previewLimit()),
		expandedRows: expandedPreviewLimit,
		revision: getSettingsRevision,
		hash: hashText,
	});

	registerBashTool({
		cwd,
		register: registerBuiltinOverride,
		forwardContract: forwardedToolContract,
		hostSettings: (runtimeCwd, ctx) => hostToolSettings(runtimeCwd, hostSettingsContext(ctx)),
		semanticEnabled: bashSemanticDisplayEnabled,
		shortPath: sp,
		syncCallStatus: syncToolCallStatus,
		stableSummary: stableCallSummary,
		makeText,
		header: toolHeader,
		statusDot: toolStatusDot,
		withBranch,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		errorText,
		widthAware: widthAwareText,
		visualPreview: (text, width, rows, mode, theme, style, options) => visualPreviewText(text, width, rows, mode, theme, style, options),
		renderLines: renderToolTextLines,
		outputMode: bashOutputMode,
		runningPreview: bashRunningPreview,
		collapsedLimit: bashCollapsedLimit,
		collapsedRows: (expanded) => collapsedPreviewCount(expanded, bashCollapsedLimit()),
		expandedRows: expandedPreviewLimit,
		revision: getSettingsRevision,
		hash: hashText,
	});

	registerSearchTools({
		cwd,
		register: registerBuiltinOverride,
		forwardContract: forwardedToolContract,
		shortPath: sp,
		syncCallStatus: syncToolCallStatus,
		stableSummary: stableCallSummary,
		makeText,
		header: toolHeader,
		statusDot: toolStatusDot,
		withBranch,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		widthAware: widthAwareText,
		renderLines: renderToolTextLines,
		visualPreview: (text, width, rows, theme) => visualPreviewText(text, width, rows, "head", theme, "dim", { expandedCap: true }),
		expandedLimit: expandedPreviewLimit,
		revision: getSettingsRevision,
		hash: hashText,
		fgRule: () => FG_RULE,
		reset: () => D_RST,
	});

	registerWriteTool({
		cwd,
		register: registerBuiltinOverride,
		forwardContract: forwardedToolContract,
		summarizeDiff,
		linkedPath: spl,
		revealArgs: shouldRevealCallArgs,
		hasArg: hasOwnArg,
		syncCallStatus: syncToolCallStatus,
		stableSummary: stableCallSummary,
		makeText,
		header: toolHeader,
		statusDot: toolStatusDot,
		withBranch,
		withFinalBranch: withFinalBranchBlock,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		resultSentence,
		emphasis: ccEmphasis,
		writtenLineCount,
		renderWidthAwareDiff,
		diffCard: (last, key, placeholder, build, invalidate, textRenderer, fallback) => diffCard(last, key, placeholder, build, invalidate, textRenderer, fallback),
		cachedDiff: getCachedParsedDiff,
		diffContentWidth,
		claudeDiffPalette: claudeDiffPaletteEnabled,
		renderFileListing,
		renderUnified,
		resolveDiffColors,
		collapsedLimit: diffCollapsedLimit,
		maxRenderLines: MAX_RENDER_LINES,
		renderPrewrapped: renderPrewrappedDiffLines,
		hash: hashText,
		revision: getSettingsRevision,
	});

	registerEditTool({
		cwd,
		register: registerBuiltinOverride,
		forwardContract: forwardedToolContract,
		summarizeDiff,
		linkedPath: spl,
		revealArgs: shouldRevealCallArgs,
		hasArg: hasOwnArg,
		stableSummary: stableCallSummary,
		syncCallStatus: syncToolCallStatus,
		makeText,
		header: toolHeader,
		statusDot: toolStatusDot,
		withBranch,
		indentBranch: indentBranchBlock,
		startBlink: setupBlinkTimer,
		stopBlink: clearBlinkTimer,
		setStatus: setToolStatus,
		resultSentence,
		diffCard: (last, key, placeholder, build, invalidate, textRenderer, fallback) => diffCard(last, key, placeholder, build, invalidate, textRenderer, fallback),
		computeAggregate: computeAggregateEditDiff,
		computeLocalized: computeLocalizedEditDiffs,
		buildAggregate: buildAggregateEditPreviewText,
		buildPreview: buildEditPreviewText,
		renderPrewrapped: renderPrewrappedDiffLines,
		hash: hashText,
		revision: getSettingsRevision,
	});

	// Presentation is selected by the observable call/result contract, not by the
	// package that owns execution. Externally-owned compatible tools therefore
	// retain their execute/schema/policy while using Claudify's renderer.
	installCompatibleToolPresentations(toolRendererOwner, toolRegistration.presentationAdapters());

	// Normal package loading performs ownership checks after the extension factory
	// returns. Registering core overrides during the factory conflicts with Meta's
	// built-ins; session_start is past that loader gate. before_agent_start is an
	// idempotent fallback for hosts that rebuild their tool registry per run.
	pi.on("session_start", async (_event, ctx) => installDeferredBuiltinOverrides(ctx));
	pi.on("before_agent_start", async (_event, ctx) => installDeferredBuiltinOverrides(ctx));

	const discoverPresentationTools = (): void => {
		let allTools: unknown[] = [];
		try {
			allTools = typeof (pi as any).getAllTools === "function" ? (pi as any).getAllTools() : [];
		} catch (error) {
			debugDiagnostic("presentation-tool-discovery", error);
			return;
		}
		resetToolDiscovery();
		for (const tool of allTools) {
			// Public ToolInfo is metadata-only. Record provable MCP identity for
			// presentation, but never replace execution from private fields.
			if (isMcpToolCandidate(tool)) noteMcpTool(tool);
		}
	};

	pi.on("session_start", async () => {
		discoverPresentationTools();
	});
	pi.on("before_agent_start", async () => {
		discoverPresentationTools();
	});

	// Safety net: clear all blink timers on turn/session boundaries.
	pi.on("turn_end", async () => {
		blinkScheduler.clear();
		clearHighlightCache();
	});
	pi.on("session_shutdown", async () => {
		deferGenerationRelease(() => releaseGlobalToolBorders(globalRenderOwner));
		deferGenerationRelease(() => releaseToolExecutionRenderers(toolRendererOwner));
		deferGenerationRelease(() => releaseToolFallbackSanitization(fallbackSanitizerOwner));
		blinkScheduler.clear();
		clearHighlightCache();
	});
}
