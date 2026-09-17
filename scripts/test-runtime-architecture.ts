import assert from "node:assert/strict";
import { Loader } from "@earendil-works/pi-tui";

import { probeTestedPiCapabilities } from "../extensions/adapters/tested-pi/probes.ts";
import { buildActivationPlan } from "../extensions/runtime/activation-plan.ts";
import { detectHostDescriptor, parseProfilePreference, TESTED_PI_VERSIONS } from "../extensions/runtime/capabilities.ts";
import { registerSessionEvents } from "../extensions/lifecycle/session-events.ts";
import { RuntimeHandle } from "../extensions/runtime/runtime-handle.ts";

assert.equal(parseProfilePreference(undefined), "auto");
assert.equal(parseProfilePreference(" PORTABLE "), "portable");
assert.equal(parseProfilePreference("future-value"), "auto");
assert.deepEqual(TESTED_PI_VERSIONS, ["0.74.0", "0.80.6", "0.85.1"]);

const testedHost = detectHostDescriptor({ piVersion: "0.85.1", preserveCurrentBehavior: false });
assert.equal(testedHost.profile, "tested-pi");
assert.equal(testedHost.selectionReason, "exact-tested-version");
const testedPlan = buildActivationPlan(testedHost, undefined);
assert.equal(testedPlan.featureEnabled("toolPresentation"), true);
assert.equal(testedPlan.featureDecision("toolPresentation").reason, "default");

const portableHost = detectHostDescriptor({ piVersion: "99.0.0", profilePreference: "portable" });
assert.equal(portableHost.profile, "portable");
const portablePlan = buildActivationPlan(portableHost, undefined);
assert.equal(portablePlan.featureEnabled("toolPresentation"), false);
assert.equal(portablePlan.featureEnabled("scheduledTasks"), true, "portable profile keeps additive public-API tools");
assert.equal(portablePlan.featureEnabled("askUserQuestion"), true);
assert.equal(portablePlan.featureEnabled("toolPresentation"), false);
assert.equal(portablePlan.featureDecision("toolPresentation").reason, "missing-capability");

const completeProbe = probeTestedPiCapabilities({
	ToolExecutionComponent: { prototype: { hasRendererDefinition() {}, getCallRenderer() {}, getResultRenderer() {}, updateDisplay() {}, setExpanded() {} } },
	Container: { prototype: { render() {} } },
	AssistantMessageComponent: { prototype: { updateContent() {} } },
	UserMessageComponent: { prototype: { render() {} } },
	CustomMessageComponent: { prototype: { render() {} } },
	CompactionSummaryMessageComponent: { prototype: { updateDisplay() {} } },
	Loader: { prototype: { updateDisplay() {}, start() {}, stop() {} } },
});
assert.equal(completeProbe.failures.length, 0);
assert.equal(completeProbe.capabilities.has("tested:spinner-loader"), true);
const partialProbe = probeTestedPiCapabilities({ Container: { prototype: { render() {} } } });
assert.equal(partialProbe.capabilities.has("tested:container-composition"), true);
assert.equal(partialProbe.capabilities.has("tested:component-renderers"), false);
const partialHost = detectHostDescriptor({ piVersion: "0.85.1", observedCapabilities: partialProbe.capabilities });
const partialPlan = buildActivationPlan(partialHost, undefined);
assert.equal(partialPlan.featureEnabled("inspectionGroups"), true);
assert.equal(partialPlan.featureEnabled("toolPresentation"), false);
assert.equal(partialPlan.featureDecision("toolPresentation").reason, "missing-capability");

const disabledPlan = buildActivationPlan(testedHost, { features: { footer: false } });
assert.equal(disabledPlan.featureEnabled("footer"), false);
assert.equal(disabledPlan.featureDecision("footer").reason, "user-disabled");
assert.equal(disabledPlan.featureEnabled("banner"), true);

