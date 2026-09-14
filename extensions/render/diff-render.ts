import * as Diff from "diff";

import type { DiffLine, ParsedDiff } from "../domain/diff-model.ts";
import {
	BG_ADD,
	BG_ADD_W,
	BG_BASE,
	BG_DEL,
	BG_DEL_W,
	BG_EMPTY,
	BG_GUTTER_ADD,
	BG_GUTTER_DEL,
	CC_FG_DIFF_TEXT,
	claudeDiffPaletteEnabled,
	D_BOLD,
	D_DIM,
	D_RST,
	DEFAULT_DIFF_COLORS,
	DEFAULT_TERM_WIDTH,
	type DiffColors,
	DIVIDER,
	FG_ADD,
	FG_DEL,
	FG_DIM,
	FG_LNUM,
	FG_RULE,
	FG_STRIPE,
	MAX_PREVIEW_LINES,
	MAX_RENDER_LINES,
	MAX_TERM_WIDTH,
	MAX_WRAP_ROWS_MED,
	MAX_WRAP_ROWS_NARROW,
	MAX_WRAP_ROWS_WIDE,
	SPLIT_MAX_WRAP_LINES,
	SPLIT_MAX_WRAP_RATIO,
	SPLIT_MIN_CODE_WIDTH,
	SPLIT_MIN_WIDTH,
	WORD_DIFF_MIN_SIM,
} from "../domain/diff-palette.ts";
import { sanitizeToolContent } from "../terminal-sanitize.ts";
import { hlBlock, MAX_HL_CHARS, type BundledLanguage } from "./diff-syntax.ts";

// ---------------------------------------------------------------------------
// ANSI-aware unified/split diff rendering, width helpers, and diff summary
// helpers — the presentation half of the diff subsystem. Palette state lives
// in ../domain/diff-palette.ts; Shiki highlighting lives in ./diff-syntax.ts.
//
// This render/ module must not import Pi host packages directly (enforced by
// scripts/test-architecture-boundaries.ts), but grapheme-aware terminal width
// (`visibleWidth`/`truncateToWidth`) comes from @earendil-works/pi-tui. index.ts
// calls `configureDiffWidthOps()` once at module load with the real
// implementations; the fallback below is only a defensive default.
// ---------------------------------------------------------------------------

export interface DiffWidthOps {
	visibleWidth(text: string): number;
	truncateToWidth(text: string, width: number, ellipsis?: string): string;
}

