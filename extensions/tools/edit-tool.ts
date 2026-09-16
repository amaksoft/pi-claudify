import { createEditToolDefinition, type Theme } from "@earendil-works/pi-coding-agent";

import {
	asParsedDiff,
	getEditOperations,
	getFirstChangedNewLine,
	parsePersistedEditPatch,
	summarizeEditOperations,
	type EditOperation,
	type ParsedDiff,
} from "../domain/diff-model.ts";
import { languageForPath } from "../domain/language.ts";
import { sanitizeToolOutput } from "../terminal-sanitize.ts";
import { executeEditWithProvenance } from "./edit-execution.ts";
import type { DiffCardRuntime, ToolChromeRuntime } from "./presenter-runtime.ts";

export interface EditToolRuntime extends ToolChromeRuntime, DiffCardRuntime {
	summarizeDiff(added: number, removed: number): string;
	linkedPath(path: string, cwd: string): string;
	revealArgs(ctx: any): boolean;
	hasArg(args: any, key: string): boolean;
	indentBranch(content: string): string;
	resultSentence(theme: Theme, text: string): string;
	computeAggregate(path: string, operations: EditOperation[], cwd: string): Promise<ParsedDiff | null>;
	computeLocalized(path: string, operations: EditOperation[], cwd: string): Promise<Array<{ diff: ParsedDiff; line: number }> | null>;
	buildAggregate(theme: Theme, language: any, diff: ParsedDiff, expanded: boolean, width: number): Promise<string>;
	buildPreview(theme: Theme, language: any, operations: EditOperation[], diffs: ParsedDiff[], lines: number[], summary: any, expanded: boolean, width: number): Promise<string>;
	hash(text: string): string;
	revision(): number;
}

function cachedSummary(runtime: EditToolRuntime, ctx: any, key: string, operations: EditOperation[]) {
	if (ctx.state?._editSummaryKey === key && ctx.state._editSummary) return ctx.state._editSummary;
	const summary = summarizeEditOperations(operations, runtime.summarizeDiff);
	if (ctx.state) { ctx.state._editSummaryKey = key; ctx.state._editSummary = summary; }
	return summary;
}

