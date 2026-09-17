import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";

import {
	countDiffHunks,
	getEditOperations,
	getFirstChangedNewLine,
	parseLegacyEditDiff,
	parsePersistedEditPatch,
	summarizeEditOperations,
} from "../domain/diff-model.ts";
import { languageForPath } from "../domain/language.ts";

export interface EditExecutionDependencies {
	summarizeDiff(added: number, removed: number): string;
}

export function normalizeEditResultProvenance(
	params: any,
	result: any,
	dependencies: EditExecutionDependencies,
): any {
	const filePath = params.path ?? params.file_path ?? "";
	const operations = getEditOperations(params);
	if (operations.length === 0) return result;
	const { summary } = summarizeEditOperations(operations, dependencies.summarizeDiff);
	const baseDetails = { ...((result.details ?? {}) as Record<string, unknown>) };
	const legacyDisplayDiff = baseDetails.diff;
	const nativePatchDiff = parsePersistedEditPatch(baseDetails.patch);
	const legacyDiff = nativePatchDiff ? null : parseLegacyEditDiff(legacyDisplayDiff);
	const aggregateDiff = nativePatchDiff ?? legacyDiff;
	const persistLegacyModel = !nativePatchDiff && !!legacyDiff;
	if (operations.length === 1) {
		if (!aggregateDiff) {
			result.details = { ...baseDetails, _type: "diffUnavailable", summary, language: languageForPath(filePath) };
			return result;
		}
		const editLine = getFirstChangedNewLine(aggregateDiff)
			|| (typeof baseDetails.firstChangedLine === "number" ? baseDetails.firstChangedLine : 0);
		result.details = {
			...baseDetails,
			_type: "editInfo",
			summary,
			editLine,
			...(persistLegacyModel ? { parsedDiff: aggregateDiff } : {}),
			hunks: countDiffHunks(aggregateDiff),
			added: aggregateDiff.added,
			removed: aggregateDiff.removed,
			language: languageForPath(filePath),
		};
		return result;
	}
	if (!aggregateDiff) {
		result.details = { ...baseDetails, _type: "diffUnavailable", summary, editCount: operations.length, language: languageForPath(filePath) };
		return result;
	}
	result.details = {
		...baseDetails,
		_type: "multiEditInfo",
		summary,
		editCount: operations.length,
		...(persistLegacyModel ? { aggregateDiff } : {}),
		diffLineCount: aggregateDiff.lines.length,
		hunks: countDiffHunks(aggregateDiff),
		totalAdded: aggregateDiff.added,
		totalRemoved: aggregateDiff.removed,
		language: languageForPath(filePath),
	};
	return result;
}

/** Execute Pi's native edit and normalize its queue-owned provenance for reload. */
export async function executeEditWithProvenance(
	startupCwd: string,
	toolCallId: string,
	params: any,
	signal: AbortSignal | undefined,
	onUpdate: any,
	ctx: any,
	dependencies: EditExecutionDependencies,
): Promise<any> {
	const cwd = ctx?.cwd ?? startupCwd;
	const result: any = await createEditToolDefinition(cwd).execute(toolCallId, params, signal, onUpdate, ctx);
	return normalizeEditResultProvenance(params, result, dependencies);
}
