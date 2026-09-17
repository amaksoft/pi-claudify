import assert from "node:assert/strict";

import { partitionTranscriptRuns } from "../extensions/domain/transcript-groups.ts";

type Item = { id: string; type: "tool" | "empty" | "visible" };
const values: Item[] = [
	{ id: "leading-empty", type: "empty" },
	{ id: "a", type: "tool" },
	{ id: "between", type: "empty" },
	{ id: "b", type: "tool" },
	{ id: "thinking", type: "visible" },
	{ id: "c", type: "tool" },
	{ id: "trailing", type: "empty" },
];
const segments = partitionTranscriptRuns(values, {
	isEligible: (value) => value.type === "tool",
	isTransparent: (value) => value.type === "empty",
});
assert.deepEqual(
	segments.map((segment) => segment.kind === "boundary"
		? ["boundary", segment.value.id]
		: ["group", segment.members.map((member) => member.id), segment.trailingTransparent.map((member) => member.id)]),
	[
		["boundary", "leading-empty"],
		["group", ["a", "b"], ["between"]],
		["boundary", "thinking"],
		["group", ["c"], ["trailing"]],
	],
);
assert.deepEqual(partitionTranscriptRuns([], { isEligible: () => true, isTransparent: () => true }), []);
assert.throws(() => partitionTranscriptRuns(values, { isEligible: () => { throw new Error("classification failed"); }, isTransparent: () => false }), /classification failed/);

console.log("semantic transcript grouping tests passed");
