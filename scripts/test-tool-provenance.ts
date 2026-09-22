import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ToolProvenanceObserver } from "../extensions/host/tool-provenance.ts";
import { executeWriteWithSnapshot } from "../extensions/tools/write-execution.ts";
import { RuntimeHandle } from "../extensions/runtime/runtime-handle.ts";
import { trackedTempDir } from "./sandbox-home.ts";

const root = trackedTempDir("claudify-tool-provenance");
try {
	const owners = new Map<"write" | "edit", boolean>([["write", true], ["edit", true]]);
	const runtime = new RuntimeHandle("provenance");
	runtime.activate();
	const observer = new ToolProvenanceObserver(runtime, {
		isBuiltinOwner: (name) => owners.get(name) === true,
		summarizeDiff: (added, removed) => `+${added} -${removed}`,
	});

	const file = join(root, "value.ts");
	writeFileSync(file, "const value = 1;\n");
	await observer.onToolCall({ toolCallId: "write-1", toolName: "write", input: { path: "value.ts", content: "const value = 2;\n" } }, root);
	assert.equal(observer.pendingCount(), 1);
	const writePatch = observer.onToolResult({
		toolCallId: "write-1", toolName: "write", input: { path: "value.ts", content: "const value = 2;\n" },
		content: [{ type: "text", text: "wrote" }], details: { audit: "keep" }, isError: false,
	});
	assert.equal((writePatch?.details as any)?._type, "diff");
	assert.equal((writePatch?.details as any)?.audit, "keep", "write enrichment preserves cooperating extension metadata");
	assert.equal((writePatch?.details as any)?.diff?.added, 1);
	assert.equal(observer.pendingCount(), 0);

	writeFileSync(file, "A");
	await observer.onToolCall({ toolCallId: "parallel-1", toolName: "write", input: { path: "value.ts", content: "B" } }, root);
	await observer.onToolCall({ toolCallId: "parallel-2", toolName: "write", input: { path: "value.ts", content: "C" } }, root);
	const parallelOne = observer.onToolResult({ toolCallId: "parallel-1", toolName: "write", input: { path: "value.ts", content: "B" }, content: [], details: {}, isError: false });
	const parallelTwo = observer.onToolResult({ toolCallId: "parallel-2", toolName: "write", input: { path: "value.ts", content: "C" }, content: [], details: {}, isError: false });
	assert.equal((parallelOne?.details as any)?._type, "diffOmitted");
	assert.equal((parallelTwo?.details as any)?._type, "diffOmitted", "same-path concurrent writes fail closed instead of claiming a false preimage");

	await observer.onToolCall({ toolCallId: "mutated", toolName: "write", input: { path: "value.ts", content: "B" } }, root);
	const mutated = observer.onToolResult({ toolCallId: "mutated", toolName: "write", input: { path: "value.ts", content: "C" }, content: [], details: {}, isError: false });
	assert.equal((mutated?.details as any)?._type, "diffOmitted", "later argument mutation invalidates captured provenance");

	owners.set("write", false);
	await observer.onToolCall({ toolCallId: "external-write", toolName: "write", input: { path: "value.ts", content: "external" } }, root);
	assert.equal(observer.pendingCount(), 0, "external same-name writes are never snapshotted");
	assert.equal(observer.onToolResult({ toolCallId: "external-write", toolName: "write", input: {}, content: [], details: {}, isError: false }), undefined);

	const editPatch = observer.onToolResult({
		toolCallId: "edit-1", toolName: "edit", input: { path: "value.ts", edits: [{ oldText: "1", newText: "2" }] },
		content: [{ type: "text", text: "updated" }],
		details: { patch: "@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;\n" },
		isError: false,
	});
	assert.equal((editPatch?.details as any)?._type, "editInfo");
	assert.equal((editPatch?.details as any)?.added, 1);

	owners.set("write", true);
	for (let index = 0; index < 80; index++) {
		await observer.onToolCall({ toolCallId: `bounded-${index}`, toolName: "write", input: { path: "value.ts", content: String(index) } }, root);
	}
	assert.equal(observer.pendingCount(), 64, "pending provenance is bounded");
	const evicted = observer.onToolResult({ toolCallId: "bounded-0", toolName: "write", input: { path: "value.ts", content: "0" }, content: [], details: {}, isError: false });
	assert.equal((evicted?.details as any)?._type, "diffOmitted", "evicted provenance reports an explicit unavailable diff");
	observer.clear();
	assert.equal(observer.pendingCount(), 0);

	writeFileSync(file, "legacy-a");
	const legacyContext = { cwd: root, sessionManager: { getSessionId: () => "legacy-parallel", getSessionFile: () => undefined } };
	const legacyResults = await Promise.all([
		executeWriteWithSnapshot(root, "legacy-1", { path: "value.ts", content: "legacy-b" }, undefined, undefined, legacyContext, { summarizeDiff: () => "changed" }),
		executeWriteWithSnapshot(root, "legacy-2", { path: "value.ts", content: "legacy-c" }, undefined, undefined, legacyContext, { summarizeDiff: () => "changed" }),
	]);
	assert.equal(legacyResults.every((result) => result.details?._type === "diffOmitted"), true, "legacy fallback also fails closed for concurrent same-path writes");

	runtime.beginRetirement();
	await observer.onToolCall({ toolCallId: "stale", toolName: "write", input: { path: "value.ts", content: "stale" } }, root);
	assert.equal(observer.pendingCount(), 0, "retired generations reject stale observations");
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("tool provenance observer tests passed");
