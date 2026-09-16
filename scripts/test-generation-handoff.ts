import assert from "node:assert/strict";
import { deferGenerationRelease } from "../extensions/lifecycle/generation-handoff.ts";

const ownerA = {};
const ownerB = {};
const state = { owner: ownerA, active: true };
deferGenerationRelease(() => { if (state.owner === ownerA) state.active = false; }, 10);
state.owner = ownerB;
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(state.active, true, "outgoing cleanup cannot clear a replacement generation");

const removed = { active: true };
deferGenerationRelease(() => { removed.active = false; }, 10);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(removed.active, false, "cleanup still runs when no replacement generation claims ownership");

console.log("generation handoff tests passed");
