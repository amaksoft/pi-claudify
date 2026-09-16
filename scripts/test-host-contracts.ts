import assert from "node:assert/strict";

import { releaseOwnedState, sharedState } from "../extensions/host/shared-state.ts";
import { ToolRegistrationCoordinator } from "../extensions/host/tool-registration.ts";
import { classifyToolOwner, readToolOwners, toolOwnershipSnapshot } from "../extensions/host/tool-ownership.ts";

const testKey = Symbol.for("pi-claudify:test-shared-state");
const first = sharedState(testKey, () => ({ owner: undefined as object | undefined, value: 1 }));
const second = sharedState(testKey, () => ({ owner: undefined as object | undefined, value: 2 }));
assert.equal(second, first, "hot-reloaded modules resolve the same process state");
assert.equal(second.value, 1);
const ownerA = {};
const ownerB = {};
first.owner = ownerA;
assert.equal(releaseOwnedState(first, ownerB, (state) => { state.value = 0; }), false, "stale generations cannot release a newer owner");
assert.equal(first.value, 1);
assert.equal(releaseOwnedState(first, ownerA, (state) => { state.value = 0; }), true);
assert.equal(first.value, 0);
assert.equal(first.owner, undefined);

assert.equal(classifyToolOwner({ sourceInfo: { source: "builtin", path: "<builtin:edit>" } }), "builtin");
assert.equal(classifyToolOwner({ sourceInfo: { source: "extension:pi-claudify", path: "/pkg/pi-claudify/index.ts" } }), "self");
assert.equal(classifyToolOwner({ sourceInfo: { source: "extension:remote", path: "/remote/edit.ts" } }), "external");
assert.equal(classifyToolOwner({}), "unknown");
const owners = readToolOwners(() => [
	{ name: "EDIT", sourceInfo: { source: "builtin", path: "<builtin:edit>" } },
	{ name: "grep", sourceInfo: { source: "extension:remote", path: "/remote/grep.ts" } },
]);
assert.equal(owners?.get("edit"), "builtin", "ownership keys normalize to lowercase");
assert.equal(owners?.get("grep"), "external");
let observedError: unknown;
assert.equal(readToolOwners(() => { throw new Error("registry unavailable"); }, (error) => { observedError = error; }), null);
assert.match(String(observedError), /registry unavailable/);
const snapshot = toolOwnershipSnapshot();
assert.ok(snapshot instanceof Map, "ownership snapshots use process-stable shared state");

const registered: string[] = [];
const live = new ToolRegistrationCoordinator<any>(
	{
		registerTool: (definition) => registered.push(definition.name),
		getAllTools: () => [
			{ name: "alpha", sourceInfo: { source: "builtin", path: "<builtin:alpha>" } },
			{ name: "beta", sourceInfo: { source: "extension:remote", path: "/remote/beta.ts" } },
		],
	},
	{ skipped: new Set() },
);
live.add({ name: "alpha" });
live.add({ name: "beta" });
assert.deepEqual(registered, ["alpha"], "factory registration replaces proven builtins but preserves external owners");

snapshot.set("gamma", "builtin");
const eager: string[] = [];
const reloaded = new ToolRegistrationCoordinator<any>(
	{
		registerTool: (definition) => eager.push(definition.name),
		getAllTools: () => { throw new Error("not bound during factory"); },
	},
	{ skipped: new Set() },
);
reloaded.add({ name: "gamma" });
assert.deepEqual(eager, ["gamma"], "a prior proven builtin is restored eagerly before transcript reconstruction");

const unknownWarnings: string[] = [];
const unknown = new ToolRegistrationCoordinator<any>(
	{ registerTool: () => { throw new Error("unknown ownership must not register"); } },
	{ skipped: new Set() },
);
unknown.add({ name: "delta" });
unknown.installDeferred((message) => unknownWarnings.push(message));
unknown.installDeferred((message) => unknownWarnings.push(message));
assert.equal(unknownWarnings.length, 1, "unknown ownership fails closed with one visible warning");
assert.match(unknownWarnings[0], /delta/);

console.log("host contract tests passed");
