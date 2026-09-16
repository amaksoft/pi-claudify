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
];
await pi.emit("session_start", {}, { sessionManager: { getBranch: () => branch } });
let metrics = getSessionMetrics();
assert.equal(metrics.cost, 0.75, "resume seeds provider-reported historical cost");
assert.equal(metrics.promptCount, 2, "resume seeds user prompt count");
assert.equal(metrics.startedAt, Date.parse(first), "resume anchors elapsed time to the earliest branch entry");

await pi.emit("message_end", { message: { role: "assistant", usage: { cost: { total: 0.125 } } } }, {});
await pi.emit("message_end", { message: { role: "assistant" } }, {});
await pi.emit("message_end", { message: { role: "user" } }, {});
metrics = getSessionMetrics();
assert.equal(metrics.cost, 0.875, "live assistant cost accumulates without inventing missing usage");
assert.equal(metrics.promptCount, 3, "one submitted user message adds one prompt");

console.log("session metrics tests passed");
