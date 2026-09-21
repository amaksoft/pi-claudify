import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { testedPiPatchBroker } from "./adapters/tested-pi/patch-broker.ts";

export interface SessionMetrics {
	cost: number;
	costAvailable: boolean;
	promptCount: number;
	startedAt: number;
	activeMs: number;
	active: boolean;
	/** Wall-clock marker used only as a display diagnostic. */
	activeStartedAt: number;
	/** Monotonic process-local anchor used for live duration arithmetic. */
	activeStartedMonotonic: number;
}

export interface SessionMetricsOptions {
	now?: () => number;
	monotonicNow?: () => number;
	agentSettledSupported?: boolean;
	enabled?: () => boolean;
	legacyIdlePollMs?: number;
}

const SURFACE = "session-metrics";
const ACTIVE_TIME_ENTRY = "pi-claudify-active-time-v2";
const LEGACY_ACTIVE_TIME_ENTRY = "pi-claudify-active-time-v1";
const PROCESS_STATE_KEY = Symbol.for("pi-claudify:active-time-process-state-v2");
const DEFAULT_OWNER = {};
const MAX_ACTIVE_SPAN_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_ACTIVE_TOTAL_MS = Number.MAX_SAFE_INTEGER;
const RELOAD_HANDOFF_TTL_MS = 2 * 60 * 1_000;
const EMPTY_METRICS: SessionMetrics = {
	cost: 0,
	costAvailable: false,
	promptCount: 0,
	startedAt: 0,
	activeMs: 0,
	active: false,
	activeStartedAt: 0,
	activeStartedMonotonic: 0,
};
const registered = new WeakSet<object>();
const listeners = new Set<() => void>();
const metricClocks = new WeakMap<SessionMetrics, () => number>();

interface ReloadHandoff {
	wallAt: number;
	monotonicAt: number;
	createdMonotonic: number;
}
interface ForkHandoff {
	targetEntryId: string;
	activeMs: number;
	createdMonotonic: number;
}
interface ProcessState {
	reloadHandoffs: Map<string, ReloadHandoff>;
	forkHandoffs: Map<string, ForkHandoff[]>;
}
interface ActiveTimeRecord {
	version: 2;
	kind: "start" | "complete" | "snapshot";
	spanId: string;
	startedAt?: number;
	durationMs?: number;
	totalMs?: number;
}

function processState(): ProcessState {
	const root = globalThis as Record<PropertyKey, unknown>;
	const current = (root[PROCESS_STATE_KEY] ??= { reloadHandoffs: new Map<string, ReloadHandoff>(), forkHandoffs: new Map<string, ForkHandoff[]>() }) as ProcessState;
	if (!(current.reloadHandoffs instanceof Map)) current.reloadHandoffs = new Map();
	if (!(current.forkHandoffs instanceof Map)) current.forkHandoffs = new Map();
	return current;
}

