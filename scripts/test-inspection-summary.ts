import assert from "node:assert/strict";

import { describeInspectionsActive, describeInspectionsDone, inspectionExtraLabels, registerInspectionLabelProvider } from "../extensions/inspection-summary.ts";

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

// Named bash variant (bg-shell displayName contract): single calls name the
// work, multiples keep the count and append up to two labels. Unlabeled
// calls keep the legacy count phrasing (CC parity).
assert.equal(describeInspectionsDone(["bash"], [], ["pytest auth"]), "Ran pytest auth");
assert.equal(describeInspectionsActive(["bash"], [], ["pytest auth"]), "Running pytest auth…");
assert.equal(
	describeInspectionsDone(["bash", "bash"], [], ["pytest auth", "build"]),
	"Ran 2 shell commands: pytest auth, build",
);
assert.equal(
	describeInspectionsDone(["bash", "bash", "bash"], [], ["a", "b", "c"]),
	"Ran 3 shell commands: a, b, …",
);
assert.equal(
	describeInspectionsDone(["bash", "bash"], [], ["sleep 30s", "sleep 30s"]),
	"Ran 2 shell commands: sleep 30s ×2",
);
assert.equal(describeInspectionsDone(["bash"]), "Ran 1 shell command");
assert.equal(describeInspectionsDone(["read", "bash"], [], ["sleep 90s"]), "Read 1 file, ran sleep 90s");

assert.deepEqual(inspectionExtraLabels([{ name: "bash" }]), [], "no providers means no labels");
registerInspectionLabelProvider({ id: "track-a", labelsFor: () => ["a1", "a2"] });
registerInspectionLabelProvider({ id: "track-b", labelsFor: () => { throw new Error("boom"); } });
assert.deepEqual(inspectionExtraLabels([]), ["a1", "a2"], "providers compose in order and failures never blank the header");
assert.equal(
	describeInspectionsDone(["bash"], [], inspectionExtraLabels([])),
	"Ran 1 shell command: a1, a2",
	"composed labels flow through the unchanged describe grammar",
);
registerInspectionLabelProvider({ id: "track-a", labelsFor: () => ["solo"] });
assert.deepEqual(inspectionExtraLabels([]), ["solo"], "re-registration replaces by id instead of duplicating");

console.log("inspection summary tests passed");
