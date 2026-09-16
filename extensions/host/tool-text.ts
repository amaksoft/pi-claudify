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

export function renderToolTextLines(text: string, width: number, style: ToolTextStyle): string[] {
	return new ToolTextComponent(text, () => style).render(width);
}

export function renderPrewrappedDiffLines(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => {
		const clean = line.split(WRAP_MARK).join("");
		return visibleWidth(clean) <= width ? [clean] : wrapTextWithAnsi(clean, width);
	});
}
