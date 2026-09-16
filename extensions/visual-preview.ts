import { visibleWidth, type Component } from "@earendil-works/pi-tui";

import { sanitizeToolOutput } from "./terminal-sanitize.ts";

export type VisualPreviewMode = "head" | "tail";

export interface VisualPreview {
	rows: string[];
	hiddenRows: number;
	hiddenPosition: "earlier" | "later" | null;
}

export interface VisualItemRow<T> {
	item: T;
	text: string;
	continuation: boolean;
}

export interface VisualItemPreview<T> {
	rows: VisualItemRow<T>[];
	hiddenItems: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function safeHeadSlice(text: string, length: number): string {
	let out = text.slice(0, length);
	if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
	return out;
}

function safeTailSlice(text: string, length: number): string {
	let start = Math.max(0, text.length - length);
	if (/[\uDC00-\uDFFF]/.test(text[start] ?? "")) start++;
	return text.slice(start);
}

function wrapPlainLine(line: string, width: number): string[] {
	if (!line) return [""];
	const rows: string[] = [];
	let row = "";
	let used = 0;
	for (const { segment } of segmenter.segment(line)) {
		const segmentWidth = visibleWidth(segment);
		if (used > 0 && used + segmentWidth > width) {
			rows.push(row.replace(/[ \t]+$/, ""));
			row = "";
			used = 0;
		}
		row += segment;
		used += segmentWidth;
	}
	rows.push(row.replace(/[ \t]+$/, ""));
	return rows;
}

/**
 * Bound work before grapheme wrapping. The ×4 slack mirrors Claude's terminal
 * utility and allows for wide characters/control bytes without processing the
 * whole 50 KB output merely to display a handful of rows.
 */
function preWrapCharCap(rows: number, width: number): number {
	return Math.max(1, rows) * Math.max(1, width) * 4;
}

/** Select a head/tail window by rendered terminal rows, not logical lines. */
export function selectVisualPreview(text: string, width: number, rowBudget: number, mode: VisualPreviewMode): VisualPreview {
	const safe = sanitizeToolOutput(text).replace(/\s+$/, "");
	if (!safe) return { rows: [], hiddenRows: 0, hiddenPosition: null };
	const wrapWidth = Math.max(1, Math.floor(width));
	const budget = Math.max(0, Math.floor(rowBudget));
	const cap = preWrapCharCap(Math.max(1, budget), wrapWidth);
	const preTruncated = safe.length > cap;
	const bounded = preTruncated
		? mode === "tail" ? safeTailSlice(safe, cap) : safeHeadSlice(safe, cap)
		: safe;
	const wrapped = bounded.split("\n").flatMap((line) => wrapPlainLine(line, wrapWidth));
	const rows = budget === 0 ? [] : mode === "tail" ? wrapped.slice(-budget) : wrapped.slice(0, budget);
	const exactHidden = Math.max(0, wrapped.length - rows.length);
	const estimatedTotal = preTruncated ? Math.ceil(safe.length / wrapWidth) : wrapped.length;
	const hiddenRows = Math.max(exactHidden, estimatedTotal - rows.length);
	return {
		rows,
		hiddenRows,
		hiddenPosition: hiddenRows === 0 ? null : mode === "tail" ? "earlier" : "later",
	};
}

/**
 * Budget structured items while preserving identity for icons/styles. If an
 * individual item wraps, continuation chunks retain the same item.
 */
export function selectVisualItems<T>(
	items: readonly T[],
	textOf: (item: T) => string,
	width: number,
	rowBudget: number,
): VisualItemPreview<T> {
	const rows: VisualItemRow<T>[] = [];
	const budget = Math.max(0, Math.floor(rowBudget));
	let hiddenItems = 0;
	for (let index = 0; index < items.length; index++) {
		if (rows.length >= budget) {
			hiddenItems += items.length - index;
			break;
		}
		const item = items[index];
		const remaining = budget - rows.length;
		const preview = selectVisualPreview(textOf(item), width, remaining, "head");
		for (let chunk = 0; chunk < preview.rows.length; chunk++) {
			rows.push({ item, text: preview.rows[chunk], continuation: chunk > 0 });
		}
		if (preview.hiddenRows > 0) {
			hiddenItems += 1 + (items.length - index - 1);
			break;
		}
	}
	return { rows, hiddenItems };
}

/** Synchronous width-aware text component for output previews. */
export class WidthAwareTextComponent implements Component {
	private key = "";
	private build: (width: number) => string[] = () => [];
	private revision: () => number = () => 0;
	private readonly cache = new Map<string, string[]>();

	configure(key: string, build: (width: number) => string[], revision?: () => number): void {
		if (key !== this.key) {
			this.key = key;
			this.cache.clear();
		}
		this.build = build;
		if (revision) this.revision = revision;
	}

	render(width: number): string[] {
		const normalized = Math.max(1, Math.floor(width));
		const cacheKey = `${normalized}:${this.revision()}`;
		const cached = this.cache.get(cacheKey);
		if (cached) return cached;
		const lines = this.build(normalized);
		this.cache.set(cacheKey, lines);
		if (this.cache.size > 6) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) this.cache.delete(oldest);
		}
		return lines;
	}

	invalidate(): void {
		this.cache.clear();
	}
}

export function widthAwareText(
	lastComponent: unknown,
	key: string,
	build: (width: number) => string[],
	revision?: () => number,
): WidthAwareTextComponent {
	const component = lastComponent instanceof WidthAwareTextComponent ? lastComponent : new WidthAwareTextComponent();
	component.configure(key, build, revision);
	return component;
}
