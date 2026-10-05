import assert from "node:assert/strict";

import {
	collapsedHint,
	nonBlankLines,
	parseDetached,
	parseDetachedIdentity,
	settledVerdict,
} from "../extensions/render/grammar.verdict.ts";

// --- Settled verdicts mirror the settled-bash chrome exactly ---------------

assert.deepEqual(settledVerdict({ isError: false, exitCode: null, lineCount: 2 }), [
	{ text: "Done", tone: "success" },
	{ text: " (2 lines)", tone: "muted" },
]);
assert.deepEqual(settledVerdict({ isError: false, exitCode: null, lineCount: 2, kind: "read" }), [
	{ text: "Read", tone: "success" },
	{ text: " 2 lines", tone: "muted" },
]);
assert.deepEqual(settledVerdict({ isError: false, exitCode: null, lineCount: 1, kind: "read" }), [
	{ text: "Read", tone: "success" },
	{ text: " 1 line", tone: "muted" },
]);
assert.deepEqual(settledVerdict({ isError: true, exitCode: 3, lineCount: 1 }), [
	{ text: "Exit 3", tone: "error" },
]);
assert.deepEqual(settledVerdict({ isError: true, exitCode: null, lineCount: 0 }), [
	{ text: "Failed", tone: "error" },
]);

// --- Collapsed hint: muted, keyboard-only, suppressible ---------------------

assert.deepEqual(collapsedHint(false), [{ text: " (ctrl+o to expand)", tone: "muted" }]);
assert.deepEqual(collapsedHint(true), []);

// --- Blank lines carry no content -------------------------------------------

assert.deepEqual(nonBlankLines("a\n\n  \nb"), ["a", "b"]);

// --- Detached parsing: outcome authoritative, text pair gated --------------

assert.deepEqual(parseDetached({ outcome: "detached-background" }, "plain"), {
	outcome: "detached-background",
});
assert.deepEqual(
	parseDetached(undefined, "Started in background.\njob_id: a1b2c3\nlog_path: /tmp/x.out", true),
	{ outcome: undefined, jobId: "a1b2c3", logPath: "/tmp/x.out" },
);
assert.equal(
	parseDetached(undefined, "Started in background.\njob_id: a1b2c3\nlog_path: /tmp/x.out", false),
	undefined,
	"text pair alone never detaches without background params",
);
assert.deepEqual(parseDetachedIdentity("output mentions\njob_id: a1b2c3\nbut no log path"), {});
assert.deepEqual(parseDetachedIdentity("job_id: xyz\nlog_path: /tmp/x.out"), {
	jobId: undefined,
	logPath: "/tmp/x.out",
});

console.log("grammar verdict tests passed");