const disposalOrder: string[] = [];
const runtime = new RuntimeHandle("test");
assert.equal(runtime.state, "loading");
assert.equal(runtime.isCurrent(), true);
runtime.add(() => { disposalOrder.push("first"); });
runtime.add(async () => { disposalOrder.push("second"); });
assert.equal(runtime.activate(), true);
assert.equal(runtime.activate(), false);
assert.equal(runtime.beginRetirement("test complete"), true);
assert.equal(runtime.signal.aborted, true);
assert.equal(runtime.isCurrent(), false);
await runtime.dispose();
await runtime.dispose();
assert.equal(runtime.state, "disposed");
assert.deepEqual(disposalOrder, ["second", "first"]);
let disposedLate = false;
runtime.add(() => { disposedLate = true; });
await Promise.resolve();
assert.equal(disposedLate, true);

const lifecycleEvents = new Map<string, Function>();
const lifecycleCalls: string[] = [];
let lifecycleCurrent = true;
registerSessionEvents({ on(name: string, handler: Function) { lifecycleEvents.set(name, handler); } } as any, {
	isCurrent: () => lifecycleCurrent,
	onSessionStart: () => lifecycleCalls.push("start"),
	onTurnStart: () => lifecycleCalls.push("turn-start"),
	installDeferred: () => lifecycleCalls.push("deferred"),
	discoverTools: () => lifecycleCalls.push("discover"),
	onTurnEnd: () => lifecycleCalls.push("turn-end"),
	onShutdown: () => lifecycleCalls.push("shutdown"),
});
await lifecycleEvents.get("session_start")?.({ reason: "startup" }, {});
assert.deepEqual(lifecycleCalls, ["start", "deferred", "discover"]);
lifecycleCurrent = false;
await lifecycleEvents.get("before_agent_start")?.({}, {});
await lifecycleEvents.get("turn_start")?.({}, {});
await lifecycleEvents.get("turn_end")?.({}, {});
assert.deepEqual(lifecycleCalls, ["start", "deferred", "discover"], "retired runtime ignores stale non-shutdown callbacks");
await lifecycleEvents.get("session_shutdown")?.({ reason: "reload" }, {});
assert.equal(lifecycleCalls.at(-1), "shutdown", "shutdown always reaches the owning runtime exactly once");

// A forced portable generation must be a true native pass-through: invoking
// the package entry point performs no registration and touches no Pi method.
const oldProfile = process.env.PI_CLAUDIFY_PROFILE;
process.env.PI_CLAUDIFY_PROFILE = "portable";
try {
	const extension = await import(`../extensions/index.ts?portable-runtime-test=${Date.now()}`);
	const tools = new Map<string, any>();
	const events = new Map<string, Function[]>();
	const fakePi = {
		registerTool(definition: any) { tools.set(definition.name, definition); },
		getAllTools() { return [...tools.values()]; },
		on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); },
		sendUserMessage() {},
	};
	extension.default(fakePi as any);
	for (const handler of events.get("session_start") ?? []) await handler({}, { mode: "tui", hasUI: true, ui: {}, isProjectTrusted: () => false });
	for (const name of ["CronCreate", "CronList", "CronDelete", "AskUserQuestion"]) assert.equal(tools.has(name), true, `${name} remains available through portable public APIs`);
	const { testedPiPatchBroker } = await import("../extensions/adapters/tested-pi/patch-broker.ts");
	assert.deepEqual(testedPiPatchBroker.inspect(), { owners: 0, retiring: 0, surfaces: 0 }, "portable mode installs no tested-Pi broker binding");

	const before = {
		updateDisplay: (Loader.prototype as any).updateDisplay,
		start: Loader.prototype.start,
		stop: Loader.prototype.stop,
	};
	await import(`../extensions/spinner.ts?portable-runtime-test=${Date.now()}`);
	assert.equal((Loader.prototype as any).updateDisplay, before.updateDisplay);
	assert.equal(Loader.prototype.start, before.start);
	assert.equal(Loader.prototype.stop, before.stop);
} finally {
	if (oldProfile === undefined) delete process.env.PI_CLAUDIFY_PROFILE;
	else process.env.PI_CLAUDIFY_PROFILE = oldProfile;
}

console.log("runtime architecture tests passed");
