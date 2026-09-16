import assert from "node:assert/strict";

import { buildApplyPatchResultMeta, parseApplyPatchPreview } from "../extensions/domain/apply-patch.ts";
import {
	asParsedDiff,
	countDiffHunks,
	getEditOperations,
	getFirstChangedNewLine,
	offsetParsedDiff,
	parseDiff,
	parseLegacyEditDiff,
	parsePersistedEditPatch,
	selectAuthoritativeEditDiff,
	summarizeEditOperations,
} from "../extensions/domain/diff-model.ts";

const parsed = parseDiff("one\ntwo\n", "one\nthree\n");
assert.equal(parsed.added, 1);
assert.equal(parsed.removed, 1);
assert.equal(countDiffHunks(parsed), 1);
assert.equal(getFirstChangedNewLine(parsed), 2);
assert.equal(offsetParsedDiff(parsed, 10).lines.find((line) => line.type === "add")?.newNum, 12);
assert.deepEqual(getEditOperations({ old_text: "a", new_text: "b" }), [{ oldText: "a", newText: "b" }]);
assert.deepEqual(getEditOperations({ edits: [{ oldText: "same", newText: "same" }, { oldText: "a", newText: "b" }] }), [{ oldText: "a", newText: "b" }]);
assert.equal(summarizeEditOperations([{ oldText: "a", newText: "b" }], (added, removed) => `${added}/${removed}`).summary, "1/1");
assert.equal(asParsedDiff(JSON.parse(JSON.stringify(parsed)))?.lines.length, parsed.lines.length);
assert.equal(asParsedDiff({ lines: [], added: 0 }), null);

const patch = "@@ -1,2 +1,2 @@\n one\n-two\n+three\n";
const persisted = parsePersistedEditPatch(patch)!;
assert.equal(persisted.added, 1);
assert.equal(persisted.removed, 1);
assert.equal(persisted.lines.find((line) => line.type === "add")?.content, "three");

const legacy = parseLegacyEditDiff(" 1 one\n-2 two\n+2 three")!;
assert.equal(legacy.added, 1);
assert.equal(legacy.removed, 1);
assert.equal(selectAuthoritativeEditDiff(patch, "-1 wrong\n+1 wrong")?.lines.find((line) => line.type === "add")?.content, "three");

const applyPatch = parseApplyPatchPreview(
	"*** Begin Patch\n*** Update File: src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n*** Add File: src/b.ts\n+created\n*** End Patch",
	{
		displayPath: (path, moveTo) => moveTo ? `${path}->${moveTo}` : path,
		language: () => "typescript",
		summary: (added, removed) => `${added}/${removed}`,
	},
);
assert.equal(applyPatch.changes.length, 2);
assert.equal(applyPatch.totalAdded, 2);
assert.equal(applyPatch.totalRemoved, 1);
assert.equal(applyPatch.changes[0].line, 1);
assert.equal(buildApplyPatchResultMeta(applyPatch).firstChange?.displayPath, "src/a.ts");

console.log("diff domain model tests passed");
