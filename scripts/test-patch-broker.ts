import assert from "node:assert/strict";

import { PatchBroker } from "../extensions/adapters/tested-pi/patch-broker.ts";

const broker = new PatchBroker();
const parent = {};
const childA = {};
const childB = {};
const successor = {};
const childSuccessor = {};

const parentTool = broker.bind(parent, "tool", "parent-tool");
const parentContainer = broker.bind(parent, "container", "parent-container");
assert.equal(broker.active("tool"), "parent-tool");
assert.deepEqual(broker.inspect(), { owners: 1, retiring: 0, surfaces: 2 });

const childATool = broker.bind(childA, "tool", "child-a-tool");
const childBTool = broker.bind(childB, "tool", "child-b-tool");
assert.equal(broker.active("tool"), "parent-tool", "nested children cannot replace an active parent");
childATool.dispose();
assert.equal(broker.active("tool"), "parent-tool", "non-LIFO child teardown preserves the parent");

broker.offerSessionHandoff(parent, "parent-session");
broker.offerSessionHandoff(childB, "child-session");
broker.markRetiring(parent);
broker.markRetiring(childB);
assert.equal(broker.active("tool"), "parent-tool", "retiring parent remains the gap fallback ahead of a nested child");
const childSuccessorTool = broker.bind(childSuccessor, "tool", "child-successor-tool");
assert.equal(broker.claimSessionHandoff(childSuccessor, "child-session"), true);
assert.equal(broker.active("tool"), "parent-tool", "child successor cannot claim the parent rank");
const successorTool = broker.bind(successor, "tool", "successor-tool");
assert.equal(broker.claimSessionHandoff(successor, "parent-session"), true);
assert.equal(broker.active("tool"), "successor-tool", "parent successor reclaims its exact rank regardless of bind order");
childBTool.dispose();
childSuccessorTool.dispose();
assert.equal(broker.active("tool"), "successor-tool");

// Rebinding one owner/surface invalidates an older disposable for that value.
const replacement = broker.bind(successor, "tool", "successor-tool-2");
successorTool.dispose();
assert.equal(broker.active("tool"), "successor-tool-2");
replacement.dispose();
assert.equal(broker.active("tool"), "parent-tool", "retiring owner remains a final gap fallback");

parentTool.dispose();
assert.equal(broker.active("tool"), undefined);
assert.equal(broker.active("container"), "parent-container");
parentContainer.dispose();
broker.releaseOwner(parent);
broker.releaseOwner(childA);
broker.releaseOwner(childB);
broker.releaseOwner(successor);
broker.releaseOwner(childSuccessor);
assert.deepEqual(broker.inspect(), { owners: 0, retiring: 0, surfaces: 0 });

const reverse = new PatchBroker();
const reverseParent = {}, reverseChild = {}, reverseParentNext = {}, reverseChildNext = {};
reverse.bind(reverseParent, "reverse", "parent-old");
reverse.bind(reverseChild, "reverse", "child-old");
reverse.offerSessionHandoff(reverseParent, "reverse-parent");
reverse.offerSessionHandoff(reverseChild, "reverse-child");
reverse.markRetiring(reverseParent); reverse.markRetiring(reverseChild);
reverse.bind(reverseParentNext, "reverse", "parent-new");
reverse.claimSessionHandoff(reverseParentNext, "reverse-parent");
reverse.bind(reverseChildNext, "reverse", "child-new");
reverse.claimSessionHandoff(reverseChildNext, "reverse-child");
assert.equal(reverse.active("reverse"), "parent-new", "parent-first successor order is also deterministic");
for (const owner of [reverseParent, reverseChild, reverseParentNext, reverseChildNext]) reverse.releaseOwner(owner);
assert.deepEqual(reverse.inspect(), { owners: 0, retiring: 0, surfaces: 0 });

// Repeated reload-style replacement and overlapping child teardown stay
// bounded. This catches forgotten owner maps before real PTY tests make the
// leak visible as intermittent stale rendering.
let previous: object | undefined;
for (let generation = 0; generation < 100; generation++) {
	const owner = {};
	broker.bind(owner, "stress", generation);
	if (previous) {
		broker.markRetiring(previous);
		broker.releaseSurface(previous, "stress");
	}
	previous = owner;
	assert.ok(broker.inspect().owners <= 1);
}
if (previous) broker.releaseOwner(previous);
const children = Array.from({ length: 50 }, (_, index) => ({ owner: {}, index }));
for (const child of children) broker.bind(child.owner, "nested", child.index);
for (const child of [...children].reverse()) broker.releaseOwner(child.owner);
assert.deepEqual(broker.inspect(), { owners: 0, retiring: 0, surfaces: 0 });

console.log("patch broker tests passed");
