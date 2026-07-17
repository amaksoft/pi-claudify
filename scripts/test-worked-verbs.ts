import assert from "node:assert/strict";

const {
	DEFAULT_WORKED_VERBS,
	formatWorkedLine,
	resolveWorkedVerbs,
	sanitizeWorkedVerbs,
} = await import("../extensions/message-chrome.ts");

const custom = sanitizeWorkedVerbs(["Hacked", "Tinkered", "Cooked up a storm", "hacked"]);
assert.deepEqual(custom, ["Hacked", "Tinkered", "Cooked up a storm"], "custom worked verbs preserve phrases and reject case-insensitive duplicates");

const replacePool = resolveWorkedVerbs(custom, "replace");
assert.deepEqual(replacePool, custom, "replace mode draws only from custom worked verbs");
assert.equal(formatWorkedLine(8000, { seed: 0, verbs: replacePool }), "✻ Hacked for 8s");
assert.equal(formatWorkedLine(8000, { seed: 2, verbs: replacePool }), "✻ Cooked up a storm for 8s");

const appendPool = resolveWorkedVerbs(custom, "append");
assert.ok(appendPool.includes(DEFAULT_WORKED_VERBS[0]), "append mode retains the built-in pool");
assert.ok(appendPool.includes("Cooked up a storm"), "append mode includes custom multi-word phrases");
assert.deepEqual(custom, ["Hacked", "Tinkered", "Cooked up a storm"], "resolving a pool does not mutate the stored custom verbs");

assert.deepEqual(resolveWorkedVerbs(undefined, "append"), DEFAULT_WORKED_VERBS, "an unset custom pool falls back to built-in worked verbs");
assert.deepEqual(resolveWorkedVerbs([], "replace"), DEFAULT_WORKED_VERBS, "an empty replace pool safely falls back to built-in worked verbs");

// A custom verb must be reachable in append mode (it lands after the built-in pool).
assert.equal(
	formatWorkedLine(8000, { seed: DEFAULT_WORKED_VERBS.length, verbs: appendPool }),
	"✻ Hacked for 8s",
	"append mode reaches the first custom verb at index DEFAULT_WORKED_VERBS.length",
);

// CLFY-24 regression: appendWorkedDurationLine must thread its seed through to the
// verb, not drop it. The seedless production call pinned every turn to pool[0]
// ("Cooked"). Inject a known pool so this is deterministic regardless of settings.
const { appendWorkedDurationLine } = await import("../extensions/index.ts");
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const workedVerbOf = (seed: number): string => {
	const message = { role: "assistant", content: [{ type: "text", text: "body" }] };
	appendWorkedDurationLine(message, 8000, seed, ["Alpha", "Beta", "Gamma"]);
	const m = stripAnsi(message.content[0].text).match(/✻ (\w+) for/);
	return m ? m[1] : "";
};
assert.equal(workedVerbOf(0), "Alpha", "seed 0 selects pool[0]");
assert.equal(workedVerbOf(1), "Beta", "seed 1 selects pool[1] — the seed is threaded, not dropped");
assert.notEqual(workedVerbOf(0), workedVerbOf(1), "different per-turn seeds yield different worked verbs");
assert.equal(workedVerbOf(5), "Gamma", "seed 5 wraps to pool[5 % 3] — modulo rotation, not a pinned index");

// A large real-world start timestamp still rotates and stays stable on repaint.
const t1 = 1_700_000_000_000;
assert.equal(workedVerbOf(t1), workedVerbOf(t1), "the same start seed is stable across repaints");
assert.notEqual(workedVerbOf(t1), workedVerbOf(t1 + 1), "adjacent-turn timestamps can still differ");

console.log("worked verbs tests passed");
