import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getFirstChangedNewLine, offsetParsedDiff, parseDiff, type EditOperation, type ParsedDiff } from "../domain/diff-model.ts";

export interface LocalizedEditDiff {
	diff: ParsedDiff;
	line: number;
}

function normalizeToLf(text: string): string { return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }
function stripBom(text: string): string { return text.startsWith("\uFEFF") ? text.slice(1) : text; }
function normalizeForFuzzyMatch(text: string): string {
	return text.normalize("NFKC").split("\n").map((line) => line.trimEnd()).join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}
function findEditMatch(content: string, oldText: string) {
	const exact = content.indexOf(oldText);
	if (exact !== -1) return { found: true, index: exact, matchLength: oldText.length, usedFuzzyMatch: false };
	const normalizedContent = normalizeForFuzzyMatch(content);
	const normalizedOld = normalizeForFuzzyMatch(oldText);
	const index = normalizedContent.indexOf(normalizedOld);
	return index === -1
		? { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false }
		: { found: true, index, matchLength: normalizedOld.length, usedFuzzyMatch: true };
}
function countOccurrences(content: string, oldText: string): number {
	return normalizeForFuzzyMatch(content).split(normalizeForFuzzyMatch(oldText)).length - 1;
}
function lineAt(text: string, index: number): number { return text.slice(0, Math.max(0, index)).split("\n").length; }
function lineBreaks(text: string): number { return (text.match(/\n/g) ?? []).length; }
function prepare(content: string, operations: EditOperation[]) {
	const normalizedContent = normalizeToLf(stripBom(content));
	const normalizedOperations = operations.map((edit) => ({ oldText: normalizeToLf(edit.oldText), newText: normalizeToLf(edit.newText) }));
	const baseContent = normalizedOperations.some((edit) => findEditMatch(normalizedContent, edit.oldText).usedFuzzyMatch)
		? normalizeForFuzzyMatch(normalizedContent) : normalizedContent;
	const matches = normalizedOperations.map((edit, editIndex) => {
		const match = findEditMatch(baseContent, edit.oldText);
		if (!match.found || countOccurrences(baseContent, edit.oldText) !== 1) return null;
		return { editIndex, matchIndex: match.index, matchLength: match.matchLength, newText: edit.newText };
	});
	if (matches.some((match) => match === null)) return null;
	const ordered = [...matches as Array<{ editIndex: number; matchIndex: number; matchLength: number; newText: string }>].sort((a, b) => a.matchIndex - b.matchIndex);
	for (let index = 1; index < ordered.length; index++) if (ordered[index - 1].matchIndex + ordered[index - 1].matchLength > ordered[index].matchIndex) return null;
	return { baseContent, ordered };
}

export function aggregateEditDiffFromContent(content: string, operations: EditOperation[]): ParsedDiff | null {
	if (operations.length === 0) return null;
	const prepared = prepare(content, operations);
	if (!prepared) return null;
	let next = prepared.baseContent;
	for (const match of [...prepared.ordered].reverse()) next = `${next.slice(0, match.matchIndex)}${match.newText}${next.slice(match.matchIndex + match.matchLength)}`;
	const diff = parseDiff(prepared.baseContent, next);
	return diff.lines.length > 0 ? diff : null;
}

export async function computeAggregateEditDiff(filePath: string, operations: EditOperation[], cwd: string): Promise<ParsedDiff | null> {
	if (!filePath || operations.length === 0) return null;
	try { return aggregateEditDiffFromContent(await readFile(resolve(cwd, filePath), "utf8"), operations); }
	catch { return null; }
}

export async function computeLocalizedEditDiffs(filePath: string, operations: EditOperation[], cwd: string): Promise<LocalizedEditDiff[] | null> {
	if (!filePath || operations.length === 0) return null;
	try {
		const prepared = prepare(await readFile(resolve(cwd, filePath), "utf8"), operations);
		if (!prepared) return null;
		const localized: Array<LocalizedEditDiff | null> = Array(operations.length).fill(null);
		let delta = 0;
		for (const match of prepared.ordered) {
			const oldChunk = prepared.baseContent.slice(match.matchIndex, match.matchIndex + match.matchLength);
			const oldStart = lineAt(prepared.baseContent, match.matchIndex);
			const newStart = oldStart + delta;
			const diff = offsetParsedDiff(parseDiff(oldChunk, match.newText), oldStart - 1, newStart - 1);
			localized[match.editIndex] = { diff, line: getFirstChangedNewLine(diff) };
			delta += lineBreaks(match.newText) - lineBreaks(oldChunk);
		}
		return localized.every(Boolean) ? localized as LocalizedEditDiff[] : null;
	} catch {
		return null;
	}
}
