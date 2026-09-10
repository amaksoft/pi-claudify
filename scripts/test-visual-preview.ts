import assert from "node:assert/strict";

import { selectVisualItems, selectVisualPreview } from "../extensions/visual-preview.ts";

assert.deepEqual(
	selectVisualPreview("   \n\t", 10, 3, "head"),
	{ rows: [], hiddenRows: 0, hiddenPosition: null },
	"whitespace-only output has no visual rows",
);

const newlineDense = "first\n\n\nlast";
assert.deepEqual(
	selectVisualPreview(newlineDense, 20, 2, "head"),
	{ rows: ["first", ""], hiddenRows: 2, hiddenPosition: "later" },
	"blank logical lines count as exact visual rows in a head preview",
);
assert.deepEqual(
	selectVisualPreview(newlineDense, 20, 2, "tail"),
	{ rows: ["", "last"], hiddenRows: 2, hiddenPosition: "earlier" },
	"the bounded tail ring retains blank rows in order",
);

assert.deepEqual(
	selectVisualPreview("日本語", 4, 1, "head"),
	{ rows: ["日本"], hiddenRows: 1, hiddenPosition: "later" },
	"wide CJK graphemes are counted by terminal width rather than code units",
);
assert.deepEqual(
	selectVisualPreview("abcdefghij", 3, 2, "tail"),
	{ rows: ["ghi", "j"], hiddenRows: 2, hiddenPosition: "earlier" },
	"long logical lines report their exact wrapped-row count",
);

const emoji = "👩🏽‍🚀❤️‍🔥🏳️‍🌈";
assert.deepEqual(
	selectVisualPreview(emoji, 2, 1, "head"),
	{ rows: ["👩🏽‍🚀"], hiddenRows: 2, hiddenPosition: "later" },
	"wrapping preserves complete emoji grapheme clusters",
);

const partialItem = selectVisualItems(["abcdefghij", "second", "third"], (item) => item, 3, 2);
assert.equal(partialItem.rows.length, 2);
assert.equal(partialItem.hiddenItems, 2, "partially displayed item is not falsely counted as wholly hidden");
assert.equal(selectVisualItems(["abcdefghij"], (item) => item, 3, 2).hiddenItems, 0, "a partial final item leaves no hidden whole items");
assert.equal(selectVisualItems(["abcdefghij", "second"], (item) => item, 3, 2).hiddenItems, 1, "exactly one whole item after a partial item is counted once");

const boundary4001 = selectVisualPreview(Array.from({ length: 4_001 }, (_, index) => `row-${index}`).join("\n"), 80, 4_000, "head");
assert.equal(boundary4001.rows.length, 4_000);
assert.equal(boundary4001.hiddenRows, 1, "capture-backed expanded default caps only beyond 4,000 visual rows");

const long = "x".repeat(100_003);
const longTail = selectVisualPreview(long, 10, 3, "tail");
assert.deepEqual(longTail.rows, ["xxxxxxxxxx", "xxxxxxxxxx", "xxx"]);
assert.equal(longTail.hiddenRows, 9_998, "large previews count every wrapped row exactly");
assert.equal(longTail.hiddenPosition, "earlier");
assert.deepEqual(
	selectVisualPreview(long, 10, 0, "head"),
	{ rows: [], hiddenRows: 10_001, hiddenPosition: "later" },
	"a zero-row budget still reports the exact hidden count without retaining rows",
);

console.log("visual-preview: ok");
