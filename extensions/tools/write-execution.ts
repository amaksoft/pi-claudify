import { resolve } from "node:path";
import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";

import { parseDiff } from "../domain/diff-model.ts";
import { languageForPath } from "../domain/language.ts";
import { captureWriteSnapshot, writeDiffOmissionReason, type WriteSnapshot } from "../write-snapshot.ts";

export interface WriteExecutionDependencies {
	summarizeDiff(added: number, removed: number): string;
}

interface InFlightWrite { ambiguous: boolean }
const inFlightWrites = new Map<string, Set<InFlightWrite>>();

function lineCount(text: string): number {
	return text ? text.split("\n").length : 0;
}

export function enrichWriteResultWithSnapshot(
	snapshot: WriteSnapshot,
	filePath: string,
	content: string,
	result: any,
	dependencies: WriteExecutionDependencies,
): any {
	const omission = writeDiffOmissionReason(snapshot, content);
	const existing = result.details && typeof result.details === "object" ? result.details as Record<string, unknown> : {};
	if (omission) {
		result.details = { ...existing, _type: "diffOmitted", reason: omission, filePath, lines: lineCount(content) };
	} else if (snapshot.kind === "content" && snapshot.content !== content) {
		const diff = parseDiff(snapshot.content, content);
		result.details = {
			...existing,
			_type: "diff",
			summary: dependencies.summarizeDiff(diff.added, diff.removed),
			diff,
			language: languageForPath(filePath),
		};
	} else if (snapshot.kind === "new") {
		result.details = { ...existing, _type: "new", lines: lineCount(content), filePath };
	} else if (snapshot.kind === "content" && snapshot.content === content) {
		result.details = { ...existing, _type: "noChange" };
	}
	return result;
}

/** Execute Pi's native write while persisting bounded, reload-safe diff provenance. */
export async function executeWriteWithSnapshot(
	startupCwd: string,
	toolCallId: string,
	params: any,
	signal: AbortSignal | undefined,
	onUpdate: any,
	ctx: any,
	dependencies: WriteExecutionDependencies,
): Promise<any> {
	const cwd = ctx?.cwd ?? startupCwd;
	const filePath = params.path ?? params.file_path ?? "";
	const fullPath = filePath ? resolve(cwd, filePath) : "";
	const concurrent = inFlightWrites.get(fullPath) ?? new Set<InFlightWrite>();
	const operation: InFlightWrite = { ambiguous: concurrent.size > 0 };
	for (const active of concurrent) active.ambiguous = true;
	concurrent.add(operation);
	inFlightWrites.set(fullPath, concurrent);
	const snapshot = captureWriteSnapshot(fullPath);
	try {
		const result: any = await createWriteToolDefinition(cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		return enrichWriteResultWithSnapshot(operation.ambiguous ? { kind: "omitted", reason: "unreadable" } : snapshot, filePath, params.content ?? "", result, dependencies);
	} finally {
		concurrent.delete(operation);
		if (concurrent.size === 0) inFlightWrites.delete(fullPath);
	}
}
