import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

import { formatCronList, humanCron, nextCronTime, parseCron, type CronTask } from "../domain/cron.ts";
import { sanitizeToolContent, sanitizeToolText } from "../terminal-sanitize.ts";

const MAX_TIMER_MS = 2_147_000_000;
const RECURRING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredTask { id: string; cron: string; prompt: string; createdAt: number; recurring: boolean }
interface StoredTasks { tasks: StoredTask[] }

const SESSION_TASKS_KEY = Symbol.for("pi-claudify:cron-session-tasks");
function sessionTaskStore(): Map<string, CronTask[]> {
	const root = globalThis as Record<PropertyKey, unknown>;
	return (root[SESSION_TASKS_KEY] ??= new Map<string, CronTask[]>()) as Map<string, CronTask[]>;
}

export interface CronSchedulerOptions {
	cwd: string;
	now?: () => number;
	id?: () => string;
	random?: () => number;
	sendUserMessage?: (prompt: string) => void;
	onError?: (error: unknown) => void;
}

export class CronScheduler {
	private readonly tasks = new Map<string, CronTask>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private context: any;
	private stopped = false;
	private loaded = false;
	private awaitingSettlement = false;
	private sessionKey: string | undefined;
	private readonly dirtyDurableIds = new Set<string>();
	private readonly deletedDurableIds = new Set<string>();
	private readonly now: () => number;
	private readonly makeId: () => string;
	private readonly random: () => number;
	private readonly send: (prompt: string) => void;
	private readonly reportError: (error: unknown) => void;
	readonly storagePath: string;

	constructor(options: CronSchedulerOptions) {
		this.storagePath = join(options.cwd, ".pi", "scheduled_tasks.json");
		this.now = options.now ?? Date.now;
		this.makeId = options.id ?? (() => randomBytes(4).toString("hex"));
		this.random = options.random ?? Math.random;
		this.send = options.sendUserMessage ?? (() => {});
		this.reportError = options.onError ?? (() => {});
	}

	bindSession(key: string): void {
		if (this.sessionKey === key) return;
		this.sessionKey = key;
		const stored = sessionTaskStore().get(key) ?? [];
		sessionTaskStore().delete(key);
		for (const task of stored) if (!this.tasks.has(task.id)) this.tasks.set(task.id, { ...task });
	}

	preserveSessionTasks(): void {
		if (!this.sessionKey) return;
		const tasks = this.list().filter((task) => !task.durable).map((task) => ({ ...task }));
		if (tasks.length > 0) sessionTaskStore().set(this.sessionKey, tasks);
		else sessionTaskStore().delete(this.sessionKey);
	}

	discardSessionTasks(): void {
		if (this.sessionKey) sessionTaskStore().delete(this.sessionKey);
	}

	clearSessionOnlyTasks(): void {
		for (const [id, task] of this.tasks) if (!task.durable) this.tasks.delete(id);
		this.awaitingSettlement = false;
	}

	setContext(context: any, loadDurable = true): void {
		this.stopped = false;
		this.context = context;
		if (loadDurable && !this.loaded) this.load();
		this.schedule();
	}

	create(cron: string, prompt: string, recurring = true, durable = false): CronTask {
		parseCron(cron);
		const safePrompt = sanitizeToolContent(prompt).trim();
		if (!safePrompt) throw new Error("Scheduled task prompt cannot be empty.");
		let id = this.makeId();
		while (this.tasks.has(id)) id = this.makeId();
		const createdAt = this.now();
		const task: CronTask = { id, cron: cron.trim(), prompt: safePrompt, createdAt, recurring, durable, nextRunAt: this.nextRun(cron, createdAt, recurring) };
		this.tasks.set(id, task);
		if (durable) { this.dirtyDurableIds.add(id); this.deletedDurableIds.delete(id); }
		this.persist();
		this.schedule();
		return task;
	}

	list(): CronTask[] {
		return [...this.tasks.values()].sort((a, b) => a.nextRunAt - b.nextRunAt || a.id.localeCompare(b.id));
	}

	get(id: string): CronTask | undefined { return this.tasks.get(id); }

	delete(id: string): boolean {
		const task = this.tasks.get(id);
		const removed = this.tasks.delete(id);
		if (removed) {
			if (task?.durable) { this.deletedDurableIds.add(id); this.dirtyDurableIds.delete(id); }
			this.persist();
			this.schedule();
		}
		return removed;
	}

