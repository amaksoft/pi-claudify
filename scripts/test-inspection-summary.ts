import assert from "node:assert/strict";

import { describeInspectionsActive, describeInspectionsDone } from "../extensions/inspection-summary.ts";

import { useSandboxHome } from "./sandbox-home.ts";

// Assert default rendering, not the settings of whoever runs the suite.
useSandboxHome("cc-inspection");

// Verbatim from a live Claude Code v2.1.207 capture — see
// docs/plans/2026-07-13-current-cc-grammar.md.
assert.equal(
	describeInspectionsActive(["read", "grep", "read", "bash"]),
	"Searching for 1 pattern, reading 2 files, running 1 shell command…",
);

assert.equal(
	describeInspectionsDone(["read", "bash"]),
	"Read 1 file, ran 1 shell command",
);

// Single kind, singular and plural.
assert.equal(describeInspectionsActive(["read"]), "Reading 1 file…");
assert.equal(describeInspectionsActive(["read", "read"]), "Reading 2 files…");
assert.equal(describeInspectionsActive(["bash"]), "Running 1 shell command…");
assert.equal(describeInspectionsDone(["read"]), "Read 1 file");

// Clause order is fixed regardless of call order.
assert.equal(
	describeInspectionsActive(["bash", "read", "grep"]),
	describeInspectionsActive(["grep", "read", "bash"]),
);
assert.equal(
	describeInspectionsActive(["ls", "read"]),
	"Reading 1 file, listing 1 directory…",
);

// "directories", not "directorys".
assert.equal(describeInspectionsActive(["ls", "ls"]), "Listing 2 directories…");
assert.equal(describeInspectionsActive(["ls"]), "Listing 1 directory…");

assert.equal(describeInspectionsActive([]), "");
assert.equal(describeInspectionsDone([]), "");

console.log("inspection summary tests passed");
