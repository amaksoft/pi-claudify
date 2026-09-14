import { existsSync } from "node:fs";
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
	Markdown,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import * as Diff from "diff";
// Shiki loading/caching/token conversion and the ANSI diff renderer live in
// extensions/render/diff-syntax.ts and extensions/render/diff-render.ts; only
// the BundledLanguage type is still referenced directly in this file.
import type { BundledLanguage } from "shiki";

import { registerBanner } from "./banner.ts";
import { CLAUDE_PALETTE } from "./claude-palette.ts";
import { effectiveAgentDir, forwardedToolContract, hostToolSettings, skippedToolOverrides } from "./builtin-contracts.ts";
import { ClaudifyScreen } from "./claudify-screen.ts";
import { debugDiagnostic } from "./debug.ts";
import { bumpDiffPresentationEpoch, diffCard } from "./diff-card.ts";
import { markPointerExpandedMembers } from "./expansion-coordinator.ts";
import { installClaudeFooter, normalizeHexColor, patchEditorBorderColor } from "./footer.ts";
import { MessageLifecycle } from "./lifecycle/message-lifecycle.ts";
import { registerPointerExpansionLifecycle } from "./lifecycle/pointer-expansion.ts";
import { HOST_CONTAINER_RENDER, InspectionGroupComponent } from "./inspection-group.ts";
import { renderWithStackedConsecutiveBash } from "./transcript/bash-stacking.ts";
import {
	ensureInspectionGroups as ensureInspectionGroupsWithRuntime,
	isInspectionGroupCandidate,
	isSettledInspectionTool,
	type InspectionGroupRuntime,
} from "./transcript/inspection-groups.ts";

export { InspectionGroupComponent } from "./inspection-group.ts";
export { isSettledInspectionTool } from "./transcript/inspection-groups.ts";
import { registerFullscreenTui } from "./fullscreen-tui.ts";
import {
	describeInspectionsActive,
	describeInspectionsDone,
	type InspectionKind,
} from "./inspection-summary.ts";
import { describeEdit, describeWrite, type SummaryEmphasis } from "./mutation-summary.ts";
import { anchorFramedHeights } from "./mouse-layout.ts";
import { patchAssistantMessageRenderer } from "./host/assistant-message-patch.ts";
import { BlinkScheduler } from "./host/blink-scheduler.ts";
import { installContainerRenderPatch, releaseContainerRenderPatch } from "./host/container-render-patch.ts";
import { patchCompactionSummaryRenderer, patchCustomMessageRenderer } from "./host/message-patches.ts";
import {
	makeToolText,
	padToWidth as padToolLineToWidth,
	renderPrewrappedDiffLines,
	renderToolTextLines as renderToolTextRows,
	wrapMarkedLine as wrapToolMarkedLine,
} from "./host/tool-text.ts";
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
import {
	installReadImageExpansion,
	installToolCacheInvalidation,
	installToolFallbackSanitization,
	installToolRowLayout,
	releaseToolFallbackSanitization as releaseToolFallbackSanitizationHost,
} from "./host/tool-component-patches.ts";
import { installToolPresentations, installToolRendererPatch, releaseToolRendererPatch } from "./host/tool-renderer-patch.ts";
import { applyAccentOverride as applyAccentOverrideHost } from "./host/theme-accent.ts";
import {
	safeBgAnsi,
	safeFgAnsi,
	storedHexColor,
	themePolarity,
} from "./host/theme-access.ts";
import { applyToolBackgroundTheme, computeToolBackgroundMode, setToolBackgroundOverride } from "./host/tool-background-mode.ts";
import {
	applyUserMessageBoxTheme,
	getUserBoxCustomBackground,
	getUserBoxThemeBackground,
	getUserBoxThemePrefixForeground,
} from "./host/user-message-box-state.ts";
import {
	applyStatusDotPalette,
	getStatusDotError,
	getStatusDotPending,
	getStatusDotSuccess,
	getStatusGutterForeground,
} from "./host/status-dot-palette.ts";
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
import {
	applyDiffPalette as applyDiffPaletteState,
	applyImmediateDiffPalette,
	applyThemeDerivedPalette,
	autoDeriveBgFromTheme,
	claudeDiffPaletteEnabled,
	D_RST,
	DEFAULT_DIFF_COLORS,
	DIFF_PRESET_KEYS,
	type DiffColors,
	type DiffThemeReader,
	FG_RULE,
	isAutoDerivePending,
	markAutoDeriveApplied,
	MAX_PREVIEW_LINES,
	MAX_RENDER_LINES,
	MAX_TERM_WIDTH,
	setDiffThemePreview,
	themeAdaptiveEnabled,
} from "./domain/diff-palette.ts";
export { DIFF_PRESET_KEYS } from "./domain/diff-palette.ts";
import {
	branchDiffWidth,
	configureDiffWidthOps,
	diffSummaryWithMeta,
	renderFileListing,
	renderSplit,
	renderUnified,
	summarizeDiff,
} from "./render/diff-render.ts";
export { renderFileListing, renderUnified } from "./render/diff-render.ts";
import { clearHighlightCache } from "./render/diff-syntax.ts";
import { selectVisualItems, selectVisualPreview, widthAwareText, type VisualPreviewMode } from "./visual-preview.ts";
import { registerEditTool } from "./tools/edit-tool.ts";
import { computeAggregateEditDiff, computeLocalizedEditDiffs } from "./tools/edit-preview.ts";
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
	DEFAULT_HIDDEN_THINKING_LABEL,
	DEFAULT_USER_PREFIX,
	appendWorkedLine,
	formatTranscriptLines,
	formatWorkedLine,
	messageHasWorkedLine,
	resolveMessageChromeSettings,
	stripWorkedLines,
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
const TOOL_RENDER_CACHE = Symbol.for("pi-claudify:tool-render-cache");
const TOOL_RENDER_SETTINGS_REVISION = Symbol.for("pi-claudify:tool-render-settings-revision");
const TOOL_PRESENTATION_REVISION = Symbol.for("pi-claudify:tool-presentation-revision");
const TOOL_COMPONENT_PRESENTATION_REVISION = Symbol.for("pi-claudify:tool-component-presentation-revision");
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

