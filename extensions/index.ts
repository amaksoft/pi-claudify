import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
	Loader,
	Markdown,
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

import { AdditiveToolsController } from "./adapters/additive-tools.ts";
import { activatePortablePi } from "./adapters/public-pi.ts";
import { activateTestedPiRuntime } from "./adapters/tested-pi/adapter.ts";
import { testedPiPatchBroker } from "./adapters/tested-pi/patch-broker.ts";
import { probeTestedPiCapabilities } from "./adapters/tested-pi/probes.ts";
import { registerBanner } from "./banner.ts";
import { CLAUDE_PALETTE } from "./claude-palette.ts";
import { effectiveAgentDir, forwardedToolContract, hostToolSettings, skippedToolOverrides } from "./builtin-contracts.ts";
import { ClaudifyScreen } from "./claudify-screen.ts";
import { debugDiagnostic } from "./debug.ts";
import { bumpDiffPresentationEpoch, diffCard } from "./diff-card.ts";
import { markPointerExpandedMembers } from "./expansion-coordinator.ts";
import { deferGenerationRelease } from "./lifecycle/generation-handoff.ts";
import { installClaudeFooter, normalizeHexColor, patchEditorBorderColor, releaseEditorBorderColor } from "./footer.ts";
import { registerClaudifyCommand } from "./lifecycle/claudify-command.ts";
import { MessageLifecycle } from "./lifecycle/message-lifecycle.ts";
import { registerPointerExpansionLifecycle } from "./lifecycle/pointer-expansion.ts";
import { registerSessionEvents } from "./lifecycle/session-events.ts";
import { hostContainerRender, InspectionGroupComponent } from "./inspection-group.ts";
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
import { patchAssistantMessageRenderer, releaseAssistantMessageRenderer } from "./host/assistant-message-patch.ts";
import { BlinkScheduler } from "./host/blink-scheduler.ts";
import { installContainerRenderPatch, markContainerRenderPatchRetiring, releaseContainerRenderPatch } from "./host/container-render-patch.ts";
import { patchCompactionSummaryRenderer, patchCustomMessageRenderer, releaseMessageRenderers } from "./host/message-patches.ts";
import {
	makeToolText,
	padToWidth as padToolLineToWidth,
	renderPrewrappedDiffLines,
	renderToolTextLines as renderToolTextRows,
	wrapMarkedLine as wrapToolMarkedLine,
} from "./host/tool-text.ts";
import { applyUserMessageBox as applyUserMessageBoxWithRuntime, patchUserMessageRenderer, releaseUserMessageRenderer, type UserMessageBoxMode, type UserMessagePatchRuntime } from "./host/user-message-patch.ts";
import {
	genericToolLabel,
	humanizeToolName,
	isMcpToolCandidate,
	isMcpToolName,
	isOpenAiToolCandidate,
	mcpOriginalName,
	mcpToolServer,
	noteMcpTool,
	releaseToolDiscovery,
	resetToolDiscovery,
	shouldUseGenericToolRenderer,
} from "./host/tool-discovery.ts";
import { classifyToolOwner, readToolOwners, type ToolOwnerKind } from "./host/tool-ownership.ts";
import { ToolProvenanceObserver } from "./host/tool-provenance.ts";
import { ToolRegistrationCoordinator } from "./host/tool-registration.ts";
import {
	installReadImageExpansion,
	installToolCacheInvalidation,
	installToolFallbackSanitization,
	installToolRowLayout,
	markToolComponentPatchesRetiring,
	releaseReadImageExpansion,
	releaseToolFallbackSanitization as releaseToolFallbackSanitizationHost,
	releaseToolRowLayout,
} from "./host/tool-component-patches.ts";
import { installToolPresentations, installToolRendererPatch, markToolRendererPatchRetiring, releaseToolRendererPatch } from "./host/tool-renderer-patch.ts";
import { applyAccentOverride as applyAccentOverrideHost } from "./host/theme-accent.ts";
import { createThemeOrchestrator } from "./host/theme-orchestrator.ts";
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
import { resolveSurfaceColorSource } from "./presentation-profile.ts";
import { registerSessionMetrics, releaseSessionMetrics } from "./session-metrics.ts";
import { buildActivationPlan } from "./runtime/activation-plan.ts";
import { detectHostDescriptor, parseProfilePreference } from "./runtime/capabilities.ts";
import type { ActivationPlan } from "./runtime/contracts.ts";
import { RuntimeHandle } from "./runtime/runtime-handle.ts";
import { DEFAULT_DIFF_COLLAPSED_LINES, DEFAULT_EXPANDED_PREVIEW_MAX_LINES, getSettingsRevision, readSettings } from "./settings.ts";
import registerSpinner from "./spinner.ts";
import { sanitizeToolContent, sanitizeToolOutput, sanitizeToolText, WRAP_MARK } from "./terminal-sanitize.ts";
import { languageForPath as lang } from "./domain/language.ts";
import { linkedPath, shortPath } from "./domain/path-links.ts";
import {
	ANSI_PRESENT_RE,
	ANSI_RE,
	isBlankLine,
	isTerminalImageLine,
	normalizeLeadingCheckGlyph,
	splitRenderedImageBlock,
	stripAnsi,
} from "./domain/render-text.ts";
import { getRawStringArg, getStringArg, getTextContent } from "./domain/tool-arguments.ts";
import { isTaskToolName, taskPresentationEnvironmentEnabled } from "./domain/task-view.ts";
export { classifyBashCommandForDisplay, type BashDisplayInfo } from "./domain/bash-display.ts";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	BUILTIN_COMPATIBILITY_TOOL_NAMES,
	CLAUDIFY_REGISTERED_TOOL_NAMES,
	isBuiltinCompatibilityToolName,
	parseCompatibilityConfig,
	resolveCompatibilityFeatureEnabled,
	resolveCompatibilityToolEnabled,
	settingsFeatureEnabled,
	type CompatibilityConfig,
	type CompatibilityFeatureId,
	type CompatibilityToolFamily,
} from "./domain/compatibility.ts";
export {
	ASK_USER_QUESTION_TOOL_NAME,
	BUILTIN_COMPATIBILITY_TOOL_NAMES,
	COMPATIBILITY_FEATURE_IDS,
	parseCompatibilityConfig,
	resolveCompatibilityFeatureEnabled,
	resolveCompatibilityToolEnabled,
} from "./domain/compatibility.ts";
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
import { configureMessageComponents, DottedParagraph, ThinkingParagraph } from "./render/message-components.ts";
export { DottedParagraph, ThinkingParagraph } from "./render/message-components.ts";
import { createToolChrome } from "./render/tool-chrome.ts";
import { selectVisualItems, selectVisualPreview, widthAwareText, type VisualPreviewMode } from "./visual-preview.ts";
import { computeAggregateEditDiff, computeLocalizedEditDiffs } from "./tools/edit-preview.ts";
import { registerBuiltinTools } from "./tools/register-builtins.ts";
import { TaskPresentationController } from "./tools/task-presentation.ts";
import { renderApplyPatchCall as renderApplyPatchCallWithRuntime, renderApplyPatchResult as renderApplyPatchResultWithRuntime, type ApplyPatchRuntime } from "./tools/apply-patch-tool.ts";
import { renderGenericToolCall as renderGenericCall, renderGenericToolResult as renderGenericResult, type GenericToolRuntime } from "./tools/generic-tool.ts";
import { mcpServerForComponent, mcpServerName, renderMcpToolResult as renderMcpResult } from "./tools/mcp-tool.ts";
import { renderOpenAiToolResult as renderOpenAiResult, summarizeOpenAiToolCall as summarizeOpenAiCall } from "./tools/openai-tool.ts";
export { mcpServerName } from "./tools/mcp-tool.ts";
import { firstImageBlock, renderReadImage } from "./tools/read-image.ts";

