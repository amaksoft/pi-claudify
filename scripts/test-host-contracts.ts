import assert from "node:assert/strict";
import { join } from "node:path";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { installContainerRenderPatch, releaseContainerRenderPatch } from "../extensions/host/container-render-patch.ts";
import { patchCustomMessageRenderer, releaseMessageRenderers } from "../extensions/host/message-patches.ts";
import { patchMethodOnce } from "../extensions/host/patch-once.ts";
import { releaseOwnedState, sharedState } from "../extensions/host/shared-state.ts";
import {
	genericToolLabel,
	isMcpToolCandidate,
	isMcpToolName,
	mcpOriginalName,
	mcpToolServer,
	noteMcpTool,
	resetToolDiscovery,
} from "../extensions/host/tool-discovery.ts";
import { installToolFallbackSanitization, releaseToolFallbackSanitization } from "../extensions/host/tool-component-patches.ts";
import { ToolRegistrationCoordinator } from "../extensions/host/tool-registration.ts";
import { createThemeOrchestrator } from "../extensions/host/theme-orchestrator.ts";
import { classifyToolOwner, claudifySourceRoot, readToolOwners, toolOwnershipSnapshot } from "../extensions/host/tool-ownership.ts";

const patchFlag = Symbol("test-patch");
const patchTarget = { value: 1, read(this: { value: number }) { return this.value; } } as any;
assert.equal(patchMethodOnce(patchTarget, patchFlag, "read", (original) => function (this: any) { return original.call(this) + 1; }), true);
assert.equal(patchTarget.read(), 2);
assert.equal(patchMethodOnce(patchTarget, patchFlag, "read", () => () => 99), false, "patch installation is idempotent");
assert.equal(patchTarget.read(), 2);

class FakeCustomMessage { render(): string[] { return ["payload"]; } }
const customFlag = Symbol.for("pi-claudify:test-custom-message-patch");
const customOwner = {};
patchCustomMessageRenderer(FakeCustomMessage, customFlag, customOwner, (line) => `old:${line}`);
assert.deepEqual(new FakeCustomMessage().render(), ["old:payload"]);
patchCustomMessageRenderer(FakeCustomMessage, customFlag, customOwner, (line) => `new:${line}`);
assert.deepEqual(new FakeCustomMessage().render(), ["new:payload"], "one-shot prototype patches use the newest reload-generation delegate");
const nestedCustomOwner = {};
patchCustomMessageRenderer(FakeCustomMessage, customFlag, nestedCustomOwner, (line) => `child:${line}`);
assert.deepEqual(new FakeCustomMessage().render(), ["new:payload"], "nested child message patches do not replace the active parent runtime");
releaseMessageRenderers(nestedCustomOwner);
assert.deepEqual(new FakeCustomMessage().render(), ["new:payload"], "child message teardown restores the parent runtime");
releaseMessageRenderers(customOwner);

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

const nestedParentOwner = {};
const nestedChildOwner = {};
installContainerRenderPatch([], nestedParentOwner, () => [], {} as any);
installContainerRenderPatch([], nestedChildOwner, () => [], {} as any);
releaseContainerRenderPatch(nestedChildOwner);
const containerOwners = (globalThis as any)[Symbol.for("pi-claudify:global-render-state")]?.owners as Map<object, unknown>;
assert.equal(containerOwners.has(nestedParentOwner), true, "child container teardown preserves the parent owner");
releaseContainerRenderPatch(nestedParentOwner);
installToolFallbackSanitization(nestedParentOwner);
installToolFallbackSanitization(nestedChildOwner);
releaseToolFallbackSanitization(nestedChildOwner);
const fallbackRegistry = (ToolExecutionComponent.prototype as any)[Symbol.for("pi-claudify:patched-tool-fallback-sanitize")];
assert.equal(fallbackRegistry.owners.has(nestedParentOwner), true, "child fallback-sanitizer teardown preserves the parent owner");
releaseToolFallbackSanitization(nestedParentOwner);

