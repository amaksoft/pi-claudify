import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { DiffColors, DiffThemeReader } from "../domain/diff-palette.ts";
import { themeAccentIdentity } from "./theme-access.ts";

// ---------------------------------------------------------------------------
// Theme orchestration — owns the composition root's mutable palette state
// (border color, worked-line foreground, tool branch rule) and the cache gate
// that decides when a Pi Theme actually needs re-deriving. Delegates the
// diff-specific palette derivation to domain/diff-palette.ts and the
// diagnostic bookkeeping (epoch bump, auto-derive) to its injected deps.
//
// index.ts owns the concrete Pi Theme/host wiring; this host/ module stays
// framework-adjacent (pi-tui width helpers only) so it can be unit tested
// without a live theme.
// ---------------------------------------------------------------------------

export interface ThemeOrchestratorDeps {
	/** `themeColors: false` makes `applyThemePaletteIfNeeded` a complete no-op (native pi theme shows through). */
	themeColorsEnabled(): boolean;
	applyAccentOverride(theme: unknown): void;
	themePolarity(theme: unknown): "dark" | "light" | "unknown";
	applyStatusDotPalette(theme: unknown, polarity: "dark" | "light" | "unknown"): void;
	applyImmediateDiffPalette(theme: unknown, reader: DiffThemeReader, polarity: "dark" | "light" | "unknown"): void;
	themeAdaptiveEnabled(): boolean;
	bumpDiffPresentationEpoch(): void;
	safeFgAnsi(theme: unknown, key: string): string | null;
	safeBgAnsi(theme: unknown, key: string): string | null;
	applyThemeDerivedPalette(theme: unknown, reader: DiffThemeReader, muted: string | null, borderMuted: string | null): void;
	applyDiffPaletteState(): void;
	isAutoDerivePending(): boolean;
	autoDeriveBgFromTheme(theme: unknown, reader: DiffThemeReader): void;
	markAutoDeriveApplied(): void;
	getDiffColors(): DiffColors;
	transparentReset(): string;
}

export interface ThemeOrchestrator {
	/**
	 * Wires the composition-root's non-diff theme state (borders, worked-line
	 * foreground, tool branch rule, status dots, accent) and delegates the
	 * diff-specific palette derivation to domain/diff-palette.ts. Preserves the
	 * original control flow exactly: the "always run" Claude/theme-derived diff
	 * palette branch runs unconditionally, then the theme-identity cache gate,
	 * then the cached border/worked-line/tool-rule/diff-text-color block.
	 */
	applyThemePaletteIfNeeded(theme: any): void;
	applyDiffPalette(): void;
	resolveDiffColors(theme?: any): DiffColors;
	borderLine(width: number): string;
	clampLineWidth(line: string, width: number): string;
	borderColor(): string;
	workedLineForeground(): string;
	toolRule(): string;
	/** Forces the next applyThemePaletteIfNeeded call to re-derive, even for the same Theme instance. */
	resetThemeCache(): void;
}

export function createThemeOrchestrator(deps: ThemeOrchestratorDeps): ThemeOrchestrator {
	// Defaults match the previous hardcoded values so behavior is identical
	// when the theme is unavailable or themeAdaptive=false.
	let borderColorState = "\x1b[38;5;238m";
	let workedLineForegroundState = "\x1b[38;2;140;140;140m";
	// Claude Code highlights diff content with a Monokai palette (fg 248,248,242,
	// keywords 102,217,239, numbers 190,132,255).
	let toolRuleState = "\x1b[38;2;153;153;153m";
	// Cache theme identity so we only recompute on theme change. The Theme
	// object is reused across renders within a single session unless the user
	// switches themes via the picker.
	let cachedThemeIdentity: unknown = null;

	const diffThemeReader: DiffThemeReader = {
		polarity: deps.themePolarity,
		fgAnsi: deps.safeFgAnsi,
		bgAnsi: deps.safeBgAnsi,
	};

	function applyThemePaletteIfNeeded(theme: any): void {
		if (!theme || !deps.themeColorsEnabled()) return;
		// Runs before the adaptive/cache guards: captured Claude dark/light palettes
		// and accent overrides apply even when theme-derived colors are disabled.
		deps.applyAccentOverride(theme);
		const polarity = deps.themePolarity(theme);
		deps.applyStatusDotPalette(theme, polarity);
		deps.applyImmediateDiffPalette(theme, diffThemeReader, polarity);
		if (!deps.themeAdaptiveEnabled()) return;
		const themeIdentity = themeAccentIdentity(theme) ?? theme;
		if (cachedThemeIdentity === themeIdentity) return; // instance and forwarding proxies share fgColors
		cachedThemeIdentity = themeIdentity;
		deps.bumpDiffPresentationEpoch();

		// Borders (top/bottom outlines, user-message frame, branch rule).
		const borderMuted = deps.safeFgAnsi(theme, "borderMuted");
		if (borderMuted) borderColorState = borderMuted;

		// "Worked for Ns" line + thinking-block italics share pi's `muted` color.
		const muted = deps.safeFgAnsi(theme, "muted");
		if (muted) workedLineForegroundState = muted;

		// Tool branch rule (├─ / └─ connectors). Use `dim` if present, else `muted`.
		const dim = deps.safeFgAnsi(theme, "dim") ?? muted;
		if (dim) toolRuleState = dim;

		// Diff support text colors + background re-derivation.
		deps.applyThemeDerivedPalette(theme, diffThemeReader, muted, borderMuted);
	}

	function applyDiffPalette(): void {
		deps.applyDiffPaletteState();
	}

	function resolveDiffColors(theme?: any): DiffColors {
		applyThemePaletteIfNeeded(theme);
		if (deps.isAutoDerivePending() && theme?.getFgAnsi) {
			deps.autoDeriveBgFromTheme(theme, diffThemeReader);
			deps.markAutoDeriveApplied();
		}
		return deps.getDiffColors();
	}

	function borderLine(width: number): string {
		return `${borderColorState}${"─".repeat(Math.max(1, width))}${deps.transparentReset()}`;
	}

	function clampLineWidth(line: string, width: number): string {
		if (width <= 0) return "";
		return visibleWidth(line) > width ? truncateToWidth(line, width) : line;
	}

	return {
		applyThemePaletteIfNeeded,
		applyDiffPalette,
		resolveDiffColors,
		borderLine,
		clampLineWidth,
		borderColor: () => borderColorState,
		workedLineForeground: () => workedLineForegroundState,
		toolRule: () => toolRuleState,
		resetThemeCache: () => { cachedThemeIdentity = null; },
	};
}
