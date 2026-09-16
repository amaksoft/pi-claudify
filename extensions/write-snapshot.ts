import { existsSync, readFileSync, statSync } from "node:fs";

export const MAX_WRITE_SNAPSHOT_BYTES = 1024 * 1024;
export const MAX_WRITE_DIFF_INPUT_BYTES = MAX_WRITE_SNAPSHOT_BYTES * 2;

export type WriteSnapshot =
	| { kind: "new" }
	| { kind: "content"; content: string; bytes: number }
	| { kind: "omitted"; reason: "oversized" | "unreadable"; bytes?: number };

/** Capture an existing file without allowing diff generation to become an OOM path. */
export function captureWriteSnapshot(fullPath: string): WriteSnapshot {
	if (!fullPath || !existsSync(fullPath)) return { kind: "new" };
	try {
		const bytes = statSync(fullPath).size;
		if (bytes > MAX_WRITE_SNAPSHOT_BYTES) return { kind: "omitted", reason: "oversized", bytes };
		return { kind: "content", content: readFileSync(fullPath, "utf8"), bytes };
	} catch {
		return { kind: "omitted", reason: "unreadable" };
	}
}

export function writeDiffOmissionReason(snapshot: WriteSnapshot, newContent: string): "oversized" | "unavailable" | null {
	if (snapshot.kind === "omitted") return snapshot.reason === "oversized" ? "oversized" : "unavailable";
	if (snapshot.kind !== "content") return null;
	return snapshot.bytes + Buffer.byteLength(newContent, "utf8") > MAX_WRITE_DIFF_INPUT_BYTES ? "oversized" : null;
}
