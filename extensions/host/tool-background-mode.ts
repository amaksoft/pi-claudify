import { readSettings } from "../settings.ts";
import { setThemeBg } from "./theme-access.ts";

export type ToolBackgroundMode = "default" | "transparent" | "outlines";

const TRANSPARENT_BG = "\x1b[49m";

// The settings-screen live preview writes here so a picker selection takes
// effect without round-tripping through disk; cleared back to null once the
// user commits an explicit `toolBackground` setting (or never set at all).
let toolBackgroundOverride: ToolBackgroundMode | null = null;

export function setToolBackgroundOverride(mode: ToolBackgroundMode | null): void {
	toolBackgroundOverride = mode;
}

/** Live override wins; otherwise the persisted `toolBackground` setting, defaulting to "transparent". */
export function computeToolBackgroundMode(): ToolBackgroundMode {
	if (toolBackgroundOverride) return toolBackgroundOverride;
	const settings = readSettings().values;
	return settings.toolBackground ?? "transparent";
}

/**
 * Clears pi's tool-status backgrounds so Claudify's transparent/outline chrome
 * shows through instead of pi's tinted rows. No-op when `mode` is "default",
 * which keeps pi's native tool-status backgrounds.
 */
export function applyToolBackgroundTheme(theme: unknown, mode: ToolBackgroundMode): void {
	if (mode === "default") return;
	setThemeBg(theme, "toolPendingBg", TRANSPARENT_BG);
	setThemeBg(theme, "toolSuccessBg", TRANSPARENT_BG);
	setThemeBg(theme, "toolErrorBg", TRANSPARENT_BG);
}
