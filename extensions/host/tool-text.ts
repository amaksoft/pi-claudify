import { Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { WRAP_MARK } from "../terminal-sanitize.ts";

export interface ToolTextStyle {
	rule: string;
	reset: string;
}
export type ToolTextStyleProvider = () => ToolTextStyle;

export function padToWidth(line: string, width: number): string {
	return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

function continuationPrefix(prefix: string, style: ToolTextStyle): string {
	const plain = prefix.replace(/\x1b\[[0-9;]*m/g, "");
	const branch = /^(\s*)(?:│  |├─ |└─ )/.exec(plain);
	if (branch) return `${branch[1]}${style.rule}│${style.reset}  `;
	return " ".repeat(visibleWidth(prefix));
}

export function wrapMarkedLine(line: string, width: number, style: ToolTextStyle): string[] {
	const markerIndex = line.indexOf(WRAP_MARK);
	if (markerIndex === -1) return wrapTextWithAnsi(line, width);
	const prefix = line.slice(0, markerIndex);
	const body = line.slice(markerIndex + WRAP_MARK.length);
	const bodyWidth = Math.max(1, width - visibleWidth(prefix));
	const wrapped = wrapTextWithAnsi(body, bodyWidth);
	const continuation = continuationPrefix(prefix, style);
	return wrapped.map((part, index) => index === 0 ? `${prefix}${part}` : `${continuation}${part}`);
}

export class ToolTextComponent extends Text {
	private value = "";
	private toolCachedValue?: string;
	private toolCachedWidth?: number;
	private toolCachedLines?: string[];

	constructor(text: string, private style: ToolTextStyleProvider) {
		super("", 0, 0);
		this.value = text;
	}
	configureStyle(style: ToolTextStyleProvider): void { this.style = style; }
	setText(text: string): void { if (this.value !== text) { this.value = text; this.invalidate(); } }
	invalidate(): void { this.toolCachedValue = undefined; this.toolCachedWidth = undefined; this.toolCachedLines = undefined; }
	render(width: number): string[] {
		if (this.toolCachedLines && this.toolCachedValue === this.value && this.toolCachedWidth === width) return this.toolCachedLines;
		if (!this.value || this.value.trim() === "") return this.toolCachedLines = [];
		const rendered = this.value.replace(/\t/g, "   ").split("\n")
			.flatMap((line) => wrapMarkedLine(line, Math.max(1, width), this.style()))
			.map((line) => padToWidth(line, width));
		this.toolCachedValue = this.value;
		this.toolCachedWidth = width;
		this.toolCachedLines = rendered;
		return rendered;
	}
}

export function makeToolText(last: unknown, text: string, style: ToolTextStyleProvider): Text {
	const component = last instanceof ToolTextComponent ? last : new ToolTextComponent("", style);
	component.configureStyle(style);
	component.setText(text);
	return component;
}

const TOOL_TEXT_CACHE_LIMIT = 32;
// Skip caching very large outputs: the key duplicates the full text, so an
// unbounded entry would pin ~2x its payload (key plus wrapped lines).
const TOOL_TEXT_CACHE_TEXT_LIMIT = 256_000;
// Width+text LRU so repeated renders of unchanged tool output (every frame
// re-renders settled rows) reuse the wrapped lines instead of allocating a
// throwaway ToolTextComponent per call. Keyed on the style strings too, so a
// theme/palette change cannot serve stale-colored rows. Hits are frozen, so a
// caller can never mutate a shared entry and corrupt future renders.
const toolTextCache = new Map<string, readonly string[]>();

export function renderToolTextLines(text: string, width: number, style: ToolTextStyle): string[] {
	if (text.length > TOOL_TEXT_CACHE_TEXT_LIMIT) return new ToolTextComponent(text, () => style).render(width);
	const key = `${width}\n${style.rule}\n${style.reset}\n${text}`;
	const cached = toolTextCache.get(key);
	if (cached) {
		toolTextCache.delete(key);
		toolTextCache.set(key, cached);
		return [...cached];
	}
	const rendered = Object.freeze(new ToolTextComponent(text, () => style).render(width));
	toolTextCache.set(key, rendered);
	while (toolTextCache.size > TOOL_TEXT_CACHE_LIMIT) {
		const oldest = toolTextCache.keys().next();
		if (oldest.done) break;
		toolTextCache.delete(oldest.value);
	}
	return [...rendered];
}

export function renderPrewrappedDiffLines(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => {
		const clean = line.split(WRAP_MARK).join("");
		return visibleWidth(clean) <= width ? [clean] : wrapTextWithAnsi(clean, width);
	});
}
