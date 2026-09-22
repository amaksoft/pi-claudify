import { open } from "node:fs/promises";

export { MAX_WRITE_DIFF_INPUT_BYTES, MAX_WRITE_SNAPSHOT_BYTES } from "./domain/limits.ts";
import { MAX_WRITE_DIFF_INPUT_BYTES, MAX_WRITE_SNAPSHOT_BYTES } from "./domain/limits.ts";

export type WriteSnapshot =
	| { kind: "new" }
	| { kind: "content"; content: string; bytes: number }
	| { kind: "omitted"; reason: "oversized" | "unreadable"; bytes?: number };

/** Capture an existing file without allowing diff generation to become an OOM path.
 * Async single bounded read: stat gates allocation at MAX_WRITE_SNAPSHOT_BYTES,
 * then one positional read of at most that many bytes. Never blocks dispatch. */
export async function captureWriteSnapshot(fullPath: string): Promise<WriteSnapshot> {
	if (!fullPath) return { kind: "new" };
	let handle;
	try {
		handle = await open(fullPath, "r");
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? { kind: "new" } : { kind: "omitted", reason: "unreadable" };
	}
	try {
		const size = (await handle.stat()).size;
		if (size > MAX_WRITE_SNAPSHOT_BYTES) return { kind: "omitted", reason: "oversized", bytes: size };
		if (size === 0) return { kind: "content", content: "", bytes: 0 };
		const buffer = Buffer.alloc(size);
		// A concurrent truncation between stat and read short-reads; only the
		// bytes actually read may be stringified, never the NUL-filled tail.
		const { bytesRead } = await handle.read(buffer, 0, size, 0);
		return { kind: "content", content: buffer.subarray(0, bytesRead).toString("utf8"), bytes: bytesRead };
	} catch {
		return { kind: "omitted", reason: "unreadable" };
	} finally {
		await handle.close().catch(() => {});
	}
}

export function writeDiffOmissionReason(snapshot: WriteSnapshot, newContent: string): "oversized" | "unavailable" | null {
	const newBytes = Buffer.byteLength(newContent, "utf8");
	// New files have no old snapshot, but building their synthetic listing/diff is
	// still bounded by the same total-input ceiling.
	if (newBytes > MAX_WRITE_DIFF_INPUT_BYTES) return "oversized";
	if (snapshot.kind === "omitted") return snapshot.reason === "oversized" ? "oversized" : "unavailable";
	if (snapshot.kind !== "content") return null;
	return snapshot.bytes + newBytes > MAX_WRITE_DIFF_INPUT_BYTES ? "oversized" : null;
}
