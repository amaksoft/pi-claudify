import type { BundledLanguage } from "shiki";
import { countDiffHunks, normalizeToLf, parseDiff, type DiffLine, type ParsedDiff } from "./diff-model.ts";

export interface ApplyPatchChangePreview {
	kind: "add" | "update" | "delete";
	path: string;
	displayPath: string;
	moveTo?: string;
	diff: ParsedDiff;
	language: BundledLanguage | undefined;
	hunks: number;
	summary: string;
	line: number;
}
export interface ApplyPatchPreview {
	changes: ApplyPatchChangePreview[];
	totalAdded: number;
	totalRemoved: number;
	totalHunks: number;
	totalLines: number;
	summary: string;
}
export interface ApplyPatchResultMeta {
	changeCount: number;
	totalAdded: number;
	totalRemoved: number;
	totalHunks: number;
	totalLines: number;
	firstChange?: { displayPath: string; kind: ApplyPatchChangePreview["kind"]; hunks: number; line: number; added: number; removed: number };
}
export interface ApplyPatchModelDependencies {
	displayPath(path: string, moveTo?: string): string;
	language(path: string): BundledLanguage | undefined;
	summary(added: number, removed: number): string;
}

export function buildApplyPatchResultMeta(preview: ApplyPatchPreview): ApplyPatchResultMeta {
	const first = preview.changes[0];
	return {
		changeCount: preview.changes.length,
		totalAdded: preview.totalAdded,
		totalRemoved: preview.totalRemoved,
		totalHunks: preview.totalHunks,
		totalLines: preview.totalLines,
		firstChange: first ? { displayPath: first.displayPath, kind: first.kind, hunks: first.hunks, line: first.line, added: first.diff.added, removed: first.diff.removed } : undefined,
	};
}

export function getApplyPatchLine(diff: ParsedDiff, kind: ApplyPatchChangePreview["kind"]): number {
	if (kind === "add") return diff.lines.find((line) => line.type === "add" && line.newNum !== null)?.newNum ?? 1;
	if (kind === "delete") return diff.lines.find((line) => line.type === "del" && line.oldNum !== null)?.oldNum ?? 1;
	for (const line of diff.lines) {
		if (line.type === "add" && line.newNum !== null) return line.newNum;
		if (line.type === "del" && line.oldNum !== null) return line.oldNum;
	}
	return 0;
}