export { anchorFramedHeights } from "./mouse-layout.ts";
export { sanitizeToolText } from "./terminal-sanitize.ts";
import {
	DEFAULT_HIDDEN_THINKING_LABEL,
	appendWorkedLine,
	formatWorkedLine,
	messageHasWorkedLine,
	resolveMessageChromeSettings,
	stripWorkedLines,
	resolveWorkedVerbs,
	type MessageChromeSettings,
	type WorkedVerbMode,
} from "./message-chrome.ts";

const RESET = "\x1b[0m";
const TRANSPARENT_BG = "\x1b[49m";
const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;

const TOOL_RENDER_CACHE = Symbol.for("pi-claudify:tool-render-cache");
const TOOL_PRESENTATION_REVISION = Symbol.for("pi-claudify:tool-presentation-revision");
const CUSTOM_MESSAGE_PATCH_FLAG = Symbol.for("pi-claudify:patched-custom-message-render");
const COMPACTION_MESSAGE_PATCH_FLAG = Symbol.for("pi-claudify:patched-compaction-message-render");
const USER_MESSAGE_PATCH_FLAG = Symbol.for("pi-claudify:patched-user-message-render");

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
	// `themeColors: false` also covers the manual re-apply calls the Claudify
	// screen triggers on `colorSource`/`accentColor` changes, not only the
	// automatic per-session/turn derivation inside applyThemePaletteIfNeeded.
	if (!settingsFeatureEnabled(readSettings().values, "themeColors")) return;
	applyAccentOverrideHost(theme);
}

export function applyToolBackgroundMode(theme: unknown): void {
	syncToolBackgroundMode();
	applyUserMessageBoxTheme(theme);
	applyToolBackgroundTheme(theme, toolBackgroundMode);
}

export function sanitizeRenderedTextBlockLines(lines: string[], _style: "claude" | "pi" = "claude"): string[] {
	// Structural Markdown differences are expressed through parser callbacks in
	// DottedParagraph/ThinkingParagraph. Rendered glyphs have no provenance: a
	// literal ` ``` `, `────`, or single `│` must never be mistaken for syntax.
	return lines;
}

function compatibilityToolFamilyForName(name: string): CompatibilityToolFamily | undefined {
	if (isMcpToolName(name)) return "mcp";
	if (isTaskToolName(name)) return "task";
	if (isOpenAiToolCandidate({ name })) return "openai";
	return "generic";
}

/**
 * Unifies the legacy `skipToolOverrides` exact-false override with the new
 * `compatibility.tools` resolution (global enabled -> exact name -> legacy
 * skip -> family `mcp:*`/`openai:*`/`generic:*` -> `default` -> true). Every
 * call site that previously consulted the legacy-only skip set (container
 * borders, inspection-group candidacy, tool-renderer patching) now goes
 * through this one function, so a disabled builtin/family/tool loses
 * registration, presentation, and grouping consistently.
 */