assert.equal(classifyToolOwner({ sourceInfo: { source: "builtin", path: "<builtin:edit>" } }), "builtin");
assert.equal(classifyToolOwner({ sourceInfo: { source: "extension:pi-claudify", path: "/pkg/pi-claudify/index.ts" } }), "self");
assert.equal(classifyToolOwner({ sourceInfo: { source: claudifySourceRoot(), path: join(claudifySourceRoot(), "extensions", "index.ts") } }), "self", "self ownership follows the actual module root regardless of checkout basename");
assert.equal(classifyToolOwner({ sourceInfo: { source: "extension:remote", path: "/remote/edit.ts" } }), "external");
assert.equal(classifyToolOwner({ sourceInfo: { source: "extension:remote", path: "/plugins/not-pi-claudify-clone/edit.ts" } }), "external", "package identity requires a path/source token boundary");
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
const unknownRegistered: string[] = [];
const unknownOwner = new ToolRegistrationCoordinator<any>(
	{
		registerTool: (definition) => unknownRegistered.push(definition.name),
		getAllTools: () => [{ name: "mystery", execute: () => "external" }],
	},
	{ skipped: new Set() },
);
unknownOwner.add({ name: "mystery", execute: () => "claudify" });
assert.deepEqual(unknownRegistered, [], "factory registration preserves an existing tool whose ownership metadata is unknown");
const absentRegistered: string[] = [];
const absentOwner = new ToolRegistrationCoordinator<any>(
	{ registerTool: (definition) => absentRegistered.push(definition.name), getAllTools: () => [] },
	{ skipped: new Set() },
);
absentOwner.add({ name: "new_tool" });
assert.deepEqual(absentRegistered, ["new_tool"], "factory registration may add a tool name that is genuinely absent");
let deferredRegistryReady = false;
const deferredRegistered: string[] = [];
const deferredAbsent = new ToolRegistrationCoordinator<any>(
	{
		registerTool: (definition) => deferredRegistered.push(definition.name),
		getAllTools: () => { if (!deferredRegistryReady) throw new Error("runtime not initialized"); return []; },
	},
	{ skipped: new Set() },
);
deferredAbsent.add({ name: "new_deferred_tool" });
deferredRegistryReady = true;
const deferredWarnings: string[] = [];
deferredAbsent.installDeferred((message) => deferredWarnings.push(message));
assert.deepEqual(deferredRegistered, ["new_deferred_tool"], "a name absent from the initialized registry is safe to register after factory deferral");
assert.deepEqual(deferredWarnings, [], "genuine absence is not reported as unknown ownership");
const ownedName = "claudify_owned_without_source_info";
let ownedTools: any[] = [];
const firstOwnedGeneration = new ToolRegistrationCoordinator<any>(
	{ registerTool: (definition) => { ownedTools = [definition]; }, getAllTools: () => ownedTools },
	{ skipped: new Set() },
);
firstOwnedGeneration.add({ name: ownedName, execute: () => "claudify" });
firstOwnedGeneration.installDeferred();
assert.equal(toolOwnershipSnapshot().get(ownedName), "self", "successful registration proves self ownership even when the host omits sourceInfo");
let registryReady = false;
const reloadedOwned: string[] = [];
const secondOwnedGeneration = new ToolRegistrationCoordinator<any>(
	{
		registerTool: (definition) => reloadedOwned.push(definition.name),
		getAllTools: () => { if (!registryReady) throw new Error("registry not bound during factory"); return ownedTools; },
	},
	{ skipped: new Set() },
);
registryReady = true;
secondOwnedGeneration.add({ name: ownedName, execute: () => "new generation" });
const ownedWarnings: string[] = [];
secondOwnedGeneration.installDeferred((message) => ownedWarnings.push(message));
assert.deepEqual(reloadedOwned, [ownedName], "reload eagerly restores a previously proven Claudify-owned custom tool");
assert.deepEqual(ownedWarnings, [], "missing host sourceInfo does not produce a false ownership warning for Claudify-owned tools");
const renamedCheckoutRegistrations: string[] = [];
const renamedCheckoutReload = new ToolRegistrationCoordinator<any>(
	{
		registerTool: (definition) => renamedCheckoutRegistrations.push(definition.name),
		getAllTools: () => [{ name: ownedName, sourceInfo: { source: claudifySourceRoot(), path: join(claudifySourceRoot(), "extensions", "index.ts") } }],
	},
	{ skipped: new Set() },
);
renamedCheckoutReload.add({ name: ownedName, execute: () => "latest generation" });
assert.deepEqual(renamedCheckoutRegistrations, [ownedName], "live self-owned tools re-register from a checkout with any basename");
const metadataOnlyToolInfo = { name: "restore_tool", sourceInfo: { source: "extension:pi-claudify", path: "/pkg/pi-claudify/index.ts" } };
const skippedRegistrations: any[] = [];
const disabledAfterReload = new ToolRegistrationCoordinator<any>(
	{ registerTool: (definition) => skippedRegistrations.push(definition), getAllTools: () => [metadataOnlyToolInfo] },
	{ skipped: new Set(["restore_tool"]) },
);
disabledAfterReload.add({ name: "restore_tool", execute: () => "new-claudify" });
assert.deepEqual(skippedRegistrations, [], "metadata-only ToolInfo is never re-registered as an executable definition");

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

