import assert from "node:assert/strict";

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

console.log("diff domain model tests passed");
