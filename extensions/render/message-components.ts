import { CLAUDE_PALETTE } from "../claude-palette.ts";
import { formatTranscriptLines, resolveMessageChromeSettings, type MessageChromeSettings } from "../message-chrome.ts";
import { resolveColorSource, resolveMarkdownStyle } from "../presentation-profile.ts";
import { readSettings } from "../settings.ts";

// This render/ module must not import Pi host packages directly (enforced by
// scripts/test-architecture-boundaries.ts). `Markdown` (from @earendil-works/pi-tui)
// and grapheme-aware `visibleWidth` are wired in by index.ts via
// configureMessageComponents(), mirroring render/diff-render.ts's configureDiffWidthOps().

/** Minimal surface of @earendil-works/pi-tui's Markdown class this module needs. */
export interface MarkdownLike {
	render(width: number): string[];
	invalidate(): void;
}
export interface MarkdownFactory {
	new (text: string, x: number, y: number, theme: any, defaultTextStyle?: any): MarkdownLike;
}

export interface MessageComponentRuntime {
	Markdown: MarkdownFactory;
	visibleWidth(text: string): number;
	workedForeground(): string;
	defaultForeground(): string;
	reset(): string;
	sanitizeRenderedLines(lines: string[], style: "claude" | "pi"): string[];
	normalizeLeadingCheck(line: string): string;
}
const fallbackVisibleWidth = (text: string): number => text.replace(/\x1b\[[0-9;]*m/g, "").length;
class FallbackMarkdown implements MarkdownLike {
	constructor(private text: string) {}
	render(_width: number): string[] { return [this.text]; }
	invalidate(): void {}
}
let runtime: MessageComponentRuntime = {
	Markdown: FallbackMarkdown as unknown as MarkdownFactory,
	visibleWidth: fallbackVisibleWidth,
	workedForeground: () => "\x1b[38;2;140;140;140m",
	defaultForeground: () => "\x1b[39m",
	reset: () => "\x1b[0m",
	sanitizeRenderedLines: (lines) => lines,
	normalizeLeadingCheck: (line) => line,
};
/** Wires the host's Markdown class and width functions in. Call once at load time. */
export function configureMessageComponents(next: MessageComponentRuntime): void { runtime = next; }

function chromeKey(settings: MessageChromeSettings, kind: "assistant" | "thinking"): string {
	return [settings.messageStyle, settings.messageSpacing, kind === "assistant" ? settings.assistantPrefix : settings.thinkingPrefix].join(":");
}
function stripAnsi(text: string): string { return text.replace(/\x1b\[[0-9;]*m/g, ""); }
function renderClassic(lines: string[], prefix: string, normalizeChecks = true): string[] {
	let placed = false;
	return lines.map((line) => {
		const display = normalizeChecks ? runtime.normalizeLeadingCheck(line) : line;
		if (!placed && stripAnsi(display).trim()) { placed = true; return ` ${prefix} ${display}`; }
		return `   ${display}`;
	});
}
function colorFirstPrefix(lines: string[], glyph: string, colored: string): string[] {
	const plain = ` ${glyph} `;
	const replacement = ` ${colored} `;
	let replaced = false;
	return lines.map((line) => {
		if (!replaced && line.startsWith(plain)) { replaced = true; return `${replacement}${line.slice(plain.length)}`; }
		return line;
	});
}

export class DottedParagraph {
	private md: MarkdownLike;
	private claudeMd: MarkdownLike;
	private claudeAccentMd: MarkdownLike;
	private cachedWidth?: number;
	private cachedKey?: string;
	private cachedLines?: string[];
	constructor(text: string, markdownTheme: any) {
		this.md = new runtime.Markdown(text, 0, 0, markdownTheme);
		const defaultFg = (value: string) => `${runtime.defaultForeground()}${value}${runtime.defaultForeground()}`;
		const claudeTheme: any = {
			...markdownTheme,
			heading: defaultFg,
			listBullet: defaultFg,
			code: (value: string) => `${CLAUDE_PALETTE.inlineCode}${value}${runtime.defaultForeground()}`,
			link: (value: string) => `${CLAUDE_PALETTE.link}${value}${runtime.defaultForeground()}`,
			codeBlockIndent: "",
			codeBlockBorder: () => "",
			hr: () => "---",
			quoteBorder: () => "▎ ",
		};
		this.claudeMd = new runtime.Markdown(text, 0, 0, claudeTheme);
		this.claudeAccentMd = new runtime.Markdown(text, 0, 0, { ...claudeTheme, listBullet: markdownTheme.listBullet, code: markdownTheme.code });
	}
	invalidate(): void { this.cachedWidth = undefined; this.cachedKey = undefined; this.cachedLines = undefined; this.md.invalidate(); this.claudeMd.invalidate(); this.claudeAccentMd.invalidate(); }
	render(width: number): string[] {
		const settings = resolveMessageChromeSettings(readSettings().values);
		const presentation = readSettings().values;
		const markdownStyle = resolveMarkdownStyle(presentation);
		const markdownColors = resolveColorSource(presentation);
		const explicitAccent = presentation.accentColor !== undefined;
		const key = `${chromeKey(settings, "assistant")}:${markdownStyle}:${markdownColors}:${String(presentation.accentColor)}`;
		if (this.cachedLines && this.cachedWidth === width && this.cachedKey === key) return this.cachedLines;
		const classic = settings.messageStyle === "classic";
		const glyph = classic ? "●" : settings.assistantPrefix;
		const prefix = classic ? ` ${glyph} ` : `${glyph} `;
		const prefixWidth = Math.max(1, runtime.visibleWidth(prefix));
		if (width <= prefixWidth) return this.cachedLines = [prefix];
		const markdown = markdownColors === "claude" ? explicitAccent ? this.claudeAccentMd : this.claudeMd : this.md;
		const lines = runtime.sanitizeRenderedLines(markdown.render(width - prefixWidth), markdownStyle);
		const taskStatus = lines.some((line) => /\b(?:transcript:|No output\.|Wrapped up)/.test(stripAnsi(line)));
		const rendered = classic ? renderClassic(lines, "●", taskStatus) : formatTranscriptLines(lines, { prefix: settings.assistantPrefix, spacing: settings.messageSpacing, normalizeChecks: taskStatus, visibleWidth: runtime.visibleWidth, dedentWorkedLine: true });
		this.cachedWidth = width; this.cachedKey = key; this.cachedLines = rendered; return rendered;
	}
}

export class ThinkingParagraph {
	private claudeMd: MarkdownLike;
	private piMd: MarkdownLike;
	private cachedWidth?: number;
	private cachedKey?: string;
	private cachedLines?: string[];
	constructor(text: string, markdownTheme: any, defaultTextStyle?: any) {
		const italic = "\x1b[3m";
		const wrap = (value: string) => `${runtime.workedForeground()}${italic}${value}`;
		const plainTheme: any = {
			heading: wrap, link: wrap, linkUrl: wrap, code: wrap, codeBlock: wrap, codeBlockIndent: "", codeBlockBorder: () => "",
			quote: wrap, quoteBorder: () => `${runtime.workedForeground()}${italic}▎ `, hr: () => `${runtime.workedForeground()}${italic}---`,
			listBullet: wrap, bold: wrap, italic: wrap, strikethrough: wrap, underline: wrap,
			highlightCode: (code: string) => code.split("\n").map((line) => `${runtime.workedForeground()}${italic}${line}`),
		};
		this.claudeMd = new runtime.Markdown(text, 0, 0, plainTheme, { italic: true, color: wrap });
		this.piMd = new runtime.Markdown(text, 0, 0, markdownTheme, defaultTextStyle);
	}
	invalidate(): void { this.cachedWidth = undefined; this.cachedKey = undefined; this.cachedLines = undefined; this.claudeMd.invalidate(); this.piMd.invalidate(); }
	render(width: number): string[] {
		const settings = resolveMessageChromeSettings(readSettings().values);
		const markdownStyle = resolveMarkdownStyle(readSettings().values);
		const key = `${chromeKey(settings, "thinking")}:${markdownStyle}`;
		if (this.cachedLines && this.cachedWidth === width && this.cachedKey === key) return this.cachedLines;
		const classic = settings.messageStyle === "classic";
		const glyph = classic ? "✻" : settings.thinkingPrefix;
		const colored = `${runtime.workedForeground()}${glyph}${runtime.reset()}`;
		const prefixWidth = Math.max(1, runtime.visibleWidth(classic ? ` ${glyph} ` : `${glyph} `));
		if (width <= prefixWidth) return this.cachedLines = [classic ? ` ${colored} ` : `${colored} `];
		const markdown = markdownStyle === "pi" ? this.piMd : this.claudeMd;
		const lines = runtime.sanitizeRenderedLines(markdown.render(width - prefixWidth), markdownStyle);
		const rendered = classic ? renderClassic(lines, colored, false) : colorFirstPrefix(formatTranscriptLines(lines, { prefix: glyph, spacing: settings.messageSpacing, normalizeChecks: false, visibleWidth: runtime.visibleWidth }), glyph, colored);
		this.cachedWidth = width; this.cachedKey = key; this.cachedLines = rendered; return rendered;
	}
}