function parseBodyLine(raw: string): { marker: "+" | "-" | " "; content: string } {
	const marker = raw[0];
	return marker === "+" || marker === "-" || marker === " " ? { marker, content: raw.slice(1) } : { marker: " ", content: raw };
}
function findSequence(haystack: string[], needle: string[], from = 0): number {
	if (needle.length === 0) return Math.max(0, from);
	outer: for (let index = Math.max(0, from); index <= haystack.length - needle.length; index++) {
		for (let offset = 0; offset < needle.length; offset++) if (haystack[index + offset] !== needle[offset]) continue outer;
		return index;
	}
	return -1;
}
function inferHunkStarts(lines: string[], source: string): Array<{ oldStart: number | null; newStart: number | null }> {
	const sourceLines = normalizeToLf(source).split("\n");
	const hunks: string[][] = [];
	let current: string[] | null = null;
	for (const raw of lines) {
		if (raw.startsWith("*** Move to: ")) continue;
		if (raw.startsWith("@@")) { if (current) hunks.push(current); current = []; continue; }
		(current ??= []).push(raw);
	}
	if (current) hunks.push(current);
	const starts: Array<{ oldStart: number | null; newStart: number | null }> = [];
	let searchFrom = 0;
	let delta = 0;
	for (const hunk of hunks) {
		const oldLines = hunk.map(parseBodyLine).filter((line) => line.marker !== "+").map((line) => line.content);
		let match = findSequence(sourceLines, oldLines, searchFrom);
		if (match === -1) match = findSequence(sourceLines, oldLines, 0);
		const oldStart = match === -1 ? null : match + 1;
		starts.push({ oldStart, newStart: oldStart === null ? null : oldStart + delta });
		if (match !== -1) {
			searchFrom = match + oldLines.length;
			delta += hunk.filter((line) => parseBodyLine(line).marker === "+").length - hunk.filter((line) => parseBodyLine(line).marker === "-").length;
		}
	}
	return starts;
}
function trimSeparators(lines: DiffLine[]): DiffLine[] {
	const result = [...lines];
	while (result[0]?.type === "sep") result.shift();
	while (result.at(-1)?.type === "sep") result.pop();
	return result;
}
function updateDiff(lines: string[], source?: string): ParsedDiff {
	const output: DiffLine[] = [];
	let added = 0, removed = 0, chars = 0, oldLine: number | null = null, newLine: number | null = null, inHunk = false, hunkIndex = 0;
	const inferred = source ? inferHunkStarts(lines, source) : [];
	for (const raw of lines) {
		if (raw.startsWith("*** Move to: ") || raw === "\\ No newline at end of file") continue;
		if (raw.startsWith("@@")) {
			if (output.length && output.at(-1)?.type !== "sep") output.push({ type: "sep", oldNum: null, newNum: null, content: "" });
			const match = raw.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
			const fallback = inferred[hunkIndex++] ?? { oldStart: null, newStart: null };
			oldLine = match ? +match[1] : fallback.oldStart; newLine = match ? +match[2] : fallback.newStart; inHunk = true; continue;
		}
		if (!inHunk) { const fallback = inferred[hunkIndex++] ?? { oldStart: null, newStart: null }; oldLine = fallback.oldStart; newLine = fallback.newStart; inHunk = true; }
		const line = parseBodyLine(raw); chars += line.content.length;
		if (line.marker === "+") { output.push({ type: "add", oldNum: null, newNum: newLine, content: line.content }); added++; if (newLine !== null) newLine++; }
		else if (line.marker === "-") { output.push({ type: "del", oldNum: oldLine, newNum: null, content: line.content }); removed++; if (oldLine !== null) oldLine++; }
		else { output.push({ type: "ctx", oldNum: oldLine, newNum: newLine, content: line.content }); if (oldLine !== null) oldLine++; if (newLine !== null) newLine++; }
	}
	return { lines: trimSeparators(output), added, removed, chars };
}

export function parseApplyPatchPreview(patchText: string, dependencies: ApplyPatchModelDependencies): ApplyPatchPreview {
	const lines = normalizeToLf(patchText).split("\n");
	const changes: ApplyPatchChangePreview[] = [];
	const fileHeader = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
	let index = 0;
	while (index < lines.length) {
		const header = lines[index].match(fileHeader);
		if (!header) { if (/^\*\*\* End Patch$/.test(lines[index])) break; index++; continue; }
		const kind = header[1].toLowerCase() as ApplyPatchChangePreview["kind"];
		const path = header[2].trim(); index++;
		let moveTo: string | undefined;
		const body: string[] = [];
		while (index < lines.length && !fileHeader.test(lines[index]) && !/^\*\*\* End Patch$/.test(lines[index])) {
			if (lines[index].startsWith("*** Move to: ")) moveTo = lines[index].slice(13).trim();
			else body.push(lines[index]);
			index++;
		}
		const strip = (line: string, prefix: "+" | "-") => line.startsWith(prefix) ? line.slice(1) : line;
		const diff = kind === "add" ? parseDiff("", body.map((line) => strip(line, "+")).join("\n"))
			: kind === "delete" ? parseDiff(body.map((line) => strip(line, "-")).join("\n"), "") : updateDiff(body);
		changes.push({ kind, path, moveTo, displayPath: dependencies.displayPath(path, moveTo), diff, language: dependencies.language(moveTo || path), hunks: countDiffHunks(diff), summary: dependencies.summary(diff.added, diff.removed), line: getApplyPatchLine(diff, kind) });
	}
	const totalAdded = changes.reduce((sum, change) => sum + change.diff.added, 0);
	const totalRemoved = changes.reduce((sum, change) => sum + change.diff.removed, 0);
	const totalHunks = changes.reduce((sum, change) => sum + change.hunks, 0);
	const totalLines = changes.reduce((sum, change) => sum + change.diff.lines.length, 0);
	return { changes, totalAdded, totalRemoved, totalHunks, totalLines, summary: dependencies.summary(totalAdded, totalRemoved) };
}
