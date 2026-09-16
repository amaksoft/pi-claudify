import { CLAUDE_PALETTE } from "../claude-palette.ts";
import { readSettings } from "../settings.ts";
import {
	ansiFromHex,
	bgAnsiFromHex,
	getThemeBg,
	safeFgAnsi,
	setThemeBg,
	storedHexColor,
	type CustomHexColor,
} from "./theme-access.ts";

// Claude Code's settled user-message box, captured under 256 colors (237/239/231).
// Capture + geometry: docs/plans/2026-07-16-cc-user-message-box.md.
export const CC_USER_BOX_BG = CLAUDE_PALETTE.userMessage.background;
export const CC_USER_BOX_PREFIX_FG = CLAUDE_PALETTE.userMessage.prefix;
export const CC_USER_BOX_TEXT_FG = CLAUDE_PALETTE.userMessage.text;

const TRANSPARENT_BG = "\x1b[49m";

const originalUserMessageBg = new WeakMap<object, string>();
let userBoxThemeBg: string | null = null;
let userBoxThemePrefixFg: string | null = null;
let userBoxCustomBg: { hex: CustomHexColor; ansi: string } | null = null;

export function getUserBoxThemeBackground(): string | null {
	return userBoxThemeBg;
}

export function getUserBoxThemePrefixForeground(): string | null {
	return userBoxThemePrefixFg;
}

export function getUserBoxCustomBackground(mode: string): string | null {
	return userBoxCustomBg?.hex === mode ? userBoxCustomBg.ansi : null;
}

/**
 * Recomputes the theme- and custom-hex-derived user-message-box backgrounds
 * for `theme`, then blanks the theme's own `userMessageBg` so pi's native
 * markdown background stays stripped in every mode. The user-message box
 * (theme mode) paints with the theme's remembered original value instead.
 * See docs/plans/2026-07-16-cc-user-message-box.md.
 */
export function applyUserMessageBoxTheme(theme: unknown): void {
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
}
