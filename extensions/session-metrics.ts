import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { testedPiPatchBroker } from "./adapters/tested-pi/patch-broker.ts";

export interface SessionMetrics {
	cost: number;
	costAvailable: boolean;
	promptCount: number;
	startedAt: number;
}

const SURFACE = "session-metrics";
const DEFAULT_OWNER = {};
const EMPTY_METRICS: SessionMetrics = { cost: 0, costAvailable: false, promptCount: 0, startedAt: 0 };
const registered = new WeakSet<object>();

function createMetrics(): SessionMetrics {
	return { cost: 0, costAvailable: false, promptCount: 0, startedAt: Date.now() };
}

function ownerMetrics(owner: object): SessionMetrics {
	let metrics = testedPiPatchBroker.owned<SessionMetrics>(owner, SURFACE);
	if (!metrics) {
		metrics = createMetrics();
		testedPiPatchBroker.bind(owner, SURFACE, metrics);
	}
	return metrics;
}

function isOwned(owner: object, value: SessionMetrics): boolean {
	return testedPiPatchBroker.owned<SessionMetrics>(owner, SURFACE) === value;
}

function usageCost(value: any): number {
	const total = value?.usage?.cost?.total;
	return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : 0;
}

function entryCost(entry: any): number {
	if (entry?.type === "message") return usageCost(entry.message);
	if (entry?.type === "branch_summary" || entry?.type === "compaction") return usageCost(entry);
	return 0;
}

export function getSessionMetrics(): SessionMetrics {
	return { ...(testedPiPatchBroker.active<SessionMetrics>(SURFACE) ?? EMPTY_METRICS) };
}

export function registerSessionMetrics(pi: ExtensionAPI, owner: object = DEFAULT_OWNER): void {
	if (registered.has(pi as object)) return;
	registered.add(pi as object);
	const metrics = ownerMetrics(owner);

	const rebuild = (ctx: any): void => {
		if (!isOwned(owner, metrics)) return;
		let cost = 0;
		let promptCount = 0;
		let startedAt = Date.now();
		try {
			for (const entry of ctx.sessionManager.getBranch()) {
				cost += entryCost(entry);
				if (entry.type === "message" && entry.message?.role === "user") promptCount++;
				if (typeof entry.timestamp === "string") {
					const timestamp = Date.parse(entry.timestamp);
					if (Number.isFinite(timestamp)) startedAt = Math.min(startedAt, timestamp);
				}
			}
		} catch {
			// A new/ephemeral session starts from zero but still has a known cost.
		}
		Object.assign(metrics, { cost, costAvailable: true, promptCount, startedAt });
	};

	pi.on("session_start", async (_event, ctx) => rebuild(ctx));
	pi.on("session_tree", async (_event, ctx) => rebuild(ctx));
	pi.on("session_compact", async (_event, ctx) => rebuild(ctx));

	pi.on("message_end", async (event) => {
		if (!isOwned(owner, metrics)) return;
		const message = event.message as any;
		if (message?.role === "user") metrics.promptCount++;
		else if (message?.usage) {
			metrics.cost += usageCost(message);
			metrics.costAvailable = true;
		}
	});
}

export function releaseSessionMetrics(owner: object = DEFAULT_OWNER): void {
	testedPiPatchBroker.releaseSurface(owner, SURFACE);
}
