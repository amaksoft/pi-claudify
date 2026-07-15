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

console.log("worked verbs tests passed");
