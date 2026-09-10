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

function scanWrappedLine(line: string, width: number, visit: (row: string) => void): void {
	if (!line) {
		visit("");
		return;
	}
	let row = "";
	let used = 0;
	for (const { segment } of segmenter.segment(line)) {
		const segmentWidth = visibleWidth(segment);
		if (used > 0 && used + segmentWidth > width) {
			visit(row.replace(/[ \t]+$/, ""));
			row = "";
			used = 0;
		}
		row += segment;
		used += segmentWidth;
	}
	visit(row.replace(/[ \t]+$/, ""));
}

/**
 * Select a head/tail window by rendered terminal rows, not logical lines.
 *
 * Counting must inspect the complete sanitized input: character-count estimates
 * are wrong for blank lines, wide graphemes, and wrapping. Only the requested
 * head rows or a fixed-size tail ring are retained, however, so a large output
 * cannot create an equally large intermediate array of rendered rows.
 */
export function selectVisualPreview(text: string, width: number, rowBudget: number, mode: VisualPreviewMode): VisualPreview {
	const safe = sanitizeToolOutput(text).replace(/\s+$/, "");
	if (!safe) return { rows: [], hiddenRows: 0, hiddenPosition: null };
	const wrapWidth = Math.max(1, Math.floor(width));
	const budget = Math.max(0, Math.floor(rowBudget));
	const retained: string[] = [];
	let tailStart = 0;
	let totalRows = 0;

	const visit = (row: string): void => {
		totalRows++;
		if (budget === 0) return;
		if (mode === "head") {
			if (retained.length < budget) retained.push(row);
			return;
		}
		if (retained.length < budget) {
			retained.push(row);
			return;
		}
		retained[tailStart] = row;
		tailStart = (tailStart + 1) % budget;
	};

	// Scan logical lines by index rather than split/flatMap, which would retain
	// an array proportional to newline-dense output.
	let lineStart = 0;
	while (lineStart <= safe.length) {
		const newline = safe.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? safe.length : newline;
		scanWrappedLine(safe.slice(lineStart, lineEnd), wrapWidth, visit);
		if (newline === -1) break;
		lineStart = newline + 1;
	}

	const rows = mode === "tail" && retained.length === budget && tailStart > 0
		? retained.slice(tailStart).concat(retained.slice(0, tailStart))
		: retained;
	const hiddenRows = totalRows - rows.length;
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
			// The current item is partially visible, not hidden. Count only items
			// for which no row was displayed.
			hiddenItems += items.length - index - 1;
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
