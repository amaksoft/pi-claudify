import assert from "node:assert/strict";

import {
	DEFAULT_USER_PREFIX,
	formatTranscriptLines,
	formatWorkedLine,
	isWorkedLine,
	resolveMessageChromeSettings,
	resolveWorkedVerbs,
	sanitizeWorkedVerbs,
} from "../extensions/message-chrome.ts";

// Grammar target: docs/plans/2026-07-13-current-cc-grammar.md
// Claude Code puts the bullet at column 0 and aligns wrapped lines two columns
// in, under the body text. There is no leading space before the glyph.

const comfortable = formatTranscriptLines([
	"",
	"Pushed b0e53030. Let me verify the macOS check no longer sits pending on the new commit:",
	"continued wrap",
	"",
	"",
	"Still pending — but that may be transitional.",
	"",
], {
	prefix: "⏺",
	spacing: "comfortable",
});

assert.deepEqual(comfortable, [
	"⏺ Pushed b0e53030. Let me verify the macOS check no longer sits pending on the new commit:",
	"  continued wrap",
	"  ",
	"  Still pending — but that may be transitional.",
]);

const compact = formatTranscriptLines(["First", "", "", "Second"], {
	prefix: "✻",
	spacing: "compact",
});

assert.deepEqual(compact, [
	"✻ First",
	"  Second",
]);

// User messages reuse the same grammar with ❯ — no box, no leading space.
assert.deepEqual(formatTranscriptLines(["Work on SIM-174.", "second line"], {
	prefix: DEFAULT_USER_PREFIX,
	spacing: "comfortable",
}), [
	"❯ Work on SIM-174.",
	"  second line",
]);

assert.equal(DEFAULT_USER_PREFIX, "❯");

// Assistant default is ⏺ — the same glyph as tool rows, not ●.
assert.deepEqual(resolveMessageChromeSettings({
	messageStyle: "classic",
	assistantPrefix: "",
	thinkingPrefix: "thinking[31m",
	messageSpacing: "wide",
}), {
	messageStyle: "classic",
	assistantPrefix: "⏺",
	thinkingPrefix: "thinking",
	messageSpacing: "comfortable",
	hiddenThinkingLabel: "Thinking...",
});

// Wide glyphs still align: continuation matches the rendered prefix width.
assert.deepEqual(formatTranscriptLines(["Alpha", "Beta"], {
	prefix: "🚀",
	spacing: "comfortable",
	visibleWidth: (text) => text.includes("🚀") ? 3 : Array.from(text).length,
}), [
	"🚀 Alpha",
	"   Beta",
]);

// Worked line: playful past-tense verb + duration, e.g. "✻ Cooked for 8s".
assert.match(formatWorkedLine(8000, { seed: 0 }), /^✻ \S+ for 8s$/);

// Live state appends after a · separator: "✻ Sautéed for 11s · 1 shell still running"
assert.equal(
	formatWorkedLine(11_000, { seed: 0, suffix: "1 shell still running" }),
	`${formatWorkedLine(11_000, { seed: 0 })} · 1 shell still running`,
);

// Duration formatting matches Claude Code: 8s, 1m 25s.
assert.match(formatWorkedLine(85_000, { seed: 1 }), /^✻ \S+ for 1m 25s$/);

// A turn must not re-roll its verb on repaint: same seed, same verb.
assert.equal(formatWorkedLine(8000, { seed: 42 }), formatWorkedLine(8000, { seed: 42 }));

// --- Custom worked verbs -----------------------------------------------------
// Mirrors the spinnerVerbs contract: append (default) merges with the built-ins,
// replace uses only the custom list.

// "replace" uses only the custom verbs.
const onlyMine = resolveWorkedVerbs(["Yeeted", "Vibed"], "replace");
assert.deepEqual(onlyMine, ["Yeeted", "Vibed"]);
assert.equal(formatWorkedLine(8000, { seed: 0, verbs: onlyMine }), "✻ Yeeted for 8s");
assert.equal(formatWorkedLine(8000, { seed: 1, verbs: onlyMine }), "✻ Vibed for 8s");

// A single custom verb pins every turn to it.
assert.equal(formatWorkedLine(8000, { seed: 7, verbs: resolveWorkedVerbs(["Cooked up"], "replace") }), "✻ Cooked up for 8s");

// "append" keeps the built-ins and adds the custom ones.
const merged = resolveWorkedVerbs(["Yeeted"], "append");
assert.ok(merged.includes("Cooked"), "append keeps the default pool");
assert.ok(merged.includes("Yeeted"), "append adds the custom verb");

// Empty or missing custom lists fall back to the defaults, in either mode.
assert.ok(resolveWorkedVerbs([], "replace").includes("Cooked"));
assert.ok(resolveWorkedVerbs(null, "append").includes("Cooked"));

// Sanitizing: ANSI, control chars, blanks, non-strings and case-insensitive
// duplicates are all dropped.
assert.deepEqual(
	sanitizeWorkedVerbs(["  Brewed  ", "", "brewed", "[31mYeeted", 42, null]),
	["Brewed", "Yeeted"],
);
assert.deepEqual(sanitizeWorkedVerbs("not an array"), []);

// The worked line sits flush at column 0, not indented under the assistant text.
assert.deepEqual(
	formatTranscriptLines(["All done.", "", "✻ Cooked for 8s"], {
		prefix: "⏺",
		spacing: "comfortable",
		dedentWorkedLine: true,
	}),
	[
		"⏺ All done.",
		"  ",
		"✻ Cooked for 8s",
	],
);

// Without the flag it keeps the paragraph's continuation indent.
assert.deepEqual(
	formatTranscriptLines(["All done.", "✻ Cooked for 8s"], { prefix: "⏺", spacing: "comfortable" }),
	["⏺ All done.", "  ✻ Cooked for 8s"],
);

// Dedent must survive the color codes the worked line is wrapped in.
assert.deepEqual(
	formatTranscriptLines(["Done.", "[38;2;140;140;140m✻ Hacked for 3s[0m"], {
		prefix: "⏺",
		spacing: "comfortable",
		dedentWorkedLine: true,
	}),
	["⏺ Done.", "[38;2;140;140;140m✻ Hacked for 3s[0m"],
);

// A custom verb still reads as a worked line, so it gets stripped from model context.
assert.ok(isWorkedLine("✻ Yeeted for 8s"));
assert.ok(isWorkedLine("✻ Cooked up for 1m 25s"));
assert.ok(isWorkedLine("✻ Cooked for 11s · 1 shell still running"));
// Thinking rows share the ✻ glyph but are not worked lines.
assert.ok(!isWorkedLine("✻ Planning the next step"));

console.log("message chrome tests passed");