export function registerEditTool(runtime: EditToolRuntime): void {
	const native = createEditToolDefinition(runtime.cwd);
	runtime.register({
		name: "edit",
		label: "edit",
		description: native.description,
		parameters: native.parameters,
		...runtime.forwardContract(native),
		execute: (toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) =>
			executeEditWithProvenance(runtime.cwd, toolCallId, params, signal, onUpdate, ctx, { summarizeDiff: runtime.summarizeDiff }),
		renderCall(args: any, theme: Theme, ctx: any) {
			const path = args?.path ?? args?.file_path ?? "";
			const operations = getEditOperations(args);
			const reveal = runtime.revealArgs(ctx) || (!!path && runtime.hasArg(args, "edits"));
			const summary = runtime.stableSummary(ctx, "_callSummary", () => runtime.linkedPath(path, ctx.cwd ?? runtime.cwd), reveal);
			runtime.syncCallStatus(ctx);
			const header = runtime.header("Update", summary, theme, runtime.statusDot(ctx, theme));
			if (ctx.isPartial === false || !(ctx.argsComplete && operations.length > 0)) return runtime.makeText(ctx.lastComponent, header);
			const key = `edit-call:${path}:${runtime.hash(operations.map((edit) => `${edit.oldText}\u0000${edit.newText}`).join("\u0001"))}:${ctx.expanded ? 1 : 0}:${runtime.revision()}`;
			const fallback = cachedSummary(runtime, ctx, key, operations);
			const placeholder = `${header}\n${runtime.indentBranch(runtime.withBranch(theme.fg("muted", "(rendering diff…)"), theme, false, true))}`;
			return runtime.diffCard(
				ctx.lastComponent,
				key,
				placeholder,
				async (width) => {
					const aggregate = await runtime.computeAggregate(path, operations, ctx.cwd ?? runtime.cwd);
					if (aggregate) return `${header}\n${await runtime.buildAggregate(theme, languageForPath(path), aggregate, ctx.expanded === true, width)}`;
					const localized = await runtime.computeLocalized(path, operations, ctx.cwd ?? runtime.cwd).catch(() => null);
					const diffs = localized?.map((entry) => entry.diff) ?? fallback.diffs;
					const lines = localized?.map((entry) => entry.line) ?? diffs.map(getFirstChangedNewLine);
					return `${header}\n${await runtime.buildPreview(theme, languageForPath(path), operations, diffs, lines, fallback.summary, ctx.expanded === true, width)}`;
				},
				ctx.invalidate,
				runtime.renderPrewrapped,
				header,
			);
		},
		renderResult(result: any, { isPartial }: any, theme: Theme, ctx: any) {
			if (isPartial) {
				runtime.startBlink(ctx);
				return runtime.makeText(ctx.lastComponent, runtime.indentBranch(runtime.withBranch(theme.fg("dim", "Editing..."), theme)));
			}
			runtime.stopBlink(ctx);
			runtime.setStatus(ctx, ctx.isError ? "error" : "success");
			if (ctx.isError) {
				const error = result.content?.filter((item: any) => item.type === "text").map((item: any) => item.text || "").join("\n") ?? "Error";
				return runtime.makeText(ctx.lastComponent, runtime.indentBranch(runtime.withBranch(theme.fg("error", sanitizeToolOutput(error)), theme)));
			}
			const details = (result.details ?? {}) as Record<string, any>;
			if (details._type === "diffUnavailable") {
				return runtime.makeText(ctx.lastComponent, runtime.indentBranch(runtime.withBranch(`${runtime.resultSentence(theme, "Applied")} ${theme.fg("muted", "(diff unavailable: source provenance not captured)")}`, theme)));
			}
			const operations = getEditOperations(ctx.args);
			const fallback = operations.length > 0 ? summarizeEditOperations(operations, runtime.summarizeDiff) : null;
			const aggregatePersisted = asParsedDiff(details.aggregateDiff) ?? (details._type !== "multiEditInfo" ? asParsedDiff(details.parsedDiff) : null);
			let diffs = aggregatePersisted ? [aggregatePersisted] : Array.isArray(details.parsedDiffs) ? details.parsedDiffs.map(asParsedDiff).filter(Boolean) as ParsedDiff[] : [];
			let displayOperations = aggregatePersisted ? [operations[0] ?? { oldText: "", newText: "" }] : operations;
			let lines = aggregatePersisted ? [getFirstChangedNewLine(aggregatePersisted)] : Array.isArray(details.editLines) ? details.editLines.filter((line: unknown) => typeof line === "number") : [];
			const singlePersisted = asParsedDiff(details.parsedDiff);
			if (diffs.length === 0 && singlePersisted) diffs = [singlePersisted];
			if (diffs.length === 0) {
				const fromPatch = parsePersistedEditPatch(details.patch);
				if (fromPatch) { diffs = [fromPatch]; displayOperations = [operations[0] ?? { oldText: "", newText: "" }]; }
			}
			if (diffs.length === 0 && fallback) diffs = fallback.diffs;
			if (lines.length === 0 && typeof details.editLine === "number") lines = [details.editLine];
			if (lines.length === 0) lines = diffs.map(getFirstChangedNewLine);
			if (diffs.length > 0) {
				if (displayOperations.length !== diffs.length) displayOperations = diffs.map((_, index) => operations[index] ?? { oldText: "", newText: "" });
				const summary = fallback?.summary ?? runtime.summarizeDiff(diffs.reduce((total, diff) => total + diff.added, 0), diffs.reduce((total, diff) => total + diff.removed, 0));
				const key = `edit-result:${runtime.hash(JSON.stringify(diffs))}:${ctx.expanded ? 1 : 0}:${runtime.revision()}`;
				const placeholder = runtime.indentBranch(runtime.withBranch(theme.fg("muted", "(rendering diff…)"), theme, false, true));
				return runtime.diffCard(
					ctx.lastComponent,
					key,
					placeholder,
					(width) => aggregatePersisted
						? runtime.buildAggregate(theme, details.language ?? languageForPath(ctx.args?.path ?? ""), aggregatePersisted, ctx.expanded === true, width)
						: runtime.buildPreview(theme, details.language ?? languageForPath(ctx.args?.path ?? ""), displayOperations, diffs, lines, summary, ctx.expanded === true, width),
					ctx.invalidate,
					runtime.renderPrewrapped,
					runtime.withBranch(theme.fg("success", "Applied"), theme),
				);
			}
			return runtime.makeText(ctx.lastComponent, runtime.indentBranch(runtime.withBranch(theme.fg("success", "Applied"), theme)));
		},
	});
}
