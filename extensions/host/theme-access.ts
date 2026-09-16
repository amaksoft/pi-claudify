import { colorToRgb, rgbToAnsi256 } from "../domain/color-math.ts";

export type CustomHexColor = `#${string}`;

export function themeAccentIdentity(theme: unknown): object | null {
	const colors = (theme as any)?.fgColors;
	return colors && typeof colors === "object" ? colors as object : null;
}

export function themeFgKeys(theme: unknown): string[] {
	const colors = (theme as any)?.fgColors;
	if (colors instanceof Map) return [...colors.keys()];
	return colors && typeof colors === "object" ? Object.keys(colors) : [];
}

export function getThemeFg(theme: unknown, key: string): string | undefined {
	const colors = (theme as any)?.fgColors;
	const value = colors instanceof Map ? colors.get(key) : colors?.[key];
	return typeof value === "string" ? value : undefined;
}

export function setThemeFg(theme: unknown, key: string, value: string): void {
	const colors = (theme as any)?.fgColors;
	if (colors instanceof Map) colors.set(key, value);
	else if (colors && typeof colors === "object") colors[key] = value;
}

export function getThemeBg(theme: unknown, key: string): string | undefined {
	const colors = (theme as any)?.bgColors;
	const value = colors instanceof Map ? colors.get(key) : colors?.[key];
	return typeof value === "string" ? value : undefined;
}

export function setThemeBg(theme: unknown, key: string, value: string): void {
	const colors = (theme as any)?.bgColors;
	if (colors instanceof Map) colors.set(key, value);
	else if (colors && typeof colors === "object") colors[key] = value;
}

export function ansiFromHex(theme: unknown, hex: CustomHexColor, layer: "foreground" | "background"): string | null {
	const rgb = colorToRgb(hex);
	if (!rgb) return null;
	const prefix = layer === "foreground" ? 38 : 48;
	return (theme as any)?.mode === "256color"
		? `\x1b[${prefix};5;${rgbToAnsi256(rgb.r, rgb.g, rgb.b)}m`
		: `\x1b[${prefix};2;${rgb.r};${rgb.g};${rgb.b}m`;
}

export function bgAnsiFromHex(hex: string): string | null {
	const rgb = colorToRgb(hex);
	return rgb ? `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m` : null;
}

export function themePolarity(theme: unknown): "dark" | "light" | "unknown" {
	const rgb = colorToRgb(getThemeFg(theme, "text") ?? "");
	if (rgb) return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b > 128 ? "dark" : "light";
	const name = typeof (theme as any)?.name === "string" ? (theme as any).name.toLowerCase() : "";
	if (name.includes("light")) return "light";
	if (name.includes("dark")) return "dark";
	return "unknown";
}
