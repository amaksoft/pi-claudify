import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface SessionMetrics {
	cost: number;
	promptCount: number;
	startedAt: number;
}

let metrics: SessionMetrics = { cost: 0, promptCount: 0, startedAt: Date.now() };
const registered = new WeakSet<object>();

function messageCost(message: any): number {
	const value = message?.usage?.cost?.total;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function getSessionMetrics(): SessionMetrics {
	return { ...metrics };
}

export function registerSessionMetrics(pi: ExtensionAPI): void {
	if (registered.has(pi as object)) return;
	registered.add(pi as object);

	pi.on("session_start", async (_event, ctx) => {
		let cost = 0;
		let promptCount = 0;
		let startedAt = Date.now();
		try {
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type === "message" && entry.message?.role === "assistant") cost += messageCost(entry.message);
				if (entry.type === "message" && entry.message?.role === "user") promptCount++;
				if (typeof entry.timestamp === "string") {
					const timestamp = Date.parse(entry.timestamp);
					if (Number.isFinite(timestamp)) startedAt = Math.min(startedAt, timestamp);
				}
			}
		} catch {
			// A new/ephemeral session starts from zero.
		}
		metrics = { cost, promptCount, startedAt };
	});

	pi.on("message_end", async (event) => {
		if (event.message?.role === "assistant") metrics.cost += messageCost(event.message);
		else if (event.message?.role === "user") metrics.promptCount++;
	});
}