let widthOps: DiffWidthOps = {
	visibleWidth: (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").length,
	truncateToWidth: (text: string, width: number) => text.slice(0, Math.max(0, width)),
};

/** Wires the host's grapheme-aware width functions in. Call once at load time. */
export function configureDiffWidthOps(ops: DiffWidthOps): void {
	widthOps = ops;
}

function tabs(text: string): string {
	return text.replace(/\t/g, "  ");
}

export function termW(): number {
	const raw =
		process.stdout.columns ||
		(process.stderr as any).columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		DEFAULT_TERM_WIDTH;
	return Math.max(40, Math.min(raw - 4, MAX_TERM_WIDTH));
}

export function branchDiffWidth(): number {
	return Math.max(40, termW() - 8);
}

function adaptiveWrapRows(tw?: number): number {
	const width = tw ?? termW();
	if (width >= 180) return MAX_WRAP_ROWS_WIDE;
	if (width >= 120) return MAX_WRAP_ROWS_MED;
	return MAX_WRAP_ROWS_NARROW;
}

interface AnsiCell {
	text: string;
	width: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** ANSI escapes are zero-width cells; visible text advances by grapheme cluster. */
function ansiCells(text: string): AnsiCell[] {
	const cells: AnsiCell[] = [];
	let index = 0;
	let plainStart = 0;
	const flushPlain = (end: number) => {
		if (end <= plainStart) return;
		for (const { segment } of graphemeSegmenter.segment(text.slice(plainStart, end))) {
			cells.push({ text: segment, width: widthOps.visibleWidth(segment) });
		}
	};
	while (index < text.length) {
		if (text[index] === "\x1b") {
			const end = text.indexOf("m", index);
			if (end !== -1) {
				flushPlain(index);
				cells.push({ text: text.slice(index, end + 1), width: 0 });
				index = end + 1;
				plainStart = index;
				continue;
			}
		}
		index++;
	}
	flushPlain(text.length);
	return cells;
}

function fit(value: string, width: number): string {
	if (width <= 0) return "";
	const valueWidth = widthOps.visibleWidth(value);
	if (valueWidth <= width) return value + " ".repeat(width - valueWidth);
	const showWidth = width > 2 ? width - 1 : width;
	let used = 0;
	let out = "";
	for (const cell of ansiCells(value)) {
		if (cell.width > 0 && used + cell.width > showWidth) break;
		out += cell.text;
		used += cell.width;
	}
	return width > 2 ? `${out}${D_RST}${FG_DIM}›${D_RST}` : `${out}${D_RST}`;
}

function ansiState(text: string): string {
	const matches = text.match(/\x1b\[[0-9;]*m/g) ?? [];
	let fg = "";
	let bg = "";
	let bold = false;
	let dim = false;
	let italic = false;
	for (const seq of matches) {
		const params = seq.slice(2, -1);
		if (params === "0") {
			fg = "";
			bg = "";
			bold = false;
			dim = false;
			italic = false;
		} else if (params === "39") fg = "";
		else if (params === "49") bg = "";
		else if (params === "1") bold = true;
		else if (params === "2") dim = true;
		else if (params === "22") { bold = false; dim = false; }
		else if (params === "3") italic = true;
		else if (params === "23") italic = false;
		else if (params.startsWith("38;")) fg = seq;
		else if (params.startsWith("48;")) bg = seq;
	}
	return bg + fg + (bold ? D_BOLD : "") + (dim ? D_DIM : "") + (italic ? "\x1b[3m" : "");
}

function wrapAnsi(text: string, width: number, maxRows = adaptiveWrapRows(), fillBg = ""): string[] {
	if (width <= 0) return [""];
	const cells = ansiCells(text);
	const totalWidth = cells.reduce((sum, cell) => sum + cell.width, 0);
	if (totalWidth <= width) {
		const pad = width - totalWidth;
		return pad > 0 ? [text + fillBg + " ".repeat(pad) + (fillBg ? D_RST : "")] : [text];
	}

	const rows: string[] = [];
	let row = "";
	let used = 0;
	let cellIndex = 0;
	let onLastRow = false;
	let effectiveWidth = width;
	while (cellIndex < cells.length) {
		if (!onLastRow && rows.length >= maxRows - 1) {
			onLastRow = true;
			effectiveWidth = width > 2 ? width - 1 : width;
		}
		const cell = cells[cellIndex];
		if (cell.width === 0) {
			row += cell.text;
			cellIndex++;
			continue;
		}
		if (used + cell.width > effectiveWidth && used > 0) {
			if (onLastRow) {
				const hasMore = cells.slice(cellIndex).some((remaining) => remaining.width > 0);
				if (hasMore && width > 2) row += `${D_RST}${FG_DIM}›${D_RST}`;
				else row += fillBg + " ".repeat(Math.max(0, width - used)) + D_RST;
				rows.push(row);
				return rows;
			}
			const state = ansiState(row);
			rows.push(row + fillBg + " ".repeat(Math.max(0, width - used)) + D_RST);
			row = state + fillBg;
			used = 0;
			if (rows.length >= maxRows - 1) {
				onLastRow = true;
				effectiveWidth = width > 2 ? width - 1 : width;
			}
			continue;
		}
		row += cell.text;
		used += cell.width;
		cellIndex++;
	}
	if (row.length > 0 || rows.length === 0) {
		rows.push(row + fillBg + " ".repeat(Math.max(0, width - used)) + D_RST);
	}
	return rows;
}

function lnum(n: number | null, width: number, fg = FG_LNUM): string {
	if (n === null) return " ".repeat(width);
	const value = String(n);
	return `${fg}${" ".repeat(Math.max(0, width - value.length))}${value}${D_RST}`;
}

/** Right-aligned line number with no color of its own — the row's fg carries. */
function lnumPlain(n: number | null, width: number): string {
	if (n === null) return " ".repeat(width);
	const value = String(n);
	return `${" ".repeat(Math.max(0, width - value.length))}${value}`;
}

/** Extend a row's background to the full width, as Claude Code does. */
function padRowToWidth(row: string, width: number, bg: string): string {
	const padding = Math.max(0, width - widthOps.visibleWidth(row));
	return `${row}${bg}${" ".repeat(padding)}${D_RST}`;
}

function stripes(width: number): string {
	return BG_BASE + FG_STRIPE + "╱".repeat(width) + D_RST;
}

export function renderDiffStatBar(added: number, removed: number, width = termW()): string {
	const total = added + removed;
	if (total === 0 || width < 20) return "";
	const slots = Math.max(8, Math.min(20, Math.floor(width / 14)));
	let addSlots = Math.max(0, Math.min(slots, Math.round((added / total) * slots)));
	if (added > 0 && addSlots === 0) addSlots = 1;
	if (removed > 0 && addSlots >= slots) addSlots = slots - 1;
	const removeSlots = Math.max(0, slots - addSlots);
	const addBar = addSlots > 0 ? `${FG_ADD}${"━".repeat(addSlots)}${D_RST}` : "";
	const removeBar = removeSlots > 0 ? `${FG_DEL}${"━".repeat(removeSlots)}${D_RST}` : "";
	return `${FG_DIM}[${D_RST}${addBar}${removeBar}${FG_DIM}]${D_RST}`;
}

export function summarizeDiff(added: number, removed: number): string {
	const parts: string[] = [];
	if (added > 0) parts.push(`${FG_ADD}+${added}${D_RST}`);
	if (removed > 0) parts.push(`${FG_DEL}-${removed}${D_RST}`);
	if (!parts.length) return `${FG_DIM}no changes${D_RST}`;
	const bar = renderDiffStatBar(added, removed);
	return bar ? `${parts.join(" ")} ${bar}` : parts.join(" ");
}

export function diffSummaryWithMeta(added: number, removed: number, hunks: number, mode: string): string {
	const base = summarizeDiff(added, removed);
	const extras: string[] = [];
	if (hunks > 0) extras.push(`${FG_DIM}${hunks} hunk${hunks === 1 ? "" : "s"}${D_RST}`);
	if (mode) extras.push(`${FG_DIM}${mode}${D_RST}`);
	return extras.length ? `${base} ${FG_DIM}•${D_RST} ${extras.join(` ${FG_DIM}•${D_RST} `)}` : base;
}

export function collapsedDiffHint(remainingLines: number, hiddenHunks: number): string {
	const width = termW();
	const candidates = [
		`… +${remainingLines} lines${hiddenHunks > 0 ? ` · ${hiddenHunks} more hunks` : ""} (ctrl+o to expand)`,
		`… +${remainingLines} lines${hiddenHunks > 0 ? ` · ${hiddenHunks} hunks` : ""}`,
		`… +${remainingLines}${hiddenHunks > 0 ? ` · +${hiddenHunks}h` : ""}`,
		"…",
	];
	for (const candidate of candidates) {
		if (widthOps.visibleWidth(candidate) <= width) return candidate;
	}
	return widthOps.truncateToWidth("…", width, "");
}

function diffRule(width: number): string {
	return `${BG_BASE}${FG_RULE}${"─".repeat(width)}${D_RST}`;
}

function shouldUseSplit(diff: ParsedDiff, tw: number, maxRows = MAX_PREVIEW_LINES): boolean {
	if (!diff.lines.length) return false;
	// Claude Code always renders a unified hunk — it has no split view.
	if (claudeDiffPaletteEnabled()) return false;
	if (tw < SPLIT_MIN_WIDTH) return false;
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const half = Math.floor((tw - 1) / 2);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);
	if (cw < SPLIT_MIN_CODE_WIDTH) return false;
	const vis = diff.lines.slice(0, maxRows);
	let contentLines = 0;
	let wrapCandidates = 0;
	for (const line of vis) {
		if (line.type === "sep") continue;
		contentLines++;
		if (tabs(line.content).length > cw) wrapCandidates++;
	}
	if (contentLines === 0) return true;
	const wrapRatio = wrapCandidates / contentLines;
	if (wrapCandidates >= SPLIT_MAX_WRAP_LINES) return false;
	if (wrapRatio >= SPLIT_MAX_WRAP_RATIO) return false;
	return true;
}

function wordDiffAnalysis(
	oldText: string,
	newText: string,
): { similarity: number; oldRanges: Array<[number, number]>; newRanges: Array<[number, number]> } {
	if (!oldText && !newText) return { similarity: 1, oldRanges: [], newRanges: [] };
	const parts = Diff.diffWords(oldText, newText);
	const oldRanges: Array<[number, number]> = [];
	const newRanges: Array<[number, number]> = [];
	let oldPos = 0;
	let newPos = 0;
	let same = 0;
	for (const part of parts) {
		if (part.removed) {
			oldRanges.push([oldPos, oldPos + part.value.length]);
			oldPos += part.value.length;
		} else if (part.added) {
			newRanges.push([newPos, newPos + part.value.length]);
			newPos += part.value.length;
		} else {
			const len = part.value.length;
			same += len;
			oldPos += len;
			newPos += len;
		}
	}
	const maxLen = Math.max(oldText.length, newText.length);
	return { similarity: maxLen > 0 ? same / maxLen : 1, oldRanges, newRanges };
}

function injectBg(ansiLine: string, ranges: Array<[number, number]>, baseBg: string, hlBg: string): string {
	if (!ranges.length) return baseBg + ansiLine + D_RST;
	let out = baseBg;
	let vis = 0;
	let inHL = false;
	let rangeIndex = 0;
	let i = 0;
	while (i < ansiLine.length) {
		if (ansiLine[i] === "\x1b") {
			const end = ansiLine.indexOf("m", i);
			if (end !== -1) {
				const seq = ansiLine.slice(i, end + 1);
				out += seq;
				if (seq === "\x1b[0m") out += inHL ? hlBg : baseBg;
				i = end + 1;
				continue;
			}
		}
		while (rangeIndex < ranges.length && vis >= ranges[rangeIndex][1]) rangeIndex++;
		const want = rangeIndex < ranges.length && vis >= ranges[rangeIndex][0] && vis < ranges[rangeIndex][1];
		if (want !== inHL) {
			inHL = want;
			out += inHL ? hlBg : baseBg;
		}
		out += ansiLine[i];
		vis++;
		i++;
	}
	return out + D_RST;
}

function plainWordDiff(oldText: string, newText: string): { old: string; new: string } {
	const parts = Diff.diffWords(oldText, newText);
	let oldOut = "";
	let newOut = "";
	for (const part of parts) {
		if (part.removed) oldOut += `${BG_DEL_W}${part.value}${D_RST}${BG_DEL}`;
		else if (part.added) newOut += `${BG_ADD_W}${part.value}${D_RST}${BG_ADD}`;
		else {
			oldOut += part.value;
			newOut += part.value;
		}
	}
	return { old: oldOut, new: newOut };
}

/**
 * A write renders as a plain numbered listing in Claude Code — dim line numbers,
 * syntax-highlighted content, no sign column and no added-line background:
 *
 *   ⎿  Wrote 3 lines to ../../../../tmp/ccdiff.ts
 *       1 const a = 1;
 *       2 const b = 2;
 */
export async function renderFileListing(
	content: string,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	width = termW(),
): Promise<string> {
	const all = content.split("\n").map(sanitizeToolContent);
	if (all.length > 0 && all[all.length - 1] === "") all.pop();
	if (all.length === 0) return "";
	const vis = all.slice(0, max);
	const nw = Math.max(1, String(vis.length).length);
	const cw = Math.max(20, width - (nw + 2));
	const visibleSource = vis.join("\n");
	const canHL = visibleSource.length <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;
	const highlighted = canHL ? await hlBlock(visibleSource, language) : vis;

	const out: string[] = [];
	for (let i = 0; i < vis.length; i++) {
		const gutter = `${D_DIM} ${lnumPlain(i + 1, nw)} ${D_RST}`;
		const rows = wrapAnsi(tabs(highlighted[i] ?? vis[i]), cw, adaptiveWrapRows(), "");
		out.push(`${gutter}${rows[0]}${D_RST}`);
		for (let r = 1; r < rows.length; r++) out.push(`${" ".repeat(nw + 2)}${rows[r]}${D_RST}`);
	}
	if (all.length > vis.length) {
		out.push(`${FG_DIM}${" ".repeat(nw + 2)}${collapsedDiffHint(all.length - vis.length, 0)}${D_RST}`);
	}
	return out.join("\n");
}

export async function renderUnified(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
	width = termW(),
): Promise<string> {
	if (!diff.lines.length) return "";
	const vis = diff.lines.slice(0, max).map((line) => line.type === "sep" ? line : { ...line, content: sanitizeToolContent(line.content) });
	const tw = width;
	// Claude Code sizes the number column to the widest line number, minimum one.
	const nw = claudeDiffPaletteEnabled()
		? Math.max(1, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length)
		: Math.max(2, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	// Claude gutter is " N " plus the sign column; the legacy one adds a border and divider.
	const gw = claudeDiffPaletteEnabled() ? nw + 3 : nw + 5;
	const cw = Math.max(20, tw - gw);

	const oldSrc: string[] = [];
	const newSrc: string[] = [];
	for (const line of vis) {
		if (line.type === "ctx" || line.type === "del") oldSrc.push(line.content);
		if (line.type === "ctx" || line.type === "add") newSrc.push(line.content);
	}
	// Shiki receives only these visible hunk strings. Budgeting the entire source
	// file made small edits in large files silently lose syntax highlighting.
	const highlightChars = oldSrc.join("\n").length + newSrc.join("\n").length;
	const canHL = highlightChars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;
	const [oldHL, newHL] = canHL
		? await Promise.all([hlBlock(oldSrc.join("\n"), language), hlBlock(newSrc.join("\n"), language)])
		: [oldSrc, newSrc];

	let oldIndex = 0;
	let newIndex = 0;
	let index = 0;
	const claude = claudeDiffPaletteEnabled();
	const out: string[] = claude ? [] : [diffRule(tw)];

	// Claude Code's row: " N " gutter, sign column, content — the line background
	// runs across all three to the full width. No border bar, no divider, no rules.
	function emitClaudeRow(num: number | null, sign: string, bg: string, signFg: string, body: string): void {
		const gutterFg = sign === " " ? `${D_DIM}` : signFg;
		const gutter = `${bg}${gutterFg} ${lnumPlain(num, nw)} ${sign}${D_RST}${bg}`;
		const rows = wrapAnsi(tabs(body), cw, adaptiveWrapRows(), bg);
		const contGutter = `${bg}${" ".repeat(nw + 3)}`;
		out.push(padRowToWidth(`${gutter}${rows[0]}`, tw, bg));
		for (let r = 1; r < rows.length; r++) out.push(padRowToWidth(`${contGutter}${rows[r]}`, tw, bg));
	}

	function emitRow(num: number | null, sign: string, gutterBg: string, signFg: string, body: string, bodyBg = ""): void {
		if (claude) {
			emitClaudeRow(num, sign, bodyBg || BG_BASE, signFg, body);
			return;
		}
		const borderFg = sign === "-" ? dc.fgDel : sign === "+" ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}▌${D_RST}` : `${BG_BASE} `;
		const numFg = borderFg || FG_LNUM;
		const gutter = `${border}${gutterBg}${lnum(num, nw, numFg)}${signFg}${sign}${D_RST} ${DIVIDER} `;
		const cont = `${border}${gutterBg}${" ".repeat(nw + 1)}${D_RST} ${DIVIDER} `;
		const rows = wrapAnsi(tabs(body), cw, adaptiveWrapRows(), bodyBg);
		out.push(`${gutter}${rows[0]}${D_RST}`);
		for (let r = 1; r < rows.length; r++) out.push(`${cont}${rows[r]}${D_RST}`);
	}

	while (index < vis.length) {
		const line = vis[index];
		if (line.type === "sep") {
			const gap = line.newNum;
			if (claude) {
				const label = gap && gap > 0 ? `… +${gap} unmodified lines` : "…";
				out.push(`${BG_BASE}${FG_DIM}${" ".repeat(nw + 3)}${label}${D_RST}`);
				index++;
				continue;
			}
			const label = gap && gap > 0 ? ` ${gap} unmodified lines ` : "···";
			const totalW = Math.min(tw, 72);
			const pad = Math.max(0, totalW - label.length - 2);
			const half1 = Math.floor(pad / 2);
			const half2 = pad - half1;
			out.push(`${BG_BASE}${FG_DIM}${"─".repeat(half1)}${label}${"─".repeat(half2)}${D_RST}`);
			index++;
			continue;
		}
		if (line.type === "ctx") {
			const hl = oldHL[oldIndex] ?? line.content;
			// Claude Code dims only the line number on context rows, not the code.
			emitRow(line.newNum, " ", BG_BASE, dc.fgCtx, claude ? `${BG_BASE}${CC_FG_DIFF_TEXT}${hl}\x1b[39m` : `${BG_BASE}${D_DIM}${hl}`, BG_BASE);
			oldIndex++;
			newIndex++;
			index++;
			continue;
		}

		// Claude Code does not syntax-highlight removed lines — they render in the
		// plain foreground, and only additions and context keep their tokens.
		const dels: Array<{ l: DiffLine; hl: string }> = [];
		while (index < vis.length && vis[index].type === "del") {
			const plain = vis[index].content;
			dels.push({ l: vis[index], hl: claude ? `${CC_FG_DIFF_TEXT}${plain}\x1b[39m` : (oldHL[oldIndex] ?? plain) });
			oldIndex++;
			index++;
		}
		const adds: Array<{ l: DiffLine; hl: string }> = [];
		while (index < vis.length && vis[index].type === "add") {
			const highlighted = newHL[newIndex] ?? vis[index].content;
			adds.push({ l: vis[index], hl: claude ? `${CC_FG_DIFF_TEXT}${highlighted}\x1b[39m` : highlighted });
			newIndex++;
			index++;
		}

		// Claude Code word-diffs every aligned removal/addition pair in a hunk, not
		// just lone one-for-one swaps — so emphasis survives multi-line edits. Rows
		// still emit as all-removals-then-all-additions.
		const pairable = dels.length > 0 && dels.length === adds.length;
		const pairs = pairable
			? dels.map((d, i) => ({ d, a: adds[i], wd: wordDiffAnalysis(d.l.content, adds[i].l.content) }))
			: [];
		const emphasized = pairable && pairs.every((p) => p.wd && p.wd.similarity >= WORD_DIFF_MIN_SIM);

		const delMarker = claude ? dc.fgDel : `${dc.fgDel}${D_BOLD}`;
		const addMarker = claude ? dc.fgAdd : `${dc.fgAdd}${D_BOLD}`;
		if (emphasized && canHL) {
			for (const { d, wd } of pairs) {
				// Fresh Claude capture keeps deletions on one uniform red background.
				emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, delMarker, injectBg(d.hl, claude ? [] : wd!.oldRanges, BG_DEL, BG_DEL_W), BG_DEL);
			}
			for (const { a, wd } of pairs) {
				emitRow(a.l.newNum, "+", BG_GUTTER_ADD, addMarker, injectBg(a.hl, wd!.newRanges, BG_ADD, BG_ADD_W), BG_ADD);
			}
			continue;
		}
		if (emphasized && !canHL) {
			const plainPairs = pairs.map(({ d, a }) => ({ d, a, pwd: plainWordDiff(d.l.content, a.l.content) }));
			for (const { d, pwd } of plainPairs) {
				emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, delMarker, `${BG_DEL}${claude ? d.hl : pwd.old}`, BG_DEL);
			}
			for (const { a, pwd } of plainPairs) {
				emitRow(a.l.newNum, "+", BG_GUTTER_ADD, addMarker, `${BG_ADD}${pwd.new}`, BG_ADD);
			}
			continue;
		}
		for (const d of dels) emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, delMarker, `${BG_DEL}${canHL ? d.hl : d.l.content}`, BG_DEL);
		for (const a of adds) emitRow(a.l.newNum, "+", BG_GUTTER_ADD, addMarker, `${BG_ADD}${canHL ? a.hl : a.l.content}`, BG_ADD);
	}

	if (!claude) out.push(diffRule(tw));
	if (diff.lines.length > vis.length) out.push(`${BG_BASE}${FG_DIM}  ${collapsedDiffHint(diff.lines.length - vis.length, 0)}${D_RST}`);
	return out.join("\n");
}

export async function renderSplit(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_PREVIEW_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
	width = termW(),
): Promise<string> {
	diff = {
		...diff,
		lines: diff.lines.map((line) => line.type === "sep" ? line : { ...line, content: sanitizeToolContent(line.content) }),
	};
	const tw = width;
	if (!shouldUseSplit(diff, tw, max)) return renderUnified(diff, language, max, dc, width);
	if (!diff.lines.length) return "";

	type Row = { left: DiffLine | null; right: DiffLine | null };
	const rows: Row[] = [];
	let i = 0;
	while (i < diff.lines.length) {
		const line = diff.lines[i];
		if (line.type === "sep" || line.type === "ctx") {
			rows.push({ left: line, right: line });
			i++;
			continue;
		}
		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];
		while (i < diff.lines.length && diff.lines[i].type === "del") dels.push(diff.lines[i++]);
		while (i < diff.lines.length && diff.lines[i].type === "add") adds.push(diff.lines[i++]);
		const n = Math.max(dels.length, adds.length);
		for (let j = 0; j < n; j++) rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
	}

	const vis = rows.slice(0, max);
	const half = Math.floor((tw - 1) / 2);
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);

	const leftSrc: string[] = [];
	const rightSrc: string[] = [];
	for (const row of vis) {
		if (row.left && row.left.type !== "sep") leftSrc.push(row.left.content);
		if (row.right && row.right.type !== "sep") rightSrc.push(row.right.content);
	}
	const highlightChars = leftSrc.join("\n").length + rightSrc.join("\n").length;
	const canHL = highlightChars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;
	const [leftHL, rightHL] = canHL
		? await Promise.all([hlBlock(leftSrc.join("\n"), language), hlBlock(rightSrc.join("\n"), language)])
		: [leftSrc, rightSrc];

	let leftIndex = 0;
	let rightIndex = 0;

	type HalfResult = { gutter: string; contGutter: string; bodyRows: string[] };
	function halfBuild(
		line: DiffLine | null,
		hl: string,
		ranges: Array<[number, number]> | null,
		side: "left" | "right",
	): HalfResult {
		if (!line) {
			const gPat = FG_STRIPE + "╱".repeat(nw + 2) + D_RST;
			const gutter = ` ${gPat}${FG_RULE}│${D_RST} `;
			return { gutter, contGutter: gutter, bodyRows: [stripes(cw)] };
		}
		if (line.type === "sep") {
			const gap = line.newNum;
			const label = gap && gap > 0 ? `··· ${gap} lines ···` : "···";
			const gutter = `${BG_BASE} ${FG_DIM}${fit("", nw + 2)}${D_RST}${FG_RULE}│${D_RST} `;
			return { gutter, contGutter: gutter, bodyRows: [`${BG_BASE}${FG_DIM}${fit(label, cw)}${D_RST}`] };
		}
		const isDel = line.type === "del";
		const isAdd = line.type === "add";
		const gBg = isDel ? BG_GUTTER_DEL : isAdd ? BG_GUTTER_ADD : BG_BASE;
		const cBg = isDel ? BG_DEL : isAdd ? BG_ADD : BG_BASE;
		const sFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : dc.fgCtx;
		const sign = isDel ? "-" : isAdd ? "+" : " ";
		const num = isDel ? line.oldNum : isAdd ? line.newNum : side === "left" ? line.oldNum : line.newNum;
		const borderFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}▌${D_RST}` : ` ${BG_BASE}`;
		const numFg = borderFg || FG_LNUM;
		let body: string;
		if (ranges && ranges.length > 0) body = injectBg(hl, ranges, cBg, isDel ? BG_DEL_W : BG_ADD_W);
		else if (isDel || isAdd) body = `${cBg}${hl}`;
		else body = `${BG_BASE}${D_DIM}${hl}`;
		const gutter = `${border}${gBg}${lnum(num, nw, numFg)}${sFg}${D_BOLD}${sign}${D_RST} ${FG_RULE}│${D_RST} `;
		const contGutter = `${border}${gBg}${" ".repeat(nw + 1)}${D_RST} ${FG_RULE}│${D_RST} `;
		return { gutter, contGutter, bodyRows: wrapAnsi(tabs(body), cw, adaptiveWrapRows(), cBg) };
	}

	const out: string[] = [];
	const hdrOld = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgDel}${D_DIM}old${D_RST}`;
	const hdrNew = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgAdd}${D_DIM}new${D_RST}`;
	out.push(`${BG_BASE}${hdrOld}${" ".repeat(Math.max(0, half - nw - 1))}${FG_RULE}┊${D_RST}${hdrNew}`);
	out.push(`${diffRule(half)}${FG_RULE}┊${D_RST}${diffRule(half)}`);

	for (const row of vis) {
		const leftLine = row.left;
		const rightLine = row.right;
		const paired = Boolean(leftLine && rightLine && leftLine.type === "del" && rightLine.type === "add");
		const wd = paired && leftLine && rightLine ? wordDiffAnalysis(leftLine.content, rightLine.content) : null;
		let leftResult: HalfResult;
		let rightResult: HalfResult;
		if (paired && wd && leftLine && rightLine && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			leftResult = halfBuild(leftLine, leftHL[leftIndex++] ?? leftLine.content, wd.oldRanges, "left");
			rightResult = halfBuild(rightLine, rightHL[rightIndex++] ?? rightLine.content, wd.newRanges, "right");
		} else if (paired && wd && leftLine && rightLine && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(leftLine.content, rightLine.content);
			leftIndex++;
			rightIndex++;
			leftResult = halfBuild(leftLine, pwd.old, null, "left");
			rightResult = halfBuild(rightLine, pwd.new, null, "right");
		} else {
			leftResult = halfBuild(
				row.left,
				row.left && row.left.type !== "sep" ? (leftHL[leftIndex++] ?? row.left.content) : "",
				null,
				"left",
			);
			rightResult = halfBuild(
				row.right,
				row.right && row.right.type !== "sep" ? (rightHL[rightIndex++] ?? row.right.content) : "",
				null,
				"right",
			);
		}
		const maxRows = Math.max(leftResult.bodyRows.length, rightResult.bodyRows.length);
		for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
			const lg = rowIndex === 0 ? leftResult.gutter : leftResult.contGutter;
			const rg = rowIndex === 0 ? rightResult.gutter : rightResult.contGutter;
			const lb = leftResult.bodyRows[rowIndex] ?? (!row.left ? stripes(cw) : `${BG_EMPTY}${" ".repeat(cw)}${D_RST}`);
			const rb = rightResult.bodyRows[rowIndex] ?? (!row.right ? stripes(cw) : `${BG_EMPTY}${" ".repeat(cw)}${D_RST}`);
			out.push(`${lg}${lb}${DIVIDER}${rg}${rb}`);
		}
	}

	out.push(`${diffRule(half)}${FG_RULE}┊${D_RST}${diffRule(half)}`);
	if (rows.length > vis.length) out.push(`${BG_BASE}${FG_DIM}  ${collapsedDiffHint(rows.length - vis.length, 0)}${D_RST}`);
	return out.join("\n");
}
