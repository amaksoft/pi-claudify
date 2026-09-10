import type { SettingsFile } from "./settings.ts";

export type ColorSource = "claude" | "theme";
export type MarkdownStyle = "claude" | "pi";

export function resolveColorSource(settings: SettingsFile): ColorSource {
	return settings.colorSource === "theme" ? "theme" : "claude";
}

export function resolveMarkdownStyle(settings: SettingsFile): MarkdownStyle {
	return settings.markdownStyle === "pi" ? "pi" : "claude";
}

/** Explicit per-surface controls win; the profile supplies only their default. */
export function resolveSurfaceColorSource(
	settings: SettingsFile,
	key: "accentColor" | "userMessageBox",
): ColorSource | string {
	const explicit = settings[key];
	return typeof explicit === "string" ? explicit : resolveColorSource(settings);
}

export function resolveSpinnerShimmer(settings: SettingsFile): boolean {
	return typeof settings.spinnerShimmer === "boolean"
		? settings.spinnerShimmer
		: resolveColorSource(settings) === "claude";
}
