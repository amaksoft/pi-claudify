import assert from "node:assert/strict";

import { getSessionMetrics, registerSessionMetrics } from "../extensions/session-metrics.ts";

class FakePi {
	events = new Map<string, Array<(...args: any[]) => any>>();
	on(name: string, handler: (...args: any[]) => any): void {
		this.events.set(name, [...(this.events.get(name) ?? []), handler]);
	}
	async emit(name: string, event: any, ctx: any): Promise<void> {
		for (const handler of this.events.get(name) ?? []) await handler(event, ctx);
	}
}

const assertCost = (actual: number, expected: number, message: string): void => {
	assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: expected ${expected}, got ${actual}`);
};

const pi = new FakePi();
registerSessionMetrics(pi as any);
registerSessionMetrics(pi as any);
assert.equal(pi.events.get("session_start")?.length, 1, "registration is idempotent");

const first = "2026-09-08T10:00:00.000Z";
const branch = [
	{ type: "message", timestamp: first, message: { role: "user", content: [] } },
	{ type: "message", timestamp: "2026-09-08T10:00:02.000Z", message: { role: "assistant", usage: { cost: { total: 0.25 } } } },
	{ type: "message", timestamp: "2026-09-08T10:00:04.000Z", message: { role: "user", content: [] } },
	{ type: "message", timestamp: "2026-09-08T10:00:06.000Z", message: { role: "assistant", usage: { cost: { total: 0.5 } } } },
	{ type: "message", timestamp: "2026-09-08T10:00:07.000Z", message: { role: "toolResult", usage: { cost: { total: 0.1 } } } },
	{ type: "compaction", timestamp: "2026-09-08T10:00:08.000Z", usage: { cost: { total: 0.2 } } },
	{ type: "branch_summary", timestamp: "2026-09-08T10:00:09.000Z", usage: { cost: { total: 0.3 } } },
];
await pi.emit("session_start", {}, { sessionManager: { getBranch: () => branch } });
let metrics = getSessionMetrics();
assertCost(metrics.cost, 1.35, "resume seeds assistant, tool-result, compaction, and branch-summary cost");
assert.equal(metrics.costAvailable, true);
assert.equal(metrics.promptCount, 2, "resume seeds user prompt count");
assert.equal(metrics.startedAt, Date.parse(first), "resume anchors elapsed time to the earliest branch entry");

await pi.emit("message_end", { message: { role: "assistant", usage: { cost: { total: 0.125 } } } }, {});
await pi.emit("message_end", { message: { role: "assistant" } }, {});
await pi.emit("message_end", { message: { role: "user" } }, {});
metrics = getSessionMetrics();
await pi.emit("message_end", { message: { role: "toolResult", usage: { cost: { total: 0.05 } } } }, {});
assertCost(metrics.cost, 1.475, "live assistant cost accumulates without inventing missing usage");
metrics = getSessionMetrics();
assertCost(metrics.cost, 1.525, "usage-bearing tool results contribute exactly once");
assert.equal(metrics.promptCount, 3, "one submitted user message adds one prompt");

const branchB = [
	{ type: "message", timestamp: "2026-09-09T12:00:00.000Z", message: { role: "user", content: [] } },
	{ type: "message", timestamp: "2026-09-09T12:00:01.000Z", message: { role: "assistant", usage: { cost: { total: 0.4 } } } },
];
const branchContext = { sessionManager: { getBranch: () => branchB } };
await pi.emit("session_tree", { newLeafId: "branch-b" }, branchContext);
metrics = getSessionMetrics();
assertCost(metrics.cost, 0.4, "tree navigation rebases cost to the active branch");
assert.equal(metrics.promptCount, 1);
assert.equal(metrics.startedAt, Date.parse(branchB[0].timestamp));
branchB.push({ type: "compaction", timestamp: "2026-09-09T12:00:02.000Z", usage: { cost: { total: 0.2 } } });
await pi.emit("session_compact", { compactionEntry: branchB.at(-1) }, branchContext);
assertCost(getSessionMetrics().cost, 0.6, "successful compaction recomputes the active branch without double counting");

console.log("session metrics tests passed");
