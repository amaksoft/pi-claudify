import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, getImageDimensions, imageFallback } from "@earendil-works/pi-tui";

import { getStringArg, getTextContent } from "../domain/tool-arguments.ts";
import { sanitizeToolText } from "../terminal-sanitize.ts";

export interface ReadImageRuntime {
	makeText(last: unknown, text: string): any;
	withBranch(content: string, theme: Theme): string;
	shortPath(path: string, cwd: string): string;
}

export function firstImageBlock(result: any): { data: string; mimeType: string } | undefined {
	if (!Array.isArray(result?.content)) return undefined;
	return result.content.find((block: any) => block?.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string");
}

function fallbackText(runtime: ReadImageRuntime, result: any, ctx: any): string {
	const image = firstImageBlock(result);
	if (!image) return "";
	let dimensions;
	try { dimensions = getImageDimensions(image.data, image.mimeType) ?? undefined; }
	catch { dimensions = undefined; }
	const path = getStringArg(ctx.args, "path", "file_path");
	const filename = path ? runtime.shortPath(path, ctx.cwd ?? process.cwd()) : undefined;
	return imageFallback(image.mimeType, dimensions, filename);
}

export function renderReadImage(runtime: ReadImageRuntime, result: any, expanded: boolean, theme: Theme, ctx: any): any {
	const image = firstImageBlock(result);
	const mimeType = sanitizeToolText(image?.mimeType ?? "image");
	const summary = `${theme.fg("success", "Image loaded")} ${theme.fg("muted", `[${mimeType}]`)}`;
	if (!expanded) return runtime.makeText(ctx.lastComponent, runtime.withBranch(summary, theme));
	const notes = getTextContent(result).split("\n").map((line) => sanitizeToolText(line.trim())).filter((line) => line && !/^Read image file\b/i.test(line));
	const lines = [summary, ...notes.map((line) => theme.fg("dim", line))];
	if (!getCapabilities().images || !ctx.showImages) {
		const fallback = fallbackText(runtime, result, ctx);
		if (fallback) lines.push(theme.fg("toolOutput", sanitizeToolText(fallback)));
	}
	return runtime.makeText(ctx.lastComponent, runtime.withBranch(lines.join("\n"), theme));
}