	async flushDue(): Promise<void> {
		if (this.stopped) return;
		if (this.awaitingSettlement) {
			if (!this.context?.isIdle?.()) { this.schedule(1_000); return; }
			this.awaitingSettlement = false;
		}
		if (!this.context?.isIdle?.()) { this.schedule(1_000); return; }
		const now = this.now();
		const task = this.list().find((candidate) => candidate.nextRunAt <= now);
		if (!task) { this.schedule(); return; }
		const expired = task.recurring && now - task.createdAt >= RECURRING_TTL_MS;
		const previousNextRunAt = task.nextRunAt;
		const removed = !task.recurring || expired;
		if (removed) {
			this.tasks.delete(task.id);
			if (task.durable) { this.deletedDurableIds.add(task.id); this.dirtyDurableIds.delete(task.id); }
		} else task.nextRunAt = this.nextRun(task.cron, now, true);
		this.persist();
		try {
			this.send(task.prompt);
			this.awaitingSettlement = true;
		} catch (error) {
			// A torn-down or temporarily unavailable host must not crash Pi or lose
			// the scheduled task. Restore it and retry after the host becomes idle.
			task.nextRunAt = previousNextRunAt;
			this.tasks.set(task.id, task);
			if (task.durable) { this.dirtyDurableIds.add(task.id); this.deletedDurableIds.delete(task.id); }
			this.persist();
			this.awaitingSettlement = false;
			this.reportError(error);
		}
		// Pi <0.80.4 has no agent_settled event. Polling is the compatibility
		// fallback; newer hosts normally clear this state through agentSettled().
		this.schedule(1_000);
	}

	async agentSettled(context: any): Promise<void> {
		this.context = context;
		this.awaitingSettlement = false;
		await this.flushDue();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private nextRun(cron: string, after: number, recurring: boolean): number {
		const base = nextCronTime(cron, after);
		if (recurring) {
			const period = Math.max(60_000, nextCronTime(cron, base) - base);
			return base + Math.floor(this.random() * Math.min(15 * 60_000, period * 0.1));
		}
		const minute = Number(cron.trim().split(/\s+/)[0]);
		return minute === 0 || minute === 30 ? Math.max(after, base - Math.floor(this.random() * 90_000)) : base;
	}

	private schedule(delayOverride?: number): void {
		if (this.stopped) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		const first = this.list()[0];
		if (!first && delayOverride === undefined) return;
		const delay = delayOverride ?? Math.max(0, (first?.nextRunAt ?? this.now()) - this.now());
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.flushDue().catch((error) => { this.reportError(error); this.schedule(1_000); });
		}, Math.min(MAX_TIMER_MS, delay));
		(this.timer as any).unref?.();
	}

	private load(): void {
		this.loaded = true;
		let parsed: StoredTasks;
		try { parsed = JSON.parse(readFileSync(this.storagePath, "utf8")) as StoredTasks; }
		catch { return; }
		if (!Array.isArray(parsed?.tasks)) return;
		for (const raw of parsed.tasks) {
			try {
				if (!raw || typeof raw.id !== "string" || typeof raw.cron !== "string" || typeof raw.prompt !== "string" || typeof raw.createdAt !== "number") continue;
				parseCron(raw.cron);
				this.tasks.set(raw.id, { ...raw, recurring: raw.recurring !== false, durable: true, nextRunAt: this.nextRun(raw.cron, this.now(), raw.recurring !== false) });
			} catch { /* malformed durable task is ignored */ }
		}
	}

	private persist(): void {
		if (this.dirtyDurableIds.size === 0 && this.deletedDurableIds.size === 0) return;
		mkdirSync(dirname(this.storagePath), { recursive: true });
		const lockPath = `${this.storagePath}.lock`;
		let lock: number | undefined;
		try {
			for (let attempt = 0; attempt < 50; attempt++) {
				try { lock = openSync(lockPath, "wx", 0o600); break; }
				catch (error: any) {
					if (error?.code !== "EEXIST") throw error;
					try { if (Date.now() - statSync(lockPath).mtimeMs > 5_000) unlinkSync(lockPath); } catch { /* another process moved it */ }
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
				}
			}
			if (lock === undefined) throw new Error("Timed out waiting for scheduled-task storage lock");
			const merged = new Map<string, StoredTask>();
			try {
				const parsed = JSON.parse(readFileSync(this.storagePath, "utf8")) as StoredTasks;
				if (Array.isArray(parsed?.tasks)) for (const task of parsed.tasks) if (task && typeof task.id === "string") merged.set(task.id, task);
			} catch { /* a missing/invalid file starts from an empty durable set */ }
			for (const id of this.deletedDurableIds) merged.delete(id);
			for (const id of this.dirtyDurableIds) {
				const task = this.tasks.get(id);
				if (task?.durable) {
					const { cron, prompt, createdAt, recurring } = task;
					merged.set(id, { id, cron, prompt, createdAt, recurring });
				} else merged.delete(id);
			}
			if (merged.size > 0 || existsSync(this.storagePath)) {
				const temp = `${this.storagePath}.tmp-${process.pid}`;
				writeFileSync(temp, `${JSON.stringify({ tasks: [...merged.values()] }, null, 2)}\n`, { mode: 0o600 });
				renameSync(temp, this.storagePath);
			}
			this.dirtyDurableIds.clear();
			this.deletedDurableIds.clear();
		} catch (error) {
			this.reportError(error);
		} finally {
			if (lock !== undefined) {
				try { closeSync(lock); } catch {}
				try { unlinkSync(lockPath); } catch {}
			}
		}
	}
}

function projectTrusted(ctx: any): boolean {
	try { return ctx?.isProjectTrusted?.() === true; } catch { return false; }
}

