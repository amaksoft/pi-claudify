import assert from "node:assert/strict";

import { getActiveSessionDuration, getSessionMetrics, registerSessionMetrics, releaseSessionMetrics } from "../extensions/session-metrics.ts";

class FakePi {
	events = new Map<string, Array<(...args: any[]) => any>>();
	appended: Array<{ customType: string; data: any }> = [];
	on(name: string, handler: (...args: any[]) => any): void {
		this.events.set(name, [...(this.events.get(name) ?? []), handler]);
	}
	appendEntry(customType: string, data: any): void { this.appended.push({ customType, data }); }
	async emit(name: string, event: any, ctx: any): Promise<void> {
		for (const handler of this.events.get(name) ?? []) await handler(event, ctx);
	}
}

const assertCost = (actual: number, expected: number, message: string): void => {
	assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: expected ${expected}, got ${actual}`);
};

let now = Date.parse("2026-09-10T00:00:00.000Z");
const pi = new FakePi();
registerSessionMetrics(pi as any, undefined, { now: () => now });
registerSessionMetrics(pi as any, undefined, { now: () => now });
assert.equal(pi.events.get("session_start")?.length, 1, "registration is idempotent");

const branch = [
	{ type: "message", timestamp: "2026-09-08T10:00:00.000Z", message: { role: "user", content: [] } },
	{ type: "message", timestamp: "2026-09-08T10:00:02.000Z", message: { role: "assistant", usage: { cost: { total: 0.25 } } } },
	{ type: "custom", customType: "pi-claudify-active-time-v1", data: { durationMs: 1_250 } },
	{ type: "message", timestamp: "2026-09-08T10:00:04.000Z", message: { role: "user", content: [] } },
	{ type: "message", timestamp: "2026-09-08T10:00:06.000Z", message: { role: "assistant", usage: { cost: { total: 0.5 } } } },
	{ type: "message", timestamp: "2026-09-08T10:00:07.000Z", message: { role: "toolResult", usage: { cost: { total: 0.1 } } } },
	{ type: "custom", customType: "pi-claudify-active-time-v1", data: { durationMs: 2_750 } },
	{ type: "compaction", timestamp: "2026-09-08T10:00:08.000Z", usage: { cost: { total: 0.2 } } },
	{ type: "branch_summary", timestamp: "2026-09-08T10:00:09.000Z", usage: { cost: { total: 0.3 } } },
];
await pi.emit("session_start", {}, { sessionManager: { getBranch: () => branch } });
let metrics = getSessionMetrics();
assertCost(metrics.cost, 1.35, "resume seeds assistant, tool-result, compaction, and branch-summary cost");
assert.equal(metrics.costAvailable, true);
assert.equal(metrics.promptCount, 2, "resume seeds user prompt count");
assert.equal(metrics.startedAt, Date.parse("2026-09-08T10:00:00.000Z"), "legacy wall-clock mode retains the earliest branch timestamp");
assert.equal(metrics.activeMs, 4_000, "resume restores completed active spans from branch-local custom entries");
assert.equal(metrics.activeStartedAt, 0);

await pi.emit("agent_start", {}, {});
now += 2_000;
await pi.emit("agent_start", {}, {});
now += 500;
assert.equal(getActiveSessionDuration(now), 6_500, "retries and nested foreground work do not reset or multiply the active wall-clock span");
await pi.emit("agent_settled", {}, {});
assert.equal(getActiveSessionDuration(now), 6_500);
assert.equal(pi.appended.at(-1)?.customType, "pi-claudify-active-time-v2");
assert.equal(pi.appended.at(-1)?.data.kind, "complete");
assert.equal(pi.appended.at(-1)?.data.durationMs, 2_500);
now += 60_000;
assert.equal(getActiveSessionDuration(now), 6_500, "active time pauses completely while the parent session is idle");

await pi.emit("message_end", { message: { role: "assistant", usage: { cost: { total: 0.125 } } } }, {});
await pi.emit("message_end", { message: { role: "assistant" } }, {});
await pi.emit("message_end", { message: { role: "user" } }, {});
metrics = getSessionMetrics();
await pi.emit("message_end", { message: { role: "toolResult", usage: { cost: { total: 0.05 } } } }, {});
assertCost(metrics.cost, 1.475, "live assistant cost accumulates without inventing missing usage");
metrics = getSessionMetrics();
assertCost(metrics.cost, 1.525, "usage-bearing tool results contribute exactly once");
assert.equal(metrics.promptCount, 3, "one submitted user message adds one prompt");

const semanticBranch = [
	{ type: "message", id: "user-1", parentId: null, timestamp: "2026-09-09T10:00:00.000Z", message: { role: "user", content: [] } },
	{ type: "custom", id: "span-start", parentId: "user-1", timestamp: "2026-09-09T10:00:00.100Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "start", spanId: "span-1", startedAt: Date.parse("2026-09-09T10:00:00.100Z") } },
	{ type: "message", id: "assistant-1", parentId: "span-start", timestamp: "2026-09-09T10:00:02.100Z", message: { role: "assistant", content: [] } },
];
const semanticAll = [
	...semanticBranch,
	{ type: "custom", id: "span-complete", parentId: "assistant-1", timestamp: "2026-09-09T10:00:02.101Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "complete", spanId: "span-1", durationMs: 2_000 } },
	{ type: "custom", id: "span-duplicate", parentId: "assistant-1", timestamp: "2026-09-09T10:00:02.102Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "complete", spanId: "span-1", durationMs: 2_000 } },
	{ type: "custom", id: "span-invalid", parentId: "assistant-1", timestamp: "2026-09-09T10:00:02.103Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "complete", spanId: "span-invalid", durationMs: Number.MAX_VALUE } },
];
await pi.emit("session_tree", { newLeafId: "assistant-1" }, { sessionManager: { getBranch: () => semanticBranch, getEntries: () => semanticAll } });
assert.equal(getActiveSessionDuration(now), 2_000, "selecting or forking at the terminal assistant retains its associated completion exactly once");
const crashedBranch = [
	{ type: "custom", id: "crash-start", parentId: null, timestamp: "2026-09-09T11:00:00.000Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "start", spanId: "crash", startedAt: Date.parse("2026-09-09T11:00:00.000Z") } },
	{ type: "message", id: "crash-message", parentId: "crash-start", timestamp: "2026-09-09T11:00:00.750Z", message: { role: "assistant", content: [] } },
];
await pi.emit("session_tree", { newLeafId: "crash-message" }, { sessionManager: { getBranch: () => crashedBranch, getEntries: () => crashedBranch } });
assert.equal(getActiveSessionDuration(now), 750, "an unmatched start journal recovers a hard-crashed span conservatively through persisted activity");
const recoverySnapshot = pi.appended.at(-1)!;
crashedBranch.push({ type: "custom", id: "crash-snapshot", parentId: "crash-message", timestamp: "2026-09-09T11:00:00.751Z", ...recoverySnapshot });
crashedBranch.push({ type: "message", id: "later-user", parentId: "crash-snapshot", timestamp: "2026-09-09T12:00:00.000Z", message: { role: "user", content: [] } });
await pi.emit("session_tree", { newLeafId: "later-user" }, { sessionManager: { getBranch: () => crashedBranch, getEntries: () => crashedBranch } });
assert.equal(getActiveSessionDuration(now), 750, "later branch activity cannot grow a previously recovered crash span");
const metadataCrashBranch = [
	{ type: "custom", id: "meta-start", parentId: null, timestamp: "2026-09-09T12:30:00.000Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "start", spanId: "meta-crash", startedAt: Date.parse("2026-09-09T12:30:00.000Z") } },
	{ type: "message", id: "meta-assistant", parentId: "meta-start", timestamp: "2026-09-09T12:30:01.000Z", message: { role: "assistant", content: [] } },
	{ type: "custom", id: "unrelated-metadata", parentId: "meta-assistant", timestamp: "2026-09-10T12:30:01.000Z", customType: "unrelated-extension", data: {} },
];
await pi.emit("session_tree", { newLeafId: "unrelated-metadata" }, { sessionManager: { getBranch: () => metadataCrashBranch, getEntries: () => metadataCrashBranch } });
assert.equal(getActiveSessionDuration(now), 1_000, "unrelated extension metadata cannot inflate crash recovery");

const branchB = [
	{ type: "message", timestamp: "2026-09-09T12:00:00.000Z", message: { role: "user", content: [] } },
	{ type: "message", timestamp: "2026-09-09T12:00:01.000Z", message: { role: "assistant", usage: { cost: { total: 0.4 } } } },
	{ type: "custom", customType: "pi-claudify-active-time-v1", data: { durationMs: 1_200 } },
];
const branchContext = { sessionManager: { getBranch: () => branchB } };
await pi.emit("session_tree", { newLeafId: "branch-b" }, branchContext);
metrics = getSessionMetrics();
assertCost(metrics.cost, 0.4, "tree navigation rebases cost to the active branch");
assert.equal(metrics.promptCount, 1);
assert.equal(metrics.startedAt, Date.parse("2026-09-09T12:00:00.000Z"));
assert.equal(metrics.activeMs, 1_200, "tree navigation rebases active time to the selected branch");

now += 1_000;
await pi.emit("agent_start", {}, {});
const activeAnchor = getSessionMetrics().activeStartedAt;
const liveStart = pi.appended.at(-1)!;
branchB.push({ type: "custom", id: "branch-b-live-start", parentId: null, timestamp: new Date(now).toISOString(), ...liveStart });
now += 400;
branchB.push({ type: "compaction", timestamp: "2026-09-09T12:00:02.000Z", usage: { cost: { total: 0.2 } } });
await pi.emit("session_compact", { compactionEntry: branchB.at(-1) }, branchContext);
assertCost(getSessionMetrics().cost, 0.6, "successful compaction recomputes the active branch without double counting");
assert.equal(getSessionMetrics().activeStartedAt, activeAnchor, "mid-run compaction preserves the current active span anchor");
assert.equal(getSessionMetrics().activeMs, 1_200, "mid-run compaction does not recover and double-count the live start journal");
assert.equal(getActiveSessionDuration(now), 1_600);
await pi.emit("session_shutdown", { reason: "quit" }, branchContext);
assert.equal(pi.appended.at(-1)?.data.durationMs, 400, "shutdown checkpoints an unfinished foreground span exactly once");
assert.equal(getActiveSessionDuration(now), 0, "shutdown releases the retiring session's footer metrics");
releaseSessionMetrics();

const forkSourceOwner = {}, forkTargetOwner = {};
const forkSourcePi = new FakePi(), forkTargetPi = new FakePi();
const forkBranch = [
	{ type: "message", id: "fork-user", parentId: null, timestamp: "2026-09-09T13:00:00.000Z", message: { role: "user", content: [] } },
	{ type: "custom", id: "fork-start", parentId: "fork-user", timestamp: "2026-09-09T13:00:00.100Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "start", spanId: "fork-span", startedAt: Date.parse("2026-09-09T13:00:00.100Z") } },
	{ type: "message", id: "fork-assistant", parentId: "fork-start", timestamp: "2026-09-09T13:00:00.200Z", message: { role: "assistant", content: [] } },
];
const forkAll = [...forkBranch, { type: "custom", id: "fork-complete", parentId: "fork-assistant", timestamp: "2026-09-09T13:00:02.101Z", customType: "pi-claudify-active-time-v2", data: { version: 2, kind: "complete", spanId: "fork-span", durationMs: 2_000 } }];
const forkSourceContext = { sessionManager: { getSessionId: () => "fork-source", getSessionFile: () => undefined, getBranch: () => forkBranch, getEntries: () => forkAll } };
registerSessionMetrics(forkSourcePi as any, forkSourceOwner, { now: () => now });
await forkSourcePi.emit("session_start", { reason: "startup" }, forkSourceContext);
await forkSourcePi.emit("session_before_fork", { entryId: "fork-assistant", position: "at" }, forkSourceContext);
await forkSourcePi.emit("session_shutdown", { reason: "fork" }, forkSourceContext);
registerSessionMetrics(forkTargetPi as any, forkTargetOwner, { now: () => now });
await forkTargetPi.emit("session_start", { reason: "fork" }, { sessionManager: { getSessionId: () => "fork-target", getSessionFile: () => "/tmp/fork-session.jsonl", getBranch: () => forkBranch, getEntries: () => forkBranch } });
assert.equal(getActiveSessionDuration(now, forkTargetOwner), 2_000, "fork-at-assistant transfers the associated completion into the new session");
assert.equal(forkTargetPi.appended.at(-1)?.data.kind, "snapshot", "fork transfer persists a self-contained branch-local snapshot");
await forkTargetPi.emit("session_shutdown", { reason: "quit" }, {});

const reloadOwnerA = {}, reloadOwnerB = {};
const reloadPiA = new FakePi(), reloadPiB = new FakePi();
registerSessionMetrics(reloadPiA as any, reloadOwnerA, { now: () => now });
const reloadSessionA = { sessionManager: { getSessionId: () => "reload-session", getBranch: () => [] } };
await reloadPiA.emit("session_start", { reason: "startup" }, reloadSessionA);
await reloadPiA.emit("agent_start", {}, {});
now += 500;
await reloadPiA.emit("session_shutdown", { reason: "reload" }, reloadSessionA);
const reloadBranch = reloadPiA.appended.map((entry, index) => ({ type: "custom", id: `reload-${index}`, parentId: index > 0 ? `reload-${index - 1}` : null, timestamp: new Date(now).toISOString(), ...entry }));
const reloadCheckpoint = now;
assert.equal(reloadBranch.at(-1)?.data.kind, "complete", "reload checkpoints the predecessor span");
now += 200;
registerSessionMetrics(reloadPiB as any, reloadOwnerB, { now: () => now });
await reloadPiB.emit("session_start", { reason: "reload" }, { sessionManager: { getSessionId: () => "reload-session", getBranch: () => reloadBranch, getEntries: () => reloadBranch } });
assert.equal(getSessionMetrics().activeStartedAt, reloadCheckpoint, "reload successor resumes from the exact predecessor checkpoint");
now += 700;
await reloadPiB.emit("agent_settled", {}, {});
assert.equal(getActiveSessionDuration(now), 1_400, "reload preserves the complete span, including reload latency");
await reloadPiB.emit("session_shutdown", { reason: "new" }, {});

const replacementOwner = {}, replacementPi = new FakePi();
registerSessionMetrics(replacementPi as any, replacementOwner, { now: () => now });
await replacementPi.emit("session_start", { reason: "resume" }, { sessionManager: { getBranch: () => [{ type: "custom", customType: "pi-claudify-active-time-v1", data: { durationMs: 999 } }] } });
assert.equal(getActiveSessionDuration(now), 999, "session replacement publishes the incoming session instead of retaining the previous broker owner");
await replacementPi.emit("session_shutdown", { reason: "quit" }, {});

const legacyOwner = {}, legacyPi = new FakePi();
registerSessionMetrics(legacyPi as any, legacyOwner, { now: () => now, agentSettledSupported: false });
await legacyPi.emit("session_start", {}, { sessionManager: { getBranch: () => [] } });
await legacyPi.emit("agent_start", {}, {});
now += 300;
let legacyIdle = false;
await legacyPi.emit("agent_end", {}, { isIdle: () => legacyIdle });
await new Promise((resolve) => setTimeout(resolve, 5));
now += 400;
assert.equal(getActiveSessionDuration(now), 700, "legacy hosts keep counting through retry and compaction delays");
legacyIdle = true;
await new Promise((resolve) => setTimeout(resolve, 35));
assert.equal(getActiveSessionDuration(now), 700, "legacy hosts settle only after the session reports idle");
releaseSessionMetrics(legacyOwner);

const reentrantOwner = {}, reentrantPi = new FakePi();
registerSessionMetrics(reentrantPi as any, reentrantOwner, { now: () => now });
await reentrantPi.emit("session_start", {}, { sessionManager: { getBranch: () => [] } });
await reentrantPi.emit("agent_start", {}, {});
now += 100;
await reentrantPi.emit("agent_start", {}, {});
await reentrantPi.emit("agent_settled", {}, { isIdle: () => false });
now += 100;
assert.equal(getActiveSessionDuration(now), 200, "a stale settled event cannot close a newer re-entrant run");
await reentrantPi.emit("agent_settled", {}, { isIdle: () => true });
assert.equal(getActiveSessionDuration(now), 200);
releaseSessionMetrics(reentrantOwner);

let trackingEnabled = false;
const disabledOwner = {}, disabledPi = new FakePi();
registerSessionMetrics(disabledPi as any, disabledOwner, { now: () => now, enabled: () => trackingEnabled });
await disabledPi.emit("session_start", {}, { sessionManager: { getBranch: () => [] } });
await disabledPi.emit("agent_start", {}, {});
now += 100;
await disabledPi.emit("agent_settled", {}, { isIdle: () => true });
assert.equal(disabledPi.appended.length, 0, "disabled session stats install no persistent bookkeeping entries");
trackingEnabled = true;
await disabledPi.emit("agent_start", {}, {});
now += 100;
await disabledPi.emit("agent_settled", {}, { isIdle: () => true });
assert.equal(disabledPi.appended.filter((entry) => entry.data.kind === "complete").length, 1, "live re-enabling starts clean accounting on the next run");
await disabledPi.emit("agent_start", {}, {});
now += 50;
trackingEnabled = false;
await disabledPi.emit("agent_settled", {}, { isIdle: () => true });
assert.equal(disabledPi.appended.at(-1)?.data.durationMs, 0, "disabling mid-span writes only the tombstone needed to neutralize its prior start journal");
const disabledBranch = disabledPi.appended.map((entry, index) => ({ type: "custom", id: `disabled-${index}`, parentId: index > 0 ? `disabled-${index - 1}` : null, timestamp: new Date(now).toISOString(), ...entry }));
releaseSessionMetrics(disabledOwner);
const disabledRestoreOwner = {}, disabledRestorePi = new FakePi();
registerSessionMetrics(disabledRestorePi as any, disabledRestoreOwner, { now: () => now });
await disabledRestorePi.emit("session_start", {}, { sessionManager: { getBranch: () => disabledBranch, getEntries: () => disabledBranch } });
assert.equal(getActiveSessionDuration(now, disabledRestoreOwner), 100, "discarded spans cannot resurrect during later reconstruction");
releaseSessionMetrics(disabledRestoreOwner);

let wallNow = 1_000_000, monotonicNow = 0;
const clockOwner = {}, clockPi = new FakePi();
registerSessionMetrics(clockPi as any, clockOwner, { now: () => wallNow, monotonicNow: () => monotonicNow });
await clockPi.emit("session_start", {}, { sessionManager: { getBranch: () => [] } });
await clockPi.emit("agent_start", {}, {});
wallNow += 86_400_000;
monotonicNow += 500;
await clockPi.emit("agent_settled", {}, { isIdle: () => true });
assert.equal(getActiveSessionDuration(monotonicNow, clockOwner), 500, "wall-clock jumps cannot inflate active duration");
releaseSessionMetrics(clockOwner);

const parentOwner = {}, childOwner = {};
const parent = new FakePi(), child = new FakePi();
registerSessionMetrics(parent as any, parentOwner, { now: () => now });
registerSessionMetrics(child as any, childOwner, { now: () => now });
await parent.emit("session_start", {}, { sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 1 } } } }] } });
await parent.emit("agent_start", {}, {});
now += 100;
await child.emit("session_start", {}, { sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 7 } } } }] } });
await child.emit("agent_start", {}, {});
assertCost(getSessionMetrics().cost, 1, "nested session metrics cannot overwrite the active parent footer");
assertCost(getSessionMetrics(childOwner).cost, 7, "a nested footer can address its own metrics without changing global broker priority");
assert.equal(getActiveSessionDuration(now), 100, "child activity is not added to or substituted for the parent wall-clock span");
await parent.emit("session_shutdown", { reason: "resume" }, {});
const nextOwner = {}, next = new FakePi();
registerSessionMetrics(next as any, nextOwner, { now: () => now });
await next.emit("session_start", { reason: "resume" }, { sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 3 } } } }] } });
assertCost(getSessionMetrics(nextOwner).cost, 3, "replacement footer reads its exact owner even while an older background child survives");
releaseSessionMetrics(childOwner);
assertCost(getSessionMetrics(nextOwner).cost, 3, "child teardown preserves replacement metrics");
releaseSessionMetrics(nextOwner);
releaseSessionMetrics(parentOwner);

console.log("session metrics tests passed");