resetToolDiscovery();
const directMcp = { name: "plane_get_me", label: "MCP: get_me" };
assert.equal(isMcpToolCandidate(directMcp), true);
noteMcpTool(directMcp);
assert.equal(isMcpToolName("plane_get_me"), true);
assert.equal(mcpToolServer("plane_get_me"), "plane");
assert.equal(mcpOriginalName("plane_get_me"), "get_me");
assert.equal(genericToolLabel("plane_get_me"), "MCP");
resetToolDiscovery();
assert.equal(isMcpToolName("plane_get_me"), false, "session reset bounds discovered MCP state");

let polarity: "dark" | "light" = "dark";
let liveDiffColors = { fgAdd: "dark-add", fgDel: "dark-del", fgCtx: "dark-ctx" };
const themeOrchestrator = createThemeOrchestrator({
	themeColorsEnabled: () => true,
	applyAccentOverride() {},
	themePolarity: () => polarity,
	applyStatusDotPalette() {},
	applyImmediateDiffPalette: () => {
		liveDiffColors = polarity === "dark"
			? { fgAdd: "dark-add", fgDel: "dark-del", fgCtx: "dark-ctx" }
			: { fgAdd: "light-add", fgDel: "light-del", fgCtx: "light-ctx" };
	},
	themeAdaptiveEnabled: () => false,
	bumpDiffPresentationEpoch() {},
	safeFgAnsi: () => null,
	safeBgAnsi: () => null,
	applyThemeDerivedPalette() {},
	applyDiffPaletteState() {},
	isAutoDerivePending: () => false,
	autoDeriveBgFromTheme() {},
	markAutoDeriveApplied() {},
	getDiffColors: () => liveDiffColors,
	transparentReset: () => "",
});
assert.equal(themeOrchestrator.resolveDiffColors({}).fgAdd, "dark-add");
polarity = "light";
assert.equal(themeOrchestrator.resolveDiffColors({}).fgAdd, "light-add", "diff colors are read through a live getter after palette reassignment");

let themeEpochBumps = 0;
const sharedFgColors = new Map<string, string>();
const identityOrchestrator = createThemeOrchestrator({
	themeColorsEnabled: () => true,
	applyAccentOverride() {}, themePolarity: () => "dark", applyStatusDotPalette() {}, applyImmediateDiffPalette() {},
	themeAdaptiveEnabled: () => true, bumpDiffPresentationEpoch: () => { themeEpochBumps += 1; },
	safeFgAnsi: () => null, safeBgAnsi: () => null, applyThemeDerivedPalette() {}, applyDiffPaletteState() {},
	isAutoDerivePending: () => false, autoDeriveBgFromTheme() {}, markAutoDeriveApplied() {},
	getDiffColors: () => liveDiffColors, transparentReset: () => "",
});
identityOrchestrator.applyThemePaletteIfNeeded({ fgColors: sharedFgColors });
identityOrchestrator.applyThemePaletteIfNeeded(new Proxy({ fgColors: sharedFgColors }, {}));
assert.equal(themeEpochBumps, 1, "theme instances and forwarding proxies sharing fgColors use one palette-cache identity");
identityOrchestrator.resetThemeCache();
identityOrchestrator.applyThemePaletteIfNeeded({ fgColors: sharedFgColors });
assert.equal(themeEpochBumps, 2, "explicit theme-cache reset still forces re-derivation");

console.log("host contract tests passed");