function createMetrics(): SessionMetrics {
	return { ...EMPTY_METRICS };
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

function notify(): void {
	for (const listener of listeners) {
		try { listener(); } catch { /* a replaced footer may already be disposed */ }
	}
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

function validDuration(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_ACTIVE_SPAN_MS
		? value
		: undefined;
}

function validTotal(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_ACTIVE_TOTAL_MS
		? value
		: undefined;
}

function addDuration(total: number, duration: number): number {
	return Math.min(MAX_ACTIVE_TOTAL_MS, total + duration);
}

function sessionKey(ctx: any): string | undefined {
	try {
		const value = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionManager?.getSessionFile?.();
		return typeof value === "string" && value ? value : undefined;
	} catch { return undefined; }
}

function metricEntries(ctx: any, branch: any[]): any[] {
	const ids = new Set(branch.map((entry) => entry?.id).filter((id): id is string => typeof id === "string"));
	if (ids.size === 0 || typeof ctx?.sessionManager?.getEntries !== "function") return branch;
	try {
		const all = ctx.sessionManager.getEntries();
		if (!Array.isArray(all)) return branch;
		return all.filter((entry) => ids.has(entry?.id)
			|| (entry?.customType === LEGACY_ACTIVE_TIME_ENTRY && typeof entry?.parentId === "string" && ids.has(entry.parentId))
			|| (entry?.customType === ACTIVE_TIME_ENTRY
				&& (entry.data?.kind === "complete" || entry.data?.kind === "snapshot")
				&& typeof entry?.parentId === "string" && ids.has(entry.parentId)));
	} catch { return branch; }
}

function reconstructActiveMs(ctx: any, branch: any[], liveSpanId?: string): { total: number; recovered: boolean } {
	const entries = metricEntries(ctx, branch);
	const completed = new Set<string>();
	const starts = new Map<string, number>();
	let total = 0;
	let recovered = false;
	for (const [index, entry] of entries.entries()) {
		if (entry?.type !== "custom") continue;
		if (entry.customType === LEGACY_ACTIVE_TIME_ENTRY) {
			const duration = validDuration(entry.data?.durationMs);
			const id = typeof entry.id === "string" ? entry.id : `legacy:${index}`;
			if (duration !== undefined && !completed.has(id)) {
				completed.add(id);
				total = addDuration(total, duration);
			}
			continue;
		}
		if (entry.customType !== ACTIVE_TIME_ENTRY || entry.data?.version !== 2) continue;
		const record = entry.data as ActiveTimeRecord;
		if (typeof record.spanId !== "string" || !record.spanId || record.spanId.length > 128) continue;
		if (record.kind === "snapshot") {
			const snapshot = validTotal(record.totalMs);
			if (snapshot === undefined) continue;
			total = snapshot;
			completed.clear();
			starts.clear();
		} else if (record.kind === "start" && typeof record.startedAt === "number" && Number.isSafeInteger(record.startedAt) && record.startedAt > 0) {
			starts.set(record.spanId, record.startedAt);
		} else if (record.kind === "complete") {
			const duration = validDuration(record.durationMs);
			if (duration !== undefined && !completed.has(record.spanId)) {
				completed.add(record.spanId);
				total = addDuration(total, duration);
			}
		}
	}
	for (const [spanId, startedAt] of starts) {
		if (completed.has(spanId) || spanId === liveSpanId) continue;
		let recoveryEnd = startedAt;
		for (const entry of branch) {
			const timestamp = typeof entry?.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
			if (!Number.isFinite(timestamp) || timestamp <= startedAt) continue;
			if (entry?.type === "message" && entry.message?.role === "user") break;
			if ((entry?.type === "message" && (entry.message?.role === "assistant" || entry.message?.role === "toolResult"))
				|| entry?.type === "compaction" || entry?.type === "branch_summary") recoveryEnd = timestamp;
		}
		const duration = validDuration(Math.floor(recoveryEnd - startedAt));
		if (duration !== undefined) {
			total = addDuration(total, duration);
			recovered = true;
		}
	}
	return { total, recovered };
}

export function getSessionMetrics(owner?: object): SessionMetrics {
	const metrics = owner
		? testedPiPatchBroker.owned<SessionMetrics>(owner, SURFACE)
		: testedPiPatchBroker.active<SessionMetrics>(SURFACE);
	return { ...(metrics ?? EMPTY_METRICS) };
}

export function getActiveSessionDuration(monotonicNow?: number, owner?: object): number {
	const metrics = (owner
		? testedPiPatchBroker.owned<SessionMetrics>(owner, SURFACE)
		: testedPiPatchBroker.active<SessionMetrics>(SURFACE)) ?? EMPTY_METRICS;
	const clock = monotonicNow ?? metricClocks.get(metrics)?.() ?? performance.now();
	const current = metrics.active ? Math.max(0, clock - metrics.activeStartedMonotonic) : 0;
	return addDuration(metrics.activeMs, Math.min(MAX_ACTIVE_SPAN_MS, Math.floor(current)));
}

export function subscribeSessionMetrics(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function registerSessionMetrics(pi: ExtensionAPI, owner: object = DEFAULT_OWNER, options: SessionMetricsOptions = {}): void {
	if (registered.has(pi as object)) return;
	registered.add(pi as object);
	const metrics = ownerMetrics(owner);
	const now = options.now ?? Date.now;
	const monotonicNow = options.monotonicNow ?? options.now ?? performance.now.bind(performance);
	const enabled = options.enabled ?? (() => true);
	const agentSettledSupported = options.agentSettledSupported !== false;
	const legacyIdlePollMs = options.legacyIdlePollMs ?? 25;
	metricClocks.set(metrics, monotonicNow);
	let currentSessionKey: string | undefined;
	let currentSessionFile: string | undefined;
	let activeSpanId: string | undefined;
	let legacyIdleTimer: ReturnType<typeof setTimeout> | undefined;

	const append = (record: ActiveTimeRecord): void => {
		try { pi.appendEntry(ACTIVE_TIME_ENTRY, record); } catch { /* ephemeral/read-only sessions retain in-memory accounting */ }
	};
	const stopLegacyPoll = (): void => {
		if (legacyIdleTimer) clearTimeout(legacyIdleTimer);
		legacyIdleTimer = undefined;
	};
	const beginActiveSpan = (wallAt = now(), monotonicAt = monotonicNow()): void => {
		if (!enabled() || metrics.active) return;
		activeSpanId = randomUUID();
		metrics.active = true;
		metrics.activeStartedAt = wallAt;
		metrics.activeStartedMonotonic = monotonicAt;
		append({ version: 2, kind: "start", spanId: activeSpanId, startedAt: wallAt });
		notify();
	};
	const finishActiveSpan = (continued = false): void => {
		if (!isOwned(owner, metrics) || !metrics.active) return;
		const endedWall = now();
		const endedMonotonic = monotonicNow();
		const durationMs = Math.min(MAX_ACTIVE_SPAN_MS, Math.max(0, Math.floor(endedMonotonic - metrics.activeStartedMonotonic)));
		const spanId = activeSpanId ?? randomUUID();
		metrics.active = false;
		metrics.activeStartedAt = 0;
		metrics.activeStartedMonotonic = 0;
		metrics.activeMs = addDuration(metrics.activeMs, durationMs);
		activeSpanId = undefined;
		if (enabled()) append({ version: 2, kind: "complete", spanId, durationMs });
		if (currentSessionKey) {
			const handoffs = processState().reloadHandoffs;
			if (continued && enabled()) handoffs.set(currentSessionKey, { wallAt: endedWall, monotonicAt: endedMonotonic, createdMonotonic: endedMonotonic });
			else handoffs.delete(currentSessionKey);
		}
		notify();
	};
	const discardActiveSpan = (): void => {
		if (activeSpanId) append({ version: 2, kind: "complete", spanId: activeSpanId, durationMs: 0 });
		metrics.active = false;
		metrics.activeStartedAt = 0;
		metrics.activeStartedMonotonic = 0;
		activeSpanId = undefined;
		if (currentSessionKey) processState().reloadHandoffs.delete(currentSessionKey);
		notify();
	};

	const appendSnapshot = (totalMs: number): void => {
		if (enabled()) append({ version: 2, kind: "snapshot", spanId: randomUUID(), totalMs });
	};

	const rebuild = (event: any, ctx: any, resetActive: boolean): void => {
		if (resetActive && !isOwned(owner, metrics)) testedPiPatchBroker.bind(owner, SURFACE, metrics);
		if (!isOwned(owner, metrics)) return;
		const branch: any[] = (() => { try { return ctx.sessionManager.getBranch(); } catch { return []; } })();
		let cost = 0;
		let promptCount = 0;
		let startedAt = now();
		for (const entry of branch) {
			cost += entryCost(entry);
			if (typeof entry?.timestamp === "string") {
				const timestamp = Date.parse(entry.timestamp);
				if (Number.isFinite(timestamp)) startedAt = Math.min(startedAt, timestamp);
			}
			if (entry?.type === "message" && entry.message?.role === "user") promptCount++;
		}
		const reconstruction = reconstructActiveMs(ctx, branch, resetActive ? undefined : activeSpanId);
		Object.assign(metrics, { cost, costAvailable: true, promptCount, startedAt, activeMs: reconstruction.total });
		if (resetActive) {
			metrics.active = false;
			metrics.activeStartedAt = 0;
			metrics.activeStartedMonotonic = 0;
			activeSpanId = undefined;
			currentSessionKey = sessionKey(ctx);
			try { currentSessionFile = ctx?.sessionManager?.getSessionFile?.() ?? undefined; } catch { currentSessionFile = undefined; }
			const handoff = currentSessionKey ? processState().reloadHandoffs.get(currentSessionKey) : undefined;
			if (currentSessionKey) processState().reloadHandoffs.delete(currentSessionKey);
			if (event?.reason === "reload" && handoff && monotonicNow() - handoff.createdMonotonic <= RELOAD_HANDOFF_TTL_MS) {
				beginActiveSpan(handoff.wallAt, handoff.monotonicAt);
			}
			if (event?.reason === "fork") {
				const handoffs = processState().forkHandoffs;
				const branchIds = new Set(branch.map((entry) => entry?.id).filter((id): id is string => typeof id === "string"));
				const preferredSource = typeof event.previousSessionFile === "string" ? event.previousSessionFile : undefined;
				const pools = preferredSource && handoffs.has(preferredSource)
					? [[preferredSource, handoffs.get(preferredSource)!] as const]
					: [...handoffs.entries()];
				const matches = pools.flatMap(([source, candidates]) => candidates
					.filter((item) => branchIds.has(item.targetEntryId) && monotonicNow() - item.createdMonotonic <= RELOAD_HANDOFF_TTL_MS)
					.map((item) => ({ source, item })));
				const match = matches.sort((left, right) => right.item.createdMonotonic - left.item.createdMonotonic)[0];
				if (match) {
					metrics.activeMs = match.item.activeMs;
					appendSnapshot(match.item.activeMs);
					const remaining = (handoffs.get(match.source) ?? []).filter((item) => item !== match.item);
					if (remaining.length) handoffs.set(match.source, remaining); else handoffs.delete(match.source);
				} else if (reconstruction.recovered) appendSnapshot(reconstruction.total);
			} else if (reconstruction.recovered) appendSnapshot(reconstruction.total);
		}
		notify();
	};

	pi.on("session_before_fork", async (event: any, ctx: any) => {
		if (!enabled()) return;
		let branch: any[];
		try { branch = ctx.sessionManager.getBranch(event.entryId); } catch { return; }
		if (event.position === "before") branch = branch.slice(0, -1);
		const targetEntryId = branch.at(-1)?.id;
		const source = currentSessionFile ?? currentSessionKey ?? (() => { try { return ctx.sessionManager.getSessionFile?.() ?? ctx.sessionManager.getSessionId?.(); } catch { return undefined; } })();
		if (typeof source !== "string" || typeof targetEntryId !== "string") return;
		const activeMs = reconstructActiveMs(ctx, branch).total;
		const handoffs = processState().forkHandoffs;
		const candidates = handoffs.get(source) ?? [];
		candidates.push({ targetEntryId, activeMs, createdMonotonic: monotonicNow() });
		while (candidates.length > 8) candidates.shift();
		handoffs.set(source, candidates);
	});
	pi.on("session_start", async (event, ctx) => rebuild(event, ctx, true));
	pi.on("session_tree", async (event, ctx) => rebuild(event, ctx, true));
	pi.on("session_compact", async (event, ctx) => rebuild(event, ctx, false));

	pi.on("agent_start", async () => beginActiveSpan());
	pi.on("agent_end", async (_event, ctx) => {
		if (agentSettledSupported || legacyIdleTimer || !metrics.active) return;
		const waitForIdle = (): void => {
			legacyIdleTimer = undefined;
			let idle = true;
			try { idle = ctx?.isIdle?.() !== false; } catch { idle = true; }
			if (idle) {
				if (enabled()) finishActiveSpan(); else discardActiveSpan();
			}
			else {
				legacyIdleTimer = setTimeout(waitForIdle, legacyIdlePollMs);
				legacyIdleTimer.unref?.();
			}
		};
		legacyIdleTimer = setTimeout(waitForIdle, 0);
		legacyIdleTimer.unref?.();
	});
	pi.on("agent_settled", async (_event, ctx) => {
		if (!agentSettledSupported) return;
		let idle = true;
		try { idle = ctx?.isIdle?.() !== false; } catch { idle = true; }
		if (idle) {
			if (enabled()) finishActiveSpan(); else discardActiveSpan();
		}
	});
	pi.on("session_shutdown", async (event) => {
		stopLegacyPoll();
		if (!enabled()) discardActiveSpan();
		else finishActiveSpan(event.reason === "reload");
		testedPiPatchBroker.releaseSurface(owner, SURFACE);
		notify();
	});

	pi.on("message_end", async (event) => {
		if (!isOwned(owner, metrics)) return;
		const message = event.message as any;
		if (message?.role === "user") metrics.promptCount++;
		else if (message?.usage) {
			metrics.cost += usageCost(message);
			metrics.costAvailable = true;
		}
		notify();
	});
}

export function releaseSessionMetrics(owner: object = DEFAULT_OWNER): void {
	testedPiPatchBroker.releaseSurface(owner, SURFACE);
	notify();
}
