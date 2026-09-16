import * as Diff from "diff";

import { sanitizeToolContent } from "../terminal-sanitize.ts";
import { MAX_WRITE_DIFF_INPUT_BYTES } from "./limits.ts";

export interface DiffLine {
	type: "add" | "del" | "ctx" | "sep";
	oldNum: number | null;
	newNum: number | null;
	content: string;
}

export interface ParsedDiff {
	lines: DiffLine[];
	added: number;
	removed: number;
	chars: number;
}

export function normalizeToLf(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function asParsedDiff(value: unknown): ParsedDiff | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<ParsedDiff>;
	return Array.isArray(candidate.lines)
		&& typeof candidate.added === "number"
		&& typeof candidate.removed === "number"
		&& typeof candidate.chars === "number"
		? candidate as ParsedDiff
		: null;
}

export function parseDiff(oldContent: string, newContent: string, ctxLines = 3): ParsedDiff {
	oldContent = normalizeToLf(oldContent);
	newContent = normalizeToLf(newContent);
	const patch = Diff.structuredPatch("", "", oldContent, newContent, "", "", { context: ctxLines });
	const lines: DiffLine[] = [];
	let added = 0;
	let removed = 0;
	for (let hi = 0; hi < patch.hunks.length; hi++) {
		if (hi > 0) {
			const prev = patch.hunks[hi - 1];
			const gap = patch.hunks[hi].oldStart - (prev.oldStart + prev.oldLines);
			lines.push({ type: "sep", oldNum: null, newNum: gap > 0 ? gap : null, content: "" });
		}
		const hunk = patch.hunks[hi];
		let oldLine = hunk.oldStart;
		let newLine = hunk.newStart;
		for (const raw of hunk.lines) {
			if (raw === "\\ No newline at end of file") continue;
			const marker = raw[0];
			const content = sanitizeToolContent(raw.slice(1));
			if (marker === "+") {
				lines.push({ type: "add", oldNum: null, newNum: newLine++, content });
				added++;
			} else if (marker === "-") {
				lines.push({ type: "del", oldNum: oldLine++, newNum: null, content });
				removed++;
			} else {
				lines.push({ type: "ctx", oldNum: oldLine++, newNum: newLine++, content });
			}
		}
	}
	return { lines, added, removed, chars: oldContent.length + newContent.length };
}

/** Rebuild the render model from Pi's persisted standard unified patch. */
export function parsePersistedEditPatch(patch: unknown): ParsedDiff | null {
	if (typeof patch !== "string" || !patch.trim()) return null;
	try {
		const files = Diff.parsePatch(normalizeToLf(patch)) as any[];
		const lines: DiffLine[] = [];
		let added = 0;
		let removed = 0;
		let chars = 0;
		for (const file of files) {
			for (const hunk of file?.hunks ?? []) {
				if (lines.length > 0) lines.push({ type: "sep", oldNum: null, newNum: null, content: "" });
				let oldNum = Number(hunk.oldStart) || 1;
				let newNum = Number(hunk.newStart) || 1;
				for (const raw of hunk.lines ?? []) {
					if (raw === "\\ No newline at end of file") continue;
					const marker = raw[0];
					const content = sanitizeToolContent(raw.slice(1));
					chars += content.length;
					if (marker === "+") {
						lines.push({ type: "add", oldNum: null, newNum, content });
						newNum++;
						added++;
					} else if (marker === "-") {
						lines.push({ type: "del", oldNum, newNum: null, content });
						oldNum++;
						removed++;
					} else {
						lines.push({ type: "ctx", oldNum, newNum, content });
						oldNum++;
						newNum++;
					}
				}
			}
		}
		return lines.length > 0 ? { lines, added, removed, chars } : null;
	} catch {
		return null;
	}
}