async function confirmDurable(ctx: any, title: string, message: string): Promise<void> {
	if (ctx?.mode !== "tui" || !ctx?.hasUI || typeof ctx.ui?.confirm !== "function") {
		throw new Error("Durable scheduled-task changes require confirmation in the interactive TUI.");
	}
	if (!await ctx.ui.confirm(title, message)) throw new Error("The user declined the durable scheduled-task change.");
}

function text(value: string): Text { return new Text(value, 0, 0); }
function resultText(result: any): string {
	return Array.isArray(result?.content) ? result.content.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n") : "";
}

export function registerCronTools(pi: ExtensionAPI, scheduler: CronScheduler, register: (definition: any) => void): void {
	register({
		name: "CronCreate",
		label: "CronCreate",
		promptSnippet: "Schedule a prompt with a local-time cron expression.",
		description: "Schedule a prompt using a standard five-field local-time cron expression. Jobs run only while Pi is open and idle.",
		promptGuidelines: ["When using CronCreate, prefer minute values other than :00 or :30. Use recurring:false for one-shot work and durable:true only when persistence across Pi restarts is required."],
		parameters: Type.Object({ cron: Type.String(), prompt: Type.String(), recurring: Type.Optional(Type.Boolean({ default: true })), durable: Type.Optional(Type.Boolean({ default: false })) }),
		async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
			const trusted = projectTrusted(ctx);
			if (params.durable === true && !trusted) throw new Error("Durable scheduled tasks require a trusted project.");
			if (params.durable === true) await confirmDurable(ctx, "Create durable scheduled task?", `${sanitizeToolContent(humanCron(params.cron))}\n\n${sanitizeToolContent(params.prompt)}\n\nPersist to .pi/scheduled_tasks.json`);
			scheduler.setContext(ctx, trusted);
			const task = scheduler.create(params.cron, params.prompt, params.recurring !== false, params.durable === true);
			const persistence = task.durable ? "Persisted to .pi/scheduled_tasks.json." : "Session-only (not written to disk, dies when Pi exits).";
			const suffix = task.recurring ? "After 7 days it will fire once more, then auto-delete. Use CronDelete to cancel sooner." : "It will fire once then auto-delete.";
			return { content: [{ type: "text", text: `Scheduled ${task.recurring ? "recurring job" : "one-shot task"} ${task.id} (${humanCron(task.cron)}). ${persistence} ${suffix}` }], details: { id: task.id, humanSchedule: humanCron(task.cron), recurring: task.recurring, durable: task.durable } };
		},
		renderCall(args: any) { return text(`CronCreate(${sanitizeToolText(args?.cron)}: ${sanitizeToolContent(args?.prompt)})`); },
		renderResult(result: any) { return text(resultText(result).replace(/^Scheduled (?:recurring job|one-shot task) /, "Scheduled ")); },
	});
	register({
		name: "CronList", label: "CronList", promptSnippet: "List scheduled prompts for this project.", description: "List session-only and durable scheduled jobs.", parameters: Type.Object({}),
		async execute(_id: string, _params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) { scheduler.setContext(ctx, projectTrusted(ctx)); const jobs = scheduler.list(); return { content: [{ type: "text", text: formatCronList(jobs) }], details: { jobs } }; },
		renderCall() { return text("CronList"); }, renderResult(result: any) { return text(resultText(result)); },
	});
	register({
		name: "CronDelete", label: "CronDelete", promptSnippet: "Cancel a scheduled prompt by ID.", description: "Cancel a scheduled job by ID.", parameters: Type.Object({ id: Type.String() }),
		async execute(_toolId: string, params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
			scheduler.setContext(ctx, projectTrusted(ctx));
			const task = scheduler.get(params.id);
			if (!task) throw new Error(`No scheduled job with id '${params.id}'`);
			if (task.durable) await confirmDurable(ctx, "Delete durable scheduled task?", `${sanitizeToolText(task.id)} — ${sanitizeToolContent(humanCron(task.cron))}\n\n${sanitizeToolContent(task.prompt)}`);
			scheduler.delete(params.id);
			return { content: [{ type: "text", text: `Cancelled job ${params.id}.` }], details: { id: params.id } };
		},
		renderCall(args: any) { return text(`CronDelete(${sanitizeToolText(args?.id)})`); }, renderResult(result: any) { return text(resultText(result)); },
	});
}

function cronSessionKey(ctx: any): string {
	return String(ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionManager?.getSessionFile?.() ?? ctx?.cwd ?? "ephemeral");
}

export function installCronLifecycle(pi: ExtensionAPI, scheduler: CronScheduler): void {
	pi.on("session_start", async (_event, ctx) => {
		scheduler.bindSession(cronSessionKey(ctx));
		scheduler.setContext(ctx, projectTrusted(ctx));
	});
	(pi as any).on("agent_settled", async (_event: unknown, ctx: any) => scheduler.agentSettled(ctx));
	pi.on("session_shutdown", async (event: any) => {
		if (event?.reason === "reload") scheduler.preserveSessionTasks();
		else {
			scheduler.discardSessionTasks();
			scheduler.clearSessionOnlyTasks();
		}
		scheduler.stop();
	});
}