function presentationOverrideSkipped(toolName: unknown): boolean {
	if (typeof toolName !== "string" || toolName.length === 0) return false;
	const name = toolName.toLowerCase();
	const settings = readSettings().values;
	if (isTaskToolName(toolName) && !settingsFeatureEnabled(settings, "taskPresentation")) return true;
	const config = parseCompatibilityConfig(settings.compatibility);
	const legacySkipped = skippedToolOverrides(settings).has(name);
	const family = (CLAUDIFY_REGISTERED_TOOL_NAMES as readonly string[]).includes(name) ? undefined : compatibilityToolFamilyForName(name);
	return !resolveCompatibilityToolEnabled(config, name, family, legacySkipped);
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
function inspectionGroupRuntime(pointerOwner?: object): InspectionGroupRuntime {
	return {
		isPresentationOverrideSkipped: presentationOverrideSkipped,
		onPointerExpand: (members) => markPointerExpandedMembers(members, undefined, pointerOwner),
		shortPath,
		summarizeText,
		wrapMarkedLine,
		padToWidth,
		borderLine: themeOrchestrator.borderLine,
		syncToolBackgroundMode,
		toolBackgroundMode: () => toolBackgroundMode,
		toolRule: () => themeOrchestrator.toolRule(),
		workedLineForeground: () => themeOrchestrator.workedLineForeground(),
	};
}

export function ensureInspectionGroups(container: unknown, width?: number): void {
	ensureInspectionGroupsWithRuntime(container, inspectionGroupRuntime(), width);
}

function hostContainerPrototype(): any {
	const candidate = Object.getPrototypeOf(ToolExecutionComponent.prototype);
	return candidate && typeof candidate.render === "function" ? candidate : Container.prototype;
}

function patchGlobalToolBorders(owner: object, pointerOwner: object, taskPresentation?: TaskPresentationController): void {
	installContainerRenderPatch(
		[hostContainerPrototype(), Container.prototype],
		owner,
		hostContainerRender(),
		{
			presentationSkipped: presentationOverrideSkipped,
			hideToolRow: (value) => taskPresentation?.shouldHideRow(value) === true,
			isInspectionCandidate: (value) => isInspectionGroupCandidate(value, presentationOverrideSkipped),
			ensureInspectionGroups: (container, width) => ensureInspectionGroupsWithRuntime(container, inspectionGroupRuntime(pointerOwner), width),
			renderStackedBash: (container, width) => renderWithStackedConsecutiveBash(container, width, { isBlankLine }),
			settingsRevision: getSettingsRevision,
			presentationRevision: currentToolPresentationRevision,
			refreshPresentation: (component) => component.updateDisplay?.(),
			clearRenderCache: clearToolRenderCache,
			backgroundMode: () => { syncToolBackgroundMode(); return toolBackgroundMode; },
			isBlankLine,
			splitImageBlock: splitRenderedImageBlock,
			clampLine: themeOrchestrator.clampLineWidth,
			normalizeCheckGlyph: normalizeLeadingCheckGlyph,
			spacerLine: (width) => " ".repeat(width),
			borderLine: themeOrchestrator.borderLine,
			reanchor: anchorFramedHeights,
			diagnostic: (key, error) => debugDiagnostic(key, error),
		},
	);
}

function releaseGlobalToolBorders(owner?: object): void { releaseContainerRenderPatch(owner); }

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
const WORKED_DURATION_KEY = "_piClaudeStyleWorkedDurationMs";
const WORKED_START_KEY = "_piClaudeStyleWorkedStartMs";
function workedVerbs(): readonly string[] {
	const settings = readSettings().values;
	const mode: WorkedVerbMode = settings.workedVerbMode === "replace" ? "replace" : "append";
	return resolveWorkedVerbs(settings.workedVerbs, mode);
}

function workedDurationText(ms: number, seed?: number, verbs: readonly string[] = workedVerbs()): string {
	return `${themeOrchestrator.workedLineForeground()}${formatWorkedLine(ms, { seed, verbs })}${RESET}`;
}

function inlineWorkedDurationText(ms: number, seed?: number, verbs?: readonly string[]): string {
	return workedDurationText(ms, seed, verbs);
}

function stripWorkedDurationLine(text: string): string { return stripWorkedLines(text); }
function hasWorkedDurationLine(message: any): boolean { return messageHasWorkedLine(message); }

export function appendWorkedDurationLine(message: any, durationMs: number, seed?: number, verbs?: readonly string[]): void {
	appendWorkedLine(message, inlineWorkedDurationText(durationMs, seed, verbs));
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
		workedLineForeground: () => themeOrchestrator.workedLineForeground(),
		claudeBoxBackground: () => CLAUDE_PALETTE.userMessage.background,
		claudeBoxTextForeground: () => CLAUDE_PALETTE.userMessage.text,
		claudeBoxPrefixForeground: () => CLAUDE_PALETTE.userMessage.prefix,
		themeBoxBackground: getUserBoxThemeBackground,
		themeBoxPrefixForeground: getUserBoxThemePrefixForeground,
		customBoxBackground: getUserBoxCustomBackground,
		boxMode: userMessageBoxMode,
		enabled: () => settingsFeatureEnabled(readSettings().values, "userMessages"),
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
function patchReadImageExpansion(owner: object): void {
	installReadImageExpansion(owner, clearToolRenderCache, () => !toolPresentationSkipped("read"));
}
function patchToolRowIndent(owner: object): void {
	installToolRowLayout(
		owner,
		() => { syncToolBackgroundMode(); return toolBackgroundMode; },
		() => settingsFeatureEnabled(readSettings().values, "toolBackground"),
	);
}

let legacyToolRendererPatchDetected = false;

/**
 * `toolPresentation: false` (or the global switch) disables Claudify's dynamic
 * (mcp/openai/generic/apply_patch) tool call/result rendering — native pi
 * rendering shows through for those tools — without touching the general
 * container border/background chrome or read-only inspection grouping, which
 * are gated independently by `presentationOverrideSkipped` itself.
 */
function toolPresentationSkipped(toolName: unknown): boolean {
	if (!settingsFeatureEnabled(readSettings().values, "toolPresentation")) return true;
	return presentationOverrideSkipped(toolName);
}

function patchToolExecutionRenderers(
	owner: object,
	canOverrideSelfShell: (name: string, definition: unknown) => boolean,
	taskPresentation?: TaskPresentationController,
): void {
	legacyToolRendererPatchDetected = installToolRendererPatch(owner, {
		presentationSkipped: toolPresentationSkipped,
		shouldUseGeneric: (name) => isTaskToolName(name) ? taskPresentation?.supports(name) === true : shouldUseGenericToolRenderer(name),
		shouldUseNativeCall: (_name, component) => taskPresentation?.shouldUseNativeResult(component) === true,
		shouldUseNativeResult: (_name, component) => taskPresentation?.shouldUseNativeResult(component) === true,
		renderApplyCall: (args, theme, ctx) => renderApplyPatchCall(args, theme, ctx, (path) => shortPath(ctx.cwd ?? process.cwd(), path)),
		renderApplyResult: (result, options, theme, ctx) => renderApplyPatchResult(result, !!options?.isPartial, theme, ctx),
		renderGenericCall: (name, args, theme, ctx) => taskPresentation?.renderCall(name) ?? renderGenericToolCall(name, args, theme, ctx),
		renderGenericResult: (name, result, options, theme, ctx) => taskPresentation?.renderResult(name, !!ctx?.isError) ?? renderGenericToolResult(name, result, options, theme, ctx),
		canOverrideSelfShell,
		diagnostic: (key, error) => debugDiagnostic(key, error),
	});
}

function installCompatibleToolPresentations(owner: object, adapters: Iterable<any>): void {
	if (installToolPresentations(owner, adapters)) bumpToolPresentationRevision();
}

function releaseToolExecutionRenderers(owner: object): void {
	releaseToolRendererPatch(owner);
	bumpToolPresentationRevision();
}

const blinkScheduler = new BlinkScheduler(5, 500);
const toolChrome = createToolChrome({
	claudeEnabled: claudeChromeEnabled,
	palette: {
		defaultForeground: () => FG_DEFAULT,
		reset: () => RESET,
		transparentReset: () => TRANSPARENT_RESET,
		rowBackgroundReset: () => { syncToolBackgroundMode(); return toolBackgroundMode === "default" ? "" : TRANSPARENT_BG; },
		pending: getStatusDotPending,
		success: getStatusDotSuccess,
		error: getStatusDotError,
		gutter: getStatusGutterForeground,
		rule: () => themeOrchestrator.toolRule(),
	},
	blinkBright: (ctx) => blinkScheduler.isBright(ctx),
});

function toolHeader(tool: string, summary: string, theme: Theme, prefix = ""): string {
	applyThemePaletteIfNeeded(theme);
	return toolChrome.header(tool, summary, theme, prefix);
}
function ccEmphasis(): SummaryEmphasis { return toolChrome.emphasis(); }
function resultSentence(theme: Theme, text: string): string { return toolChrome.resultSentence(theme, text); }
function errorText(theme: Theme, text: string): string { return toolChrome.errorText(theme, text); }
function setToolStatus(ctx: any, status: "pending" | "success" | "error"): void { toolChrome.setStatus(ctx, status); }
function syncToolCallStatus(ctx: any): void { toolChrome.syncCallStatus(ctx); }
function shouldRevealCallArgs(ctx: any): boolean { return toolChrome.shouldRevealArgs(ctx); }
function stableCallSummary(ctx: any, key: string, build: () => string, reveal = shouldRevealCallArgs(ctx)): string {
	return toolChrome.stableSummary(ctx, key, build, reveal);
}
function hasOwnArg(args: any, key: string): boolean { return !!args && Object.prototype.hasOwnProperty.call(args, key); }
function fileExistsForTool(cwd: string, filePath: string): boolean {
	if (!filePath) return false;
	try { return existsSync(resolve(cwd, filePath)); } catch { return false; }
}
function toolStatusDot(ctx: any, theme: Theme): string {
	applyThemePaletteIfNeeded(theme);
	return toolChrome.statusDot(ctx, theme);
}
function withBranch(content: string, _theme: Theme, _isError = false, _continued = false): string { return toolChrome.withBranch(content); }
function withFinalBranchBlock(content: string, theme: Theme, isError = false): string { return withBranch(content, theme, isError); }
function indentBranchBlock(block: string): string { return block; }
function setupBlinkTimer(ctx: any): void { blinkScheduler.start(ctx); }
function clearBlinkTimer(ctx: any): void { blinkScheduler.stop(ctx); }

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

function toolTextStyle() { return { rule: themeOrchestrator.toolRule(), reset: TRANSPARENT_RESET }; }
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
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_DIFF_COLLAPSED_LINES;
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

/**
 * When on (the default), tool rows use Claude Code's chrome: status-colored bullet
 * (gray → green), bold tool name in the default foreground, and OSC 8 hyperlinked
 * paths. Set `toolChrome: "theme"` to keep the themed/accent-tinted rows.
 */
function claudeChromeEnabled(): boolean {
	// Tool chrome changes wording and hyperlink grammar as well as color.
	return readSettings().values.toolChrome !== "theme";
}

// render/diff-render.ts must not import @earendil-works/pi-tui directly
// (render/ boundary rule); wire its width dependency once at load time.
configureDiffWidthOps({ visibleWidth, truncateToWidth });

// Owns the mutable border/worked-line/tool-rule palette state and the
// theme-identity cache gate; see extensions/host/theme-orchestrator.ts.
const themeOrchestrator = createThemeOrchestrator({
	themeColorsEnabled: () => settingsFeatureEnabled(readSettings().values, "themeColors"),
	applyAccentOverride: applyAccentOverrideHost,
	themePolarity,
	applyStatusDotPalette,
	applyImmediateDiffPalette,
	themeAdaptiveEnabled,
	bumpDiffPresentationEpoch,
	safeFgAnsi,
	safeBgAnsi,
	applyThemeDerivedPalette,
	applyDiffPaletteState,
	isAutoDerivePending,
	autoDeriveBgFromTheme,
	markAutoDeriveApplied,
	getDiffColors: () => DEFAULT_DIFF_COLORS,
	transparentReset: () => TRANSPARENT_RESET,
});

export function applyThemePaletteIfNeeded(theme: any): void {
	themeOrchestrator.applyThemePaletteIfNeeded(theme);
}

export function applyDiffPalette(): void {
	themeOrchestrator.applyDiffPalette();
}

function resolveDiffColors(theme?: any): DiffColors {
	return themeOrchestrator.resolveDiffColors(theme);
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
			? `${shortPathForDisplay(path)} ${themeOrchestrator.borderColor()}→${TRANSPARENT_RESET} ${shortPathForDisplay(moveTo)}`
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
		diffPresentationEnabled: () => settingsFeatureEnabled(readSettings().values, "diffPresentation"),
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

function activateCurrentTestedPi(
	pi: ExtensionAPI,
	runtime: RuntimeHandle,
	activationPlan: ActivationPlan,
	compatConfig: CompatibilityConfig | undefined,
): void {
	// Compatibility and host capabilities are resolved once per extension
	// generation. Structural changes take effect on restart or /reload.
	const featureEnabled = (id: CompatibilityFeatureId): boolean => activationPlan.featureEnabled(id);
	const messageLifecycle = new MessageLifecycle();
	configureMessageComponents({
		Markdown,
		visibleWidth,
		workedForeground: () => themeOrchestrator.workedLineForeground(),
		defaultForeground: () => FG_DEFAULT,
		reset: () => RESET,
		sanitizeRenderedLines: sanitizeRenderedTextBlockLines,
		normalizeLeadingCheck: normalizeLeadingCheckGlyph,
	});
	// Every host binding installed by this factory shares one generation owner.
	// Individual broker surfaces are released independently, while retirement
	// fences the complete generation in one atomic owner transition.
	const fallbackSanitizerOwner = runtime.owner;
	const toolRendererOwner = runtime.owner;
	const globalRenderOwner = runtime.owner;
	const pointerExpansionOwner = runtime.owner;
	const messagePatchOwner = runtime.owner;
	const bindRuntimeSession = (ctx: any): void => {
		let key: string | undefined;
		try {
			key = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionManager?.getSessionFile?.();
		} catch { /* a host without stable session identity keeps rank fallback */ }
		if (!key) return;
		runtime.bindSession(String(key));
		testedPiPatchBroker.claimSessionHandoff(runtime.owner, String(key));
	};
	let executionOwners = new Map<string, ToolOwnerKind>();
	const refreshExecutionOwners = (knownTools?: unknown[], failClosed = false): void => {
		const observed = readToolOwners(() => knownTools ?? (pi as any).getAllTools?.());
		if (observed) executionOwners = observed;
		else if (failClosed) executionOwners = new Map();
	};
	try { refreshExecutionOwners(); } catch { /* registry is unavailable during factory loading on current Pi */ }
	const taskPresentation = featureEnabled("taskPresentation")
		&& featureEnabled("toolPresentation")
		&& taskPresentationEnvironmentEnabled(process.env.PI_CLAUDIFY_TASK_PRESENTATION)
		? new TaskPresentationController(runtime, {
			isSupportedOwner: (name) => executionOwners.get(name.toLowerCase()) === "external",
			toolEnabled: (name) => !presentationOverrideSkipped(name),
			refreshOwnership: () => { try { refreshExecutionOwners(undefined, true); } catch { executionOwners = new Map(); } },
		})
		: undefined;
	taskPresentation?.register(pi, (PiCodingAgent as any).InteractiveMode);
	if (featureEnabled("spinner")) registerSpinner(pi, runtime, { activeTaskForm: () => taskPresentation?.activeForm() });
	if (featureEnabled("toolPresentation")) {
		patchToolFallbackSanitization(fallbackSanitizerOwner);
		patchToolRenderCacheInvalidation();
	} else {
		releaseToolFallbackSanitization(fallbackSanitizerOwner);
	}
	if (featureEnabled("toolPresentation") && !presentationOverrideSkipped("read")) patchReadImageExpansion(fallbackSanitizerOwner);
	if (featureEnabled("toolBackground") || featureEnabled("inspectionGroups") || featureEnabled("bashStacking") || !!taskPresentation) patchGlobalToolBorders(globalRenderOwner, pointerExpansionOwner, taskPresentation);
	else releaseGlobalToolBorders(globalRenderOwner);
	// A fresh disabled feature installs no private wrapper. Stable wrappers from
	// prior generations remain inert because ownerless dispatch now delegates to
	// the pristine host method.
	if (featureEnabled("customMessages")) patchCustomMessageRenderer(
		CustomMessageComponent,
		CUSTOM_MESSAGE_PATCH_FLAG,
		messagePatchOwner,
		normalizeLeadingCheckGlyph,
	);
	if (featureEnabled("compactionSummary")) patchCompactionSummaryRenderer(
		CompactionSummaryMessageComponent,
		COMPACTION_MESSAGE_PATCH_FLAG,
		messagePatchOwner,
		() => `${getStatusGutterForeground()}${CLAUDE_RESULT_PREFIX}${FG_DEFAULT}Compacted ${themeOrchestrator.workedLineForeground()}(ctrl+o to see full summary)${RESET}`,
	);
	if (featureEnabled("userMessages")) patchUserMessageRenderer(UserMessageComponent, USER_MESSAGE_PATCH_FLAG, messagePatchOwner, userMessagePatchRuntime());
	if (featureEnabled("assistantMessages")) patchAssistantMessageRenderer(AssistantMessageComponent, ASSISTANT_PATCH_FLAG, messagePatchOwner, {
		workedStartKey: WORKED_START_KEY,
		workedDurationKey: WORKED_DURATION_KEY,
		currentAgentStart: messageLifecycle.currentAgentStart,
		createParagraph: (text, markdownTheme, style, thinking) => thinking
			? new ThinkingParagraph(text, markdownTheme, style)
			: new DottedParagraph(text, markdownTheme),
		hasWorkedDuration: hasWorkedDurationLine,
		workedDurationText,
		enabled: () => true,
	});
	if (featureEnabled("toolBackground")) patchToolRowIndent(fallbackSanitizerOwner);
	if (featureEnabled("toolPresentation")) patchToolExecutionRenderers(
		toolRendererOwner,
		(name, definition) => {
			const directOwner = classifyToolOwner(definition);
			return directOwner !== "external" && (directOwner === "builtin" || executionOwners.get(name.toLowerCase()) === "builtin");
		},
		taskPresentation,
	);
	if (featureEnabled("footer")) patchEditorBorderColor(runtime.owner);
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
	if (featureEnabled("footer")) registerSessionMetrics(pi, runtime.owner);
	if (featureEnabled("banner")) registerBanner(pi);
	if (featureEnabled("promptPointer")) registerPromptPointer(pi);

	if (featureEnabled("inspectionGroups")) registerPointerExpansionLifecycle(pi, pointerExpansionOwner, {
		isCurrent: () => runtime.isCurrent(),
		shouldWarnRestart: () => legacyToolRendererPatchDetected || legacyToolFallbackPatchDetected,
		warning: "Restart Pi once to finish upgrading Claudify's renderer hooks",
	});

	const refreshDiffPalette = (ctx: any, requestRender: () => void): void => {
		applyDiffPalette();
		themeOrchestrator.resetThemeCache();
		applyThemePaletteIfNeeded(ctx.ui.theme);
		clearHighlightCache();
		bumpDiffPresentationEpoch();
		requestRender();
	};
	// `settingsCommand: false` (or the global switch) never registers
	// `/claudify` at all — pi has no such command natively, so this is a full
	// pass-through: nothing to disable, restore, or fall back to.
	if (featureEnabled("settingsCommand")) registerClaudifyCommand(pi, {
		diffThemes: DIFF_PRESET_KEYS,
		colorKeys: COMMON_COLOR_KEYS,
		onSettingChange: (key, ctx, requestRender) => {
			if (key === "colorSource") {
				if (featureEnabled("themeColors")) applyAccentOverride(ctx.ui.theme);
				if (featureEnabled("toolBackground") || featureEnabled("userMessages")) applyToolBackgroundMode(ctx.ui.theme);
				if (featureEnabled("spinner")) bustSpinnerSettingsCache();
			}
			if (key === "toolBackground" && featureEnabled("toolBackground")) { setToolBackgroundOverride(null); applyToolBackgroundMode(ctx.ui.theme); }
			if (key === "hiddenThinkingLabel" && featureEnabled("assistantMessages")) applyHiddenThinkingLabel(ctx);
			if (key === "accentColor" && featureEnabled("themeColors")) applyAccentOverride(ctx.ui.theme);
			if (key === "userMessageBox" && featureEnabled("userMessages")) applyToolBackgroundMode(ctx.ui.theme);
			if (key === "promptPointer" && featureEnabled("promptPointer")) applyPromptPointer(ctx);
			if (key === "spinnerPlacement" && featureEnabled("promptPointer")) applyPromptPointer(ctx, true);
			if (featureEnabled("spinner") && ["spinnerColor", "spinnerStatusColor", "spinnerShimmer", "spinnerVerbs", "spinnerVerbMode", "themeAdaptive"].includes(key)) bustSpinnerSettingsCache();
			if (key === "diffSyntaxHighlighting" && featureEnabled("diffPresentation")) { clearHighlightCache(); bumpDiffPresentationEpoch(); }
			if (featureEnabled("diffPresentation") && ["diffTheme", "diffPalette", "themeAdaptive"].includes(key)) refreshDiffPalette(ctx, requestRender);
			if (key === "footerStyle" && featureEnabled("footer")) installClaudeFooter(ctx, pi);
			requestRender();
		},
		onSettingPreview: (key, value, ctx, requestRender) => {
			if (key === "diffTheme" && featureEnabled("diffPresentation")) {
				setDiffThemePreview(value === null ? null : typeof value === "string" ? value : undefined);
				refreshDiffPalette(ctx, requestRender);
				return;
			}
			if (featureEnabled("spinner") && (key === "spinnerColor" || key === "spinnerStatusColor")) {
				const previewKey = key === "spinnerColor" ? SPINNER_COLOR_PREVIEW_KEY : SPINNER_STATUS_COLOR_PREVIEW_KEY;
				if (typeof value === "string") (globalThis as any)[previewKey] = value;
				else delete (globalThis as any)[previewKey];
				bustSpinnerSettingsCache();
				requestRender();
			}
		},
	});


	const cwd = process.cwd();
	const sp = (path: string, runtimeCwd = cwd) => sanitizeToolText(shortPath(runtimeCwd, path));
	/** Short display path, clickable via OSC 8 — resolved against the tool's runtime cwd. */
	const spl = (path: string, runtimeCwd = cwd) => {
		if (!path || !claudeChromeEnabled()) return sp(path, runtimeCwd);
		return linkedPath(runtimeCwd, sp(path, runtimeCwd), resolve(runtimeCwd, path));
	};
	const skippedOverrides = skippedToolOverrides(readSettings().values);
	const preserveNativeExecution = process.env.PI_CLAUDIFY_NATIVE_EXECUTION !== "0";
	// register-builtins.ts calls registerReadTool/registerBashTool/etc
	// unconditionally; a tool named here is never handed to `pi.registerTool`
	// by the coordinator below (item 4: false means no registration,
	// presentation, or grouping for read/write/edit/bash/grep/find/ls).
	// apply_patch has no execution override to skip — its own gate is enforced
	// entirely through `presentationOverrideSkipped` inside the tool-renderer
	// patch instead.
	const disabledBuiltinTools = BUILTIN_COMPATIBILITY_TOOL_NAMES
		.filter((name) => name !== "apply_patch")
		.filter((name) => presentationOverrideSkipped(name));
	type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
	const registrationHost = {
		registerTool: (definition: RegisteredTool) => pi.registerTool(definition),
		getAllTools: () => (pi as any).getAllTools?.(),
	};
	const registrationOptions = (skipped: ReadonlySet<string>) => ({
		skipped,
		onDiagnostic: (key: string, error: unknown) => debugDiagnostic(key, error),
	});
	const builtinRegistration = new ToolRegistrationCoordinator<RegisteredTool>(
		registrationHost,
		registrationOptions(new Set<string>([...skippedOverrides, ...disabledBuiltinTools])),
	);
	const registerBuiltinOverride = (definition: RegisteredTool): void => builtinRegistration.add(definition);
	const additiveTools = new AdditiveToolsController(pi, runtime, activationPlan, {
		cwd,
		compatibility: compatConfig,
		onDiagnostic: (key, error) => debugDiagnostic(key, error),
	});
	const presentationAdapters = () => [
		...builtinRegistration.presentationAdapters(),
		...additiveTools.presentationAdapters(),
	];
	const installDeferredRegistrations = (ctx?: any): void => {
		const notify = ctx?.hasUI ? (message: string, kind: "warning") => ctx.ui?.notify?.(message, kind) : undefined;
		builtinRegistration.installDeferred(notify);
		additiveTools.installDeferred(ctx);
	};

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

	const registerAskUserQuestionForContext = (ctx: any): void => {
		if (additiveTools.registerAskForContext(ctx)) installCompatibleToolPresentations(toolRendererOwner, presentationAdapters());
	};

	registerBuiltinTools({
		cwd,
		registerBuiltinOverride,
		registerBuiltinExecution: !preserveNativeExecution,
		registerPresentation: (presentation: any) => builtinRegistration.addPresentation(presentation),
		forwardedToolContract,
		hostToolSettings,
		hostSettingsContext,
		spl,
		sp,
		syncToolCallStatus,
		stableCallSummary,
		makeText,
		toolHeader,
		toolStatusDot,
		withBranch,
		withFinalBranchBlock,
		renderToolTextLines,
		setupBlinkTimer,
		clearBlinkTimer,
		setToolStatus,
		firstImageBlock,
		renderReadImage,
		shortPath,
		errorText,
		resultSentence,
		claudeChromeEnabled,
		D_BOLD_ON,
		D_BOLD_OFF,
		plural,
		widthAwareText,
		visualPreviewText,
		collapsedPreviewCount,
		previewLimit,
		expandedPreviewLimit,
		getSettingsRevision,
		hashText,
		bashSemanticDisplayEnabled,
		bashOutputMode,
		bashRunningPreview,
		bashCollapsedLimit,
		FG_RULE,
		D_RST,
		summarizeDiff,
		shouldRevealCallArgs,
		hasOwnArg,
		ccEmphasis,
		writtenLineCount,
		renderWidthAwareDiff,
		diffCard,
		getCachedParsedDiff,
		diffContentWidth,
		claudeDiffPaletteEnabled,
		renderFileListing,
		renderUnified,
		resolveDiffColors,
		diffCollapsedLimit,
		MAX_RENDER_LINES,
		renderPrewrappedDiffLines,
		indentBranchBlock,
		computeAggregateEditDiff,
		computeLocalizedEditDiffs,
		buildAggregateEditPreviewText,
		buildEditPreviewText,
		diffPresentationEnabled: () => featureEnabled("diffPresentation"),
	});

	// Presentation is selected by the observable call/result contract, not by the
	// package that owns execution. Externally-owned compatible tools therefore
	// retain their execute/schema/policy while using Claudify's renderer. Always
	// installed (like patchToolExecutionRenderers above) and gated live through
	// toolPresentationSkipped, not by skipping this call.
	installCompatibleToolPresentations(toolRendererOwner, presentationAdapters());

	const provenanceObserver = preserveNativeExecution
		&& featureEnabled("toolPresentation")
		&& featureEnabled("diffPresentation")
		&& (!presentationOverrideSkipped("write") || !presentationOverrideSkipped("edit"))
		? new ToolProvenanceObserver(runtime, {
			isBuiltinOwner: (name) => !presentationOverrideSkipped(name) && executionOwners.get(name) === "builtin",
			summarizeDiff,
		})
		: undefined;
	if (preserveNativeExecution && featureEnabled("toolPresentation")) {
		pi.on("tool_execution_start", async () => { try { refreshExecutionOwners(undefined, true); } catch { executionOwners = new Map(); } });
	}
	if (provenanceObserver) {
		pi.on("tool_call", async (event: any, ctx: any) => {
			try { refreshExecutionOwners(); } catch { /* retain the last complete snapshot */ }
			provenanceObserver.onToolCall(event, ctx?.cwd ?? cwd);
		});
		pi.on("tool_result", async (event: any) => provenanceObserver.onToolResult(event));
		pi.on("tool_execution_end", async (event: any) => provenanceObserver.onToolEnd(event.toolCallId));
	}

	const discoverPresentationTools = (): void => {
		let allTools: unknown[] = [];
		try {
			allTools = typeof (pi as any).getAllTools === "function" ? (pi as any).getAllTools() : [];
		} catch (error) {
			debugDiagnostic("presentation-tool-discovery", error);
			return;
		}
		if (preserveNativeExecution) refreshExecutionOwners(allTools);
		resetToolDiscovery(runtime.owner);
		for (const tool of allTools) {
			// Public ToolInfo is metadata-only. Record provable MCP identity for
			// presentation, but never replace execution from private fields.
			if (isMcpToolCandidate(tool)) noteMcpTool(tool, runtime.owner);
		}
	};

	if (compatConfig?.enabled !== false) registerSessionEvents(pi, {
		isCurrent: () => runtime.isCurrent(),
		onSessionStart: (ctx) => {
			bindRuntimeSession(ctx);
			registerAskUserQuestionForContext(ctx);
			if (!ctx.hasUI) return;
			if (featureEnabled("userMessages")) applyUserMessageBoxTheme(ctx.ui.theme);
			if (featureEnabled("toolBackground")) {
				syncToolBackgroundMode();
				applyToolBackgroundTheme(ctx.ui.theme, toolBackgroundMode);
			}
			if (featureEnabled("themeColors") || featureEnabled("diffPresentation")) applyThemePaletteIfNeeded(ctx.ui.theme);
			if (featureEnabled("toolPresentation")) {
				bumpToolPresentationRevision();
				(ctx.ui as any).requestRender?.();
			}
			if (featureEnabled("assistantMessages")) applyHiddenThinkingLabel(ctx);
			if (featureEnabled("footer")) installClaudeFooter(ctx, pi);
		},
		onTurnStart: (ctx) => {
			if (!ctx.hasUI) return;
			if (featureEnabled("userMessages")) applyUserMessageBoxTheme(ctx.ui.theme);
			if (featureEnabled("toolBackground")) {
				syncToolBackgroundMode();
				applyToolBackgroundTheme(ctx.ui.theme, toolBackgroundMode);
			}
			if (featureEnabled("themeColors") || featureEnabled("diffPresentation")) applyThemePaletteIfNeeded(ctx.ui.theme);
			if (featureEnabled("assistantMessages")) applyHiddenThinkingLabel(ctx);
		},
		installDeferred: installDeferredRegistrations,
		discoverTools: discoverPresentationTools,
		onTurnEnd: () => { blinkScheduler.clear(); clearHighlightCache(); },
		onShutdown: (reason) => {
			// Current Pi reuses the extension factory across new/resume/fork even
			// though session-scoped resources receive shutdown/start events. Keep
			// generation authority alive for those transitions; only reload and
			// process quit retire the extension generation itself.
			if (reason !== "reload" && reason !== "quit") {
				provenanceObserver?.clear();
				blinkScheduler.clear();
				clearHighlightCache();
				return;
			}
			if (reason === "reload" && runtime.sessionKey) testedPiPatchBroker.offerSessionHandoff(runtime.owner, runtime.sessionKey);
			runtime.beginRetirement(reason);
			markContainerRenderPatchRetiring(globalRenderOwner);
			markToolRendererPatchRetiring(toolRendererOwner);
			markToolComponentPatchesRetiring(fallbackSanitizerOwner);
			releaseAssistantMessageRenderer(messagePatchOwner);
			releaseUserMessageRenderer(messagePatchOwner);
			releaseMessageRenderers(messagePatchOwner);
			const releaseBindings = () => {
				releaseGlobalToolBorders(globalRenderOwner);
				releaseToolExecutionRenderers(toolRendererOwner);
				releaseEditorBorderColor(runtime.owner);
				releaseSessionMetrics(runtime.owner);
				releaseToolDiscovery(runtime.owner);
				releaseToolFallbackSanitization(fallbackSanitizerOwner);
				releaseReadImageExpansion(fallbackSanitizerOwner);
				releaseToolRowLayout(fallbackSanitizerOwner);
			};
			if (reason === "reload") deferGenerationRelease(releaseBindings);
			else releaseBindings();
			provenanceObserver?.clear();
			blinkScheduler.clear();
			clearHighlightCache();
			void runtime.dispose((error) => debugDiagnostic("runtime-dispose", error));
		},
	});
}

export default function (pi: ExtensionAPI): void {
	const compatConfig: CompatibilityConfig | undefined = parseCompatibilityConfig(readSettings().values.compatibility);
	const probes = probeTestedPiCapabilities({
		extensionApi: pi as unknown as Record<string, unknown>,
		assumeTuiContext: true,
		ToolExecutionComponent,
		Container,
		AssistantMessageComponent,
		UserMessageComponent,
		CustomMessageComponent,
		CompactionSummaryMessageComponent,
		Loader,
		InteractiveMode: (PiCodingAgent as any).InteractiveMode,
	});
	const host = detectHostDescriptor({
		piVersion: typeof (PiCodingAgent as any).VERSION === "string" ? (PiCodingAgent as any).VERSION : undefined,
		profilePreference: parseProfilePreference(process.env.PI_CLAUDIFY_PROFILE),
		preserveCurrentBehavior: false,
		observedCapabilities: probes.capabilities,
	});
	const activationPlan = buildActivationPlan(host, compatConfig);
	const runtime = new RuntimeHandle();
	if (compatConfig?.enabled === false) {
		runtime.activate();
		return;
	}
	if (host.profile === "portable") {
		activatePortablePi(pi, runtime, activationPlan, compatConfig, (key, error) => debugDiagnostic(key, error));
		return;
	}
	activateTestedPiRuntime(runtime, () => activateCurrentTestedPi(pi, runtime, activationPlan, compatConfig));
}
