import type { BundledTheme } from "shiki";

import { settingsFeatureEnabled } from "./compatibility.ts";
import { readSettings } from "../settings.ts";
import {
	colorToRgb,
	hexToBgAnsi,
	hexToFgAnsi,
	mixRgb,
	parseAnsiRgb,
	rgbToBgAnsi,
	type Rgb,
} from "./color-math.ts";

// ---------------------------------------------------------------------------
// Diff palette — preset/config types, the diff-specific mutable ANSI state,
// and the pure derivation math that turns an active Pi Theme (or an explicit
// user config) into the escapes extensions/render/diff-render.ts paints.
//
// This module must not import Pi host packages (enforced by
// scripts/test-architecture-boundaries.ts), so theme access is injected via
// `DiffThemeReader` rather than imported from extensions/host/theme-access.ts.
// index.ts wires the real reader (themePolarity/safeFgAnsi/safeBgAnsi).
// ---------------------------------------------------------------------------

export interface DiffThemeReader {
	polarity(theme: unknown): "dark" | "light" | "unknown";
	fgAnsi(theme: unknown, key: string): string | null;
	bgAnsi(theme: unknown, key: string): string | null;
}

export interface DiffPreset {
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

export interface DiffUserConfig {
	diffTheme?: string;
	diffColors?: Record<string, string>;
}

export interface DiffColors {
	fgAdd: string;
	fgDel: string;
	fgCtx: string;
}

export const DIFF_PRESETS: Record<string, DiffPreset> = {
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

/** Sets/clears the live (unsaved) `diffTheme` preview shown while the picker is open. */
export function setDiffThemePreview(value: string | null | undefined): void {
	diffThemePreview = value;
}

function loadDiffConfig(): DiffUserConfig {
	const settings = readSettings().values;
	// `diffPresentation: false` ignores diffTheme/diffColors (and any live
	// picker preview) entirely, so diffs always reset to Claude's built-in
	// default palette — existing style settings stay subordinate to the gate.
	if (!settingsFeatureEnabled(settings, "diffPresentation")) return {};
	return {
		diffTheme: diffThemePreview === undefined ? settings.diffTheme : (diffThemePreview ?? undefined),
		diffColors: settings.diffColors,
	};
}

// ---------------------------------------------------------------------------
// Theme palette extraction — pull RGB from the active pi theme so our
// hardcoded greys and accent colors track the user's selected theme.
//
// `reader.fgAnsi(theme, name)` / `reader.bgAnsi(theme, name)` return raw ANSI
// escapes (either truecolor or 256color depending on the terminal). We parse
// those back into RGB so we can mix tints for diff backgrounds.
// ---------------------------------------------------------------------------

function themeFgRgb(theme: unknown, key: string, reader: DiffThemeReader): Rgb | null {
	const ansi = reader.fgAnsi(theme, key);
	return ansi ? parseAnsiRgb(ansi) : null;
}

function themeBgRgb(theme: unknown, key: string, reader: DiffThemeReader): Rgb | null {
	const ansi = reader.bgAnsi(theme, key);
	return ansi ? parseAnsiRgb(ansi) : null;
}

export function themeAdaptiveEnabled(): boolean {
	const settings = readSettings().values;
	return settings.themeAdaptive !== false;
}

/**
 * When on (the default), diffs use Claude Code's fixed palette and unified layout
 * instead of deriving colors from the active pi theme. Set `diffPalette: "theme"`
 * to get the theme-derived tints back.
 */
export function claudeDiffPaletteEnabled(): boolean {
	// This setting also selects unified versus legacy split grammar, so a global
	// color-source change must not alter it implicitly.
	return readSettings().values.diffPalette !== "theme";
}

// Claude Code highlights diff content with a Monokai palette (fg 248,248,242,
// keywords 102,217,239, numbers 190,132,255).
export let DIFF_THEME: BundledTheme = (process.env.DIFF_THEME as BundledTheme | undefined) ?? "monokai";

export const SPLIT_MIN_WIDTH = 150;
export const SPLIT_MIN_CODE_WIDTH = 60;
export const SPLIT_MAX_WRAP_RATIO = 0.2;
export const SPLIT_MAX_WRAP_LINES = 8;
export const MAX_TERM_WIDTH = 210;
export const DEFAULT_TERM_WIDTH = 200;
export const MAX_PREVIEW_LINES = 60;
export const MAX_RENDER_LINES = 150;
export const WORD_DIFF_MIN_SIM = 0.15;
export const MAX_WRAP_ROWS_WIDE = 3;
export const MAX_WRAP_ROWS_MED = 2;
// Narrow terminals reflow long diff lines across up to 2 rows before
// truncating with the › marker. A 1-row cap amputated every overflowing
// line below 120 cols (hiding the added/removed tokens the diff exists to
// show); 2 rows keeps narrow output bounded while preserving content.
export const MAX_WRAP_ROWS_NARROW = 2;

// Pure ANSI literals mirroring index.ts's shared RESET/TRANSPARENT_BG/
// TRANSPARENT_RESET/FG_DEFAULT constants. Duplicated (not imported) because
// they are plain string literals with no host dependency, and this module
// must not import index.ts or extensions/host/*.
const RESET = "\x1b[0m";
const TRANSPARENT_BG = "\x1b[49m";
const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;
const FG_DEFAULT = "\x1b[39m";

export let D_RST = "\x1b[0m";
export const D_BOLD = "\x1b[1m";
export const D_DIM = "\x1b[2m";

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
export let CC_FG_DIFF_TEXT = CC_FG_DIFF_TEXT_DARK;
export let claudeDiffLightMode = false;

// Diff backgrounds default to Claude Code's palette; autoDeriveBgFromTheme only
// overrides them when the user opts out of the Claude palette.
export let BG_ADD = CC_BG_ADD;
export let BG_DEL = CC_BG_DEL;
export let BG_ADD_W = CC_BG_ADD_WORD;
export let BG_DEL_W = CC_BG_DEL_WORD;
export let BG_GUTTER_ADD = CC_BG_ADD;
export let BG_GUTTER_DEL = CC_BG_DEL;
export let BG_EMPTY = "\x1b[49m";
export let BG_BASE = "\x1b[49m";

export let FG_ADD = CC_FG_ADD;
export let FG_DEL = CC_FG_DEL;
export let FG_DIM = "\x1b[38;2;80;80;80m";
export let FG_LNUM = "\x1b[38;2;100;100;100m";
export let FG_RULE = "\x1b[38;2;50;50;50m";
export let FG_SAFE_MUTED = "\x1b[38;2;139;148;158m";
export let FG_STRIPE = "\x1b[38;2;40;40;40m";

export let DIVIDER = `${FG_RULE}│${D_RST}`;

export let DEFAULT_DIFF_COLORS: DiffColors = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
let autoDerivePending = true;
let hasExplicitBgConfig = false;
let explicitDiffLightMode: boolean | undefined;

export function isAutoDerivePending(): boolean {
	return autoDerivePending;
}

export function markAutoDeriveApplied(): void {
	autoDerivePending = false;
}

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

export function applyClaudeDiffPalette(theme: unknown, reader: DiffThemeReader): boolean {
	const polarity = reader.polarity(theme);
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

export function applyUnknownPolarityDiffPalette(theme: unknown, reader: DiffThemeReader): void {
	claudeDiffLightMode = false;
	BG_ADD = BG_DEL = BG_ADD_W = BG_DEL_W = TRANSPARENT_BG;
	BG_GUTTER_ADD = BG_GUTTER_DEL = TRANSPARENT_BG;
	BG_EMPTY = BG_BASE = TRANSPARENT_BG;
	FG_ADD = reader.fgAnsi(theme, "toolDiffAdded") ?? reader.fgAnsi(theme, "success") ?? FG_DEFAULT;
	FG_DEL = reader.fgAnsi(theme, "toolDiffRemoved") ?? reader.fgAnsi(theme, "error") ?? FG_DEFAULT;
	CC_FG_DIFF_TEXT = reader.fgAnsi(theme, "text") ?? FG_DEFAULT;
	D_RST = TRANSPARENT_RESET;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: reader.fgAnsi(theme, "toolDiffContext") ?? FG_DEFAULT };
}

export function autoDeriveBgFromTheme(theme: unknown, reader: DiffThemeReader): void {
	// Claude has dedicated dark and light semantic palettes; neither is derived
	// from Pi success/error colors. Unknown polarity stays transparent and uses
	// theme semantic foreground escapes without inventing a dark RGB base.
	if (claudeDiffPaletteEnabled()) {
		if (!applyClaudeDiffPalette(theme, reader)) applyUnknownPolarityDiffPalette(theme, reader);
		return;
	}
	if (reader.polarity(theme) === "unknown") {
		applyUnknownPolarityDiffPalette(theme, reader);
		return;
	}
	// Diff palette derivation.
	//
	// `toolDiffAdded` / `toolDiffRemoved` from the active pi theme give us the
	// fg accents. The base background is taken from `toolSuccessBg` (close to
	// the panel color the row will sit on) so the tinted backgrounds blend in
	// instead of forcing a hardcoded dark hue. Falls back to the universal
	// dark palette when the theme is unavailable or themeAdaptive=false.
	const useTheme = themeAdaptiveEnabled() && !!theme;
	const addFgRgb = (useTheme ? themeFgRgb(theme, "toolDiffAdded", reader) : null) ?? UNIVERSAL_DIFF_ADD_FG;
	const delFgRgb = (useTheme ? themeFgRgb(theme, "toolDiffRemoved", reader) : null) ?? UNIVERSAL_DIFF_DEL_FG;
	const base = (useTheme ? themeBgRgb(theme, "toolSuccessBg", reader) : null) ?? FALLBACK_BASE_BG;

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

/**
 * The "always run" branch of index.ts's `applyThemePaletteIfNeeded` — applies
 * Claude's fixed dark/light diff palette (or the theme-derived fallback),
 * independent of the theme-identity cache gate. `polarity` is the caller's
 * already-computed `reader.polarity(theme)` (the status-dot palette needs the
 * same value, so index.ts computes it once and shares it).
 */
export function applyImmediateDiffPalette(theme: unknown, reader: DiffThemeReader, polarity: "dark" | "light" | "unknown"): void {
	if (claudeDiffPaletteEnabled() && !hasExplicitBgConfig) {
		if (!applyClaudeDiffPalette(theme, reader)) applyUnknownPolarityDiffPalette(theme, reader);
	} else {
		claudeDiffLightMode = explicitDiffLightMode ?? polarity === "light";
	}
}

/**
 * The theme-adaptive, cache-gated branch of `applyThemePaletteIfNeeded`: diff
 * support text colors (FG_DIM/FG_LNUM/FG_RULE/FG_STRIPE/FG_SAFE_MUTED) track
 * pi's muted/borderMuted unless the user set an explicit `diffColors.*`
 * override, then backgrounds are re-derived unless the user supplied an
 * explicit preset/override via `applyDiffPalette()`.
 */
export function applyThemeDerivedPalette(theme: unknown, reader: DiffThemeReader, muted: string | null, borderMuted: string | null): void {
	if (!_explicitFgFields.has("fgDim") && muted) FG_DIM = muted;
	if (!_explicitFgFields.has("fgLnum") && muted) FG_LNUM = muted;
	if (!_explicitFgFields.has("fgRule") && borderMuted) FG_RULE = borderMuted;
	if (!_explicitFgFields.has("fgStripe") && borderMuted) FG_STRIPE = borderMuted;
	if (!_explicitFgFields.has("fgSafeMuted") && muted) FG_SAFE_MUTED = muted;

	DIVIDER = `${FG_RULE}│${D_RST}`;

	// Re-trigger background derivation against the new theme unless the user
	// set explicit bg overrides via diffTheme/diffColors.
	if (!hasExplicitBgConfig) {
		autoDeriveBgFromTheme(theme, reader);
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

// ---------------------------------------------------------------------------
// Sync width/summary helpers — pure functions of counts, palette constants,
// and terminal width with no Shiki dependency. They live here (not in
// render/diff-render.ts) so synchronous render call sites in the composition
// root stay off the lazily-loaded Shiki graph; render/diff-render.ts
// re-exports them for compatibility.
// ---------------------------------------------------------------------------

export function termW(): number {
	const raw =
		process.stdout.columns ||
		(process.stderr as any).columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		DEFAULT_TERM_WIDTH;
	return Math.max(40, Math.min(raw - 4, MAX_TERM_WIDTH));
}

export function branchDiffWidth(): number {
	return Math.max(40, termW() - 8);
}

export function renderDiffStatBar(added: number, removed: number, width = termW()): string {
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

export function summarizeDiff(added: number, removed: number): string {
	const parts: string[] = [];
	if (added > 0) parts.push(`${FG_ADD}+${added}${D_RST}`);
	if (removed > 0) parts.push(`${FG_DEL}-${removed}${D_RST}`);
	if (!parts.length) return `${FG_DIM}no changes${D_RST}`;
	const bar = renderDiffStatBar(added, removed);
	return bar ? `${parts.join(" ")} ${bar}` : parts.join(" ");
}

export function diffSummaryWithMeta(added: number, removed: number, hunks: number, mode: string): string {
	const base = summarizeDiff(added, removed);
	const extras: string[] = [];
	if (hunks > 0) extras.push(`${FG_DIM}${hunks} hunk${hunks === 1 ? "" : "s"}${D_RST}`);
	if (mode) extras.push(`${FG_DIM}${mode}${D_RST}`);
	return extras.length ? `${base} ${FG_DIM}•${D_RST} ${extras.join(` ${FG_DIM}•${D_RST} `)}` : base;
}
