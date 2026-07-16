import assert from "node:assert/strict";

// The Plane Sync CI parser. Importing does not run main() — that is guarded by
// an `import.meta` / argv check in the script.
// @ts-ignore - plain .mjs CI script, no type declarations
const { extractClosingReferences, stripCode } = await import("../.forgejo/scripts/close-plane-issues.mjs");

// --- Real closing directives (plain prose) are extracted ---------------------
assert.deepEqual(
	extractClosingReferences(["Closes CLFY-8."]),
	["CLFY-8"],
	"a plain-prose closing directive is extracted",
);
assert.deepEqual(
	extractClosingReferences(["Fixes CLFY-3, CLFY-4 and CLFY-5"]),
	["CLFY-3", "CLFY-4", "CLFY-5"],
	"a multi-item directive extracts every identifier",
);
assert.deepEqual(
	extractClosingReferences(["resolved: clfy-12"]),
	["CLFY-12"],
	"magic words and identifiers are case-insensitive",
);

// --- A bare mention without a magic word is ignored --------------------------
assert.deepEqual(
	extractClosingReferences(["mentions CLFY-9 without a magic word"]),
	[],
	"an identifier with no magic word is not a closing reference",
);

// --- Directives inside code spans/blocks are NOT actioned (the #27 bug) ------
assert.deepEqual(
	extractClosingReferences(["Use `Closes CLFY-8` in the PR body"]),
	[],
	"an inline-code example is ignored",
);
assert.deepEqual(
	extractClosingReferences(["```\nFixes CLFY-3, CLFY-4\n```"]),
	[],
	"a fenced-code example is ignored",
);
// The exact prose that made PR #27 wrongly close CLFY-12: every example was in
// backticks, so a fixed parser must extract nothing from it.
const pr27Body = [
	"Merging a PR whose body says `Closes CLFY-N` transitions that item to Done.",
	"unit-checked against `Closes CLFY-8`, multi-ref `Fixes CLFY-3, CLFY-4 and CLFY-5`,",
	"lowercase `resolved: clfy-12`, and a cross-project `SIM-2`.",
].join("\n");
assert.deepEqual(
	extractClosingReferences([pr27Body]),
	[],
	"PR #27's documentation body closes nothing once code spans are stripped",
);

// --- A real directive still wins even when examples sit beside it ------------
assert.deepEqual(
	extractClosingReferences(["Closes CLFY-14. Example syntax: `Closes CLFY-99`."]),
	["CLFY-14"],
	"a real prose directive is kept while a backticked example is dropped",
);

// --- stripCode leaves ordinary prose intact ----------------------------------
assert.equal(stripCode("plain text CLFY-1"), "plain text CLFY-1", "prose outside code is untouched");

console.log("plane-refs: ok");
