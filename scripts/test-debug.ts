import assert from "node:assert/strict";

import { clearDebugDiagnosticsForTest, debugDiagnostic } from "../extensions/debug.ts";

const originalDebug = process.env.PI_CLAUDIFY_DEBUG;
const originalError = console.error;
const lines: string[] = [];
console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
try {
	delete process.env.PI_CLAUDIFY_DEBUG;
	clearDebugDiagnosticsForTest();
	debugDiagnostic("hidden", new Error("not shown"));
	assert.deepEqual(lines, [], "diagnostics are silent by default");

	process.env.PI_CLAUDIFY_DEBUG = "1";
	debugDiagnostic("host-probe", new Error("first"), "pi 0.85");
	debugDiagnostic("host-probe", new Error("second"), "pi 0.85");
	debugDiagnostic("other-probe", "third");
	assert.equal(lines.length, 2, "each diagnostic key emits at most once");
	assert.match(lines[0], /^\[claudify:host-probe\] \(pi 0\.85\) Error: first/);
	assert.match(lines[1], /^\[claudify:other-probe\] third/);
	debugDiagnostic("hostile\x1b(0\nkey", new Error("bad\x1b]8;;https://evil.test\x07body\x1b]8;;\x07"), "ctx\x1b[31m\nrow");
	assert.equal(lines.length, 3);
	assert.doesNotMatch(lines[2], /\x1b\(0|\x1b\[31m|https:\/\/evil\.test|\nrow/, "diagnostic key, context, and body are terminal-safe");
	assert.match(lines[2], /hostile key.*ctx row/);
} finally {
	console.error = originalError;
	if (originalDebug === undefined) delete process.env.PI_CLAUDIFY_DEBUG;
	else process.env.PI_CLAUDIFY_DEBUG = originalDebug;
	clearDebugDiagnosticsForTest();
}

console.log("debug diagnostic tests passed");