function applyHiddenThinkingLabel(ctx: any): void {
	if (!ctx?.hasUI || typeof ctx.ui?.setHiddenThinkingLabel !== "function") return;
	const label = getMessageChromeSettings().hiddenThinkingLabel;
	ctx.ui.setHiddenThinkingLabel(label || DEFAULT_HIDDEN_THINKING_LABEL);
}

function syncToolBackgroundMode(): void {
	toolBackgroundMode = computeToolBackgroundMode();
}

export function applyAccentOverride(theme: unknown): void {
	applyAccentOverrideHost(theme);
}

export function applyToolBackgroundMode(theme: unknown): void {
	syncToolBackgroundMode();
	applyUserMessageBoxTheme(theme);
	applyToolBackgroundTheme(theme, toolBackgroundMode);
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

function presentationOverrideSkipped(toolName: unknown): boolean {
	return typeof toolName === "string" && skippedToolOverrides(readSettings().values).has(toolName.toLowerCase());
}

function plural(count: number, noun: string): string {
	if (count === 1) return `1 ${noun}`;
	const suffix = /(?:s|x|z|ch|sh)$/i.test(noun) ? "es" : "s";
	return `${count} ${noun}${suffix}`;
}

/**
 * Wires index.ts's mutable palette/chrome state (border color, tool rule,
 * worked-line foreground, tool background mode) and shared pure helpers
 * (shortPath, summarizeText, wrapMarkedLine, padToWidth) into one runtime for
 * the extracted inspection-group render policy — see
 * extensions/transcript/inspection-groups.ts. Built fresh per call so it
 * always reflects the current settings/theme, matching the pre-extraction
 * behavior of reading module-level state directly at render time.
 */
function inspectionGroupRuntime(): InspectionGroupRuntime {
	return {
		isPresentationOverrideSkipped: presentationOverrideSkipped,
		shortPath,
		summarizeText,
		wrapMarkedLine,
		padToWidth,
		borderLine,
		syncToolBackgroundMode,
		toolBackgroundMode: () => toolBackgroundMode,
		toolRule: () => TOOL_RULE,
		workedLineForeground: () => WORKED_LINE_FG,
	};
}

export function ensureInspectionGroups(container: unknown): void {
	ensureInspectionGroupsWithRuntime(container, inspectionGroupRuntime());
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

function hostContainerPrototype(): any {
	const candidate = Object.getPrototypeOf(ToolExecutionComponent.prototype);
	return candidate && typeof candidate.render === "function" ? candidate : Container.prototype;
}

function patchGlobalToolBorders(owner: object): void {
	installContainerRenderPatch(
		[hostContainerPrototype(), Container.prototype],
		owner,
		HOST_CONTAINER_RENDER,
		{
			presentationSkipped: presentationOverrideSkipped,
			isInspectionCandidate: (value) => isInspectionGroupCandidate(value, presentationOverrideSkipped),
			ensureInspectionGroups,
			renderStackedBash: (container, width) => renderWithStackedConsecutiveBash(container, width, { isBlankLine }),
			settingsRevision: getSettingsRevision,
			presentationRevision: currentToolPresentationRevision,
			refreshPresentation: (component) => component.updateDisplay?.(),
			clearRenderCache: clearToolRenderCache,
			backgroundMode: () => { syncToolBackgroundMode(); return toolBackgroundMode; },
			isBlankLine,
			splitImageBlock: splitRenderedImageBlock,
			clampLine: clampLineWidth,
			normalizeCheckGlyph: normalizeLeadingCheckGlyph,
			spacerLine: (width) => " ".repeat(width),
			borderLine,
			reanchor: anchorFramedHeights,
			diagnostic: (key, error) => debugDiagnostic(key, error),
		},
	);
}

function releaseGlobalToolBorders(owner: object): void { releaseContainerRenderPatch(owner); }

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
const WORKED_DURATION_KEY = "_piClaudeStyleWorkedDurationMs";
const WORKED_START_KEY = "_piClaudeStyleWorkedStartMs";
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

function stripWorkedDurationLine(text: string): string { return stripWorkedLines(text); }
function hasWorkedDurationLine(message: any): boolean { return messageHasWorkedLine(message); }

export function appendWorkedDurationLine(message: any, durationMs: number, seed?: number, verbs?: readonly string[]): void {
	appendWorkedLine(message, inlineWorkedDurationText(durationMs, seed, verbs));
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
		defaultForeground: () => FG_DEFAULT,
		workedLineForeground: () => WORKED_LINE_FG,
		claudeBoxBackground: () => CLAUDE_PALETTE.userMessage.background,
		claudeBoxTextForeground: () => CLAUDE_PALETTE.userMessage.text,
		claudeBoxPrefixForeground: () => CLAUDE_PALETTE.userMessage.prefix,
		themeBoxBackground: getUserBoxThemeBackground,
		themeBoxPrefixForeground: getUserBoxThemePrefixForeground,
		customBoxBackground: getUserBoxCustomBackground,
		boxMode: userMessageBoxMode,
	};
}

export function applyUserMessageBox(lines: string[], mode: Exclude<UserMessageBoxMode, "off">, maxWidth: number): string[] {
	return applyUserMessageBoxWithRuntime(userMessagePatchRuntime(), lines, mode, maxWidth);
}

let legacyToolFallbackPatchDetected = false;
function patchToolFallbackSanitization(owner: object): void {
	legacyToolFallbackPatchDetected = installToolFallbackSanitization(owner);
}
export function releaseToolFallbackSanitization(owner?: object): void {
	releaseToolFallbackSanitizationHost(owner);
}
function patchToolRenderCacheInvalidation(): void { installToolCacheInvalidation(clearToolRenderCache); }
function patchReadImageExpansion(): void { installReadImageExpansion(clearToolRenderCache); }
function patchToolRowIndent(): void {
	installToolRowLayout(() => { syncToolBackgroundMode(); return toolBackgroundMode; });
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
	return claudeChromeEnabled() ? `${getStatusDotError()}${text}${RESET}` : theme.fg("error", text);
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
	if (status === "error") return `${getStatusDotError()}${CLAUDE_TOOL_GLYPH}${RESET} `;
	if (status === "success") return `${getStatusDotSuccess()}${CLAUDE_TOOL_GLYPH}${RESET} `;
	return `${getStatusDotPending()}${CLAUDE_TOOL_GLYPH}${RESET} `;
}

// ---------------------------------------------------------------------------
// Branch connector — visual tree from header to output
// ---------------------------------------------------------------------------

function branchIndent(text: string, _continued = false): string {
	return `${toolLineBackgroundReset()}${CLAUDE_RESULT_CONTINUATION}${WRAP_MARK}${text}`;
}

function branchLead(text: string, _continued = false): string {
	const gutter = claudeChromeEnabled() ? getStatusGutterForeground() : TOOL_RULE;
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

function toolTextStyle() { return { rule: TOOL_RULE, reset: TRANSPARENT_RESET }; }
function padToWidth(line: string, width: number): string { return padToolLineToWidth(line, width); }
function wrapMarkedLine(line: string, width: number): string[] { return wrapToolMarkedLine(line, width, toolTextStyle()); }
function renderToolTextLines(text: string, width: number): string[] { return renderToolTextRows(text, width, toolTextStyle()); }
function makeText(last: unknown, text: string): Text { return makeToolText(last, text, toolTextStyle); }

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
// Diff rendering composition — palette state/config lives in
// domain/diff-palette.ts, Shiki loading/caching in render/diff-syntax.ts, and
// the ANSI unified/split renderers + width/summary helpers in
// render/diff-render.ts. This section wires them to the active Pi Theme and
// to the tool-specific glue (diffCard, apply_patch/edit/write previews) that
// stays here because it depends on composition-root state.
// ===========================================================================

// Cache theme identity so we only recompute on theme change. The Theme
// object is reused across renders within a single session unless the user
// switches themes via the picker.
let _themePaletteCacheTheme: unknown = null;

/**
 * When on (the default), tool rows use Claude Code's chrome: status-colored bullet
 * (gray → green), bold tool name in the default foreground, and OSC 8 hyperlinked
 * paths. Set `toolChrome: "theme"` to keep the themed/accent-tinted rows.
 */
function claudeChromeEnabled(): boolean {
	// Tool chrome changes wording and hyperlink grammar as well as color.
	return readSettings().values.toolChrome !== "theme";
}

// Injected theme reader for domain/diff-palette.ts — that module must not
// import Pi host packages, so theme access is passed in as plain functions.
const diffThemeReader: DiffThemeReader = { polarity: themePolarity, fgAnsi: safeFgAnsi, bgAnsi: safeBgAnsi };
// render/diff-render.ts must not import @earendil-works/pi-tui directly
// (render/ boundary rule); wire its width dependency once at load time.
configureDiffWidthOps({ visibleWidth, truncateToWidth });

// Claude Code highlights diff content with a Monokai palette (fg 248,248,242,
// keywords 102,217,239, numbers 190,132,255).
let TOOL_RULE = "\x1b[38;2;153;153;153m";

/**
 * Wires the composition-root's non-diff theme state (borders, worked-line
 * foreground, tool branch rule, status dots, accent) and delegates the
 * diff-specific palette derivation to domain/diff-palette.ts. Preserves the
 * original control flow exactly: the "always run" Claude/theme-derived diff
 * palette branch runs unconditionally, then the theme-identity cache gate,
 * then the cached border/worked-line/tool-rule/diff-text-color block.
 */
export function applyThemePaletteIfNeeded(theme: any): void {
	if (!theme) return;
	// Runs before the adaptive/cache guards: captured Claude dark/light palettes
	// and accent overrides apply even when theme-derived colors are disabled.
	applyAccentOverride(theme);
	const polarity = themePolarity(theme);
	applyStatusDotPalette(theme, polarity);
	applyImmediateDiffPalette(theme, diffThemeReader, polarity);
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

	// Diff support text colors + background re-derivation.
	applyThemeDerivedPalette(theme, diffThemeReader, muted, borderMuted);
}

export function applyDiffPalette(): void {
	applyDiffPaletteState();
}

function resolveDiffColors(theme?: any): DiffColors {
	applyThemePaletteIfNeeded(theme);
	if (isAutoDerivePending() && theme?.getFgAnsi) {
		autoDeriveBgFromTheme(theme, diffThemeReader);
		markAutoDeriveApplied();
	}
	return DEFAULT_DIFF_COLORS;
}

function diffStrip(value: string): string {
	return value.replace(ANSI_RE, "");
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
	const messageLifecycle = new MessageLifecycle();
	const fallbackSanitizerOwner = {};
	const toolRendererOwner = {};
	const globalRenderOwner = {};
	patchToolFallbackSanitization(fallbackSanitizerOwner);
	patchToolRenderCacheInvalidation();
	patchReadImageExpansion();
	patchGlobalToolBorders(globalRenderOwner);
	patchCustomMessageRenderer(CustomMessageComponent, CUSTOM_MESSAGE_PATCH_FLAG, normalizeLeadingCheckGlyph);
	patchCompactionSummaryRenderer(
		CompactionSummaryMessageComponent,
		COMPACTION_MESSAGE_PATCH_FLAG,
		() => `${getStatusGutterForeground()}${CLAUDE_RESULT_PREFIX}${FG_DEFAULT}Compacted ${WORKED_LINE_FG}(ctrl+o to see full summary)${RESET}`,
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
	});
	patchToolRowIndent();
	patchToolExecutionRenderers(toolRendererOwner);
	patchEditorBorderColor();
	applyDiffPalette();
	messageLifecycle.register(pi, {
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
	registerFullscreenTui(pi);
	registerSessionMetrics(pi);
	registerBanner(pi);
	registerPromptPointer(pi);

	registerPointerExpansionLifecycle(pi, {
		shouldWarnRestart: () => legacyToolRendererPatchDetected || legacyToolFallbackPatchDetected,
		warning: "Restart Pi once to finish upgrading Claudify's renderer hooks",
	});

	pi.registerCommand("claudify", {
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
								setToolBackgroundOverride(null);
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
								setDiffThemePreview(value === null ? null : typeof value === "string" ? value : undefined);
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
		applyHiddenThinkingLabel(ctx);
		installClaudeFooter(ctx, pi);
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyToolBackgroundMode(ctx.ui.theme);
		applyThemePaletteIfNeeded(ctx.ui.theme);
		applyHiddenThinkingLabel(ctx);
	});

	const cwd = process.cwd();
	const sp = (path: string, runtimeCwd = cwd) => sanitizeToolText(shortPath(runtimeCwd, path));
	/** Short display path, clickable via OSC 8 — resolved against the tool's runtime cwd. */
	const spl = (path: string, runtimeCwd = cwd) => {
		if (!path || !claudeChromeEnabled()) return sp(path, runtimeCwd);
		return linkedPath(runtimeCwd, sp(path, runtimeCwd), resolve(runtimeCwd, path));
	};
	const skippedOverrides = skippedToolOverrides(readSettings().values);
	type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
	const toolRegistration = new ToolRegistrationCoordinator<RegisteredTool>(
		{
			registerTool: (definition) => pi.registerTool(definition),
			getAllTools: () => (pi as any).getAllTools?.(),
		},
		{
			skipped: skippedOverrides,
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

	// Safety net: clear all blink timers on turn/session boundaries
	pi.on("turn_end", async () => {
		blinkScheduler.clear();
		clearHighlightCache();
	});
	pi.on("session_shutdown", async () => {
		releaseGlobalToolBorders(globalRenderOwner);
		releaseToolExecutionRenderers(toolRendererOwner);
		releaseToolFallbackSanitization(fallbackSanitizerOwner);
		blinkScheduler.clear();
		clearHighlightCache();
	});
}