/** Convert Pi 0.74's queue-owned numbered display diff into the source model. */
export function parseLegacyEditDiff(value: unknown): ParsedDiff | null {
	if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > MAX_WRITE_DIFF_INPUT_BYTES) return null;
	const lines: DiffLine[] = [];
	let added = 0;
	let removed = 0;
	let chars = 0;
	for (const raw of normalizeToLf(value).split("\n")) {
		if (/^\s*\.\.\.$/.test(raw)) {
			lines.push({ type: "sep", oldNum: null, newNum: null, content: "" });
			continue;
		}
		const match = /^([ +\-])\s*(\d+)\s(.*)$/.exec(raw);
		if (!match) continue;
		const marker = match[1];
		const lineNumber = Number.parseInt(match[2], 10);
		const content = sanitizeToolContent(match[3]);
		chars += content.length;
		if (marker === "+") { lines.push({ type: "add", oldNum: null, newNum: lineNumber, content }); added++; }
		else if (marker === "-") { lines.push({ type: "del", oldNum: lineNumber, newNum: null, content }); removed++; }
		else lines.push({ type: "ctx", oldNum: lineNumber, newNum: lineNumber, content });
	}
	return lines.length > 0 ? { lines, added, removed, chars } : null;
}

export function selectAuthoritativeEditDiff(patch: unknown, legacyDiff?: unknown): ParsedDiff | null {
	return parsePersistedEditPatch(patch) ?? parseLegacyEditDiff(legacyDiff);
}

export interface EditOperation { oldText: string; newText: string }

export function getEditOperations(input: any): EditOperation[] {
	if (Array.isArray(input?.edits)) {
		return input.edits
			.map((edit: any) => ({
				oldText: typeof edit?.oldText === "string" ? edit.oldText : typeof edit?.old_text === "string" ? edit.old_text : "",
				newText: typeof edit?.newText === "string" ? edit.newText : typeof edit?.new_text === "string" ? edit.new_text : "",
			}))
			.filter((edit: EditOperation) => edit.oldText && edit.oldText !== edit.newText);
	}
	const oldText = typeof input?.oldText === "string" ? input.oldText : typeof input?.old_text === "string" ? input.old_text : "";
	const newText = typeof input?.newText === "string" ? input.newText : typeof input?.new_text === "string" ? input.new_text : "";
	return oldText && oldText !== newText ? [{ oldText, newText }] : [];
}

export function summarizeEditOperations(
	operations: EditOperation[],
	formatSummary: (added: number, removed: number) => string,
) {
	const diffs = operations.map((edit) => parseDiff(edit.oldText, edit.newText));
	const totalAdded = diffs.reduce((sum, diff) => sum + diff.added, 0);
	const totalRemoved = diffs.reduce((sum, diff) => sum + diff.removed, 0);
	const totalLines = diffs.reduce((sum, diff) => sum + diff.lines.length, 0);
	const totalHunks = diffs.reduce((sum, diff) => sum + countDiffHunks(diff), 0);
	return { diffs, totalAdded, totalRemoved, totalLines, totalHunks, summary: formatSummary(totalAdded, totalRemoved) };
}

export function offsetParsedDiff(diff: ParsedDiff, oldOffset: number, newOffset = oldOffset): ParsedDiff {
	return {
		...diff,
		lines: diff.lines.map((line) => line.type === "sep" ? line : {
			...line,
			oldNum: line.oldNum === null ? null : line.oldNum + oldOffset,
			newNum: line.newNum === null ? null : line.newNum + newOffset,
		}),
	};
}

export function getFirstChangedNewLine(diff: ParsedDiff): number {
	let currentNewLine = 0;
	for (let index = 0; index < diff.lines.length; index++) {
		const line = diff.lines[index];
		if (line.type === "sep") { currentNewLine = 0; continue; }
		if (line.type === "ctx") { currentNewLine = (line.newNum ?? currentNewLine) + 1; continue; }
		if (line.type === "add") return line.newNum ?? currentNewLine;
		if (currentNewLine > 0) return currentNewLine;
		const next = diff.lines.slice(index + 1).find((entry) => entry.type !== "sep" && entry.newNum !== null);
		if (next?.newNum !== null && next?.newNum !== undefined) return next.newNum;
		return line.oldNum ?? 0;
	}
	return 0;
}

export function countDiffHunks(diff: ParsedDiff): number {
	return diff.lines.length === 0 ? 0 : diff.lines.filter((line) => line.type === "sep").length + 1;
}
