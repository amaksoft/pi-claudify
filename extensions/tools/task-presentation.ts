import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

import { testedPiPatchBroker } from "../adapters/tested-pi/patch-broker.ts";
import { TASK_TOOL_NAMES, parseTaskListText, normalizeTaskToolName, type TaskStatus, type TaskToolName, type TaskViewRecord } from "../domain/task-view.ts";
import { stripAnsi } from "../domain/render-text.ts";
import { sanitizeToolContent, sanitizeToolText } from "../terminal-sanitize.ts";
import { deferGenerationRelease } from "../lifecycle/generation-handoff.ts";
import { getTextContent } from "../domain/tool-arguments.ts";
import { RuntimeHandle } from "../runtime/runtime-handle.ts";

const PATCH_FLAG = Symbol.for("pi-claudify:task-widget-patch");
const UI_ROUTE_PATCH = Symbol.for("pi-claudify:task-widget-ui-route");
const ACTIVE_ROUTE = Symbol.for("pi-claudify:task-widget-active-route");
const TASK_WIDGET_BRAND = Symbol.for("pi-claudify:task-widget-adapter");
const TASK_WIDGET_CONTROLLER = Symbol.for("pi-claudify:task-widget-controller");
const SURFACE = "task-widget-presentation";
const MAX_STAGED_CALLS = 64;
const MAX_LABELS = 200;
const RELOAD_CACHE_KEY = Symbol.for("pi-claudify:task-widget-label-cache");

interface TaskLabel { subject: string; activeForm?: string }
interface StagedTaskCall { name: TaskToolName; input: Record<string, any> }
function reloadCaches(): Map<string, Array<[string, TaskLabel]>> {
	const root = globalThis as Record<PropertyKey, unknown>;
	return (root[RELOAD_CACHE_KEY] ??= new Map<string, Array<[string, TaskLabel]>>()) as Map<string, Array<[string, TaskLabel]>>;
}

interface UiRouteRegistry { original: Function; controller: TaskPresentationController }
interface WidgetPatchRegistry {
	version: number;
	unclaimedHosts: any[];
	originalSet: (this: unknown, key: string, content: unknown, options?: unknown) => void;
	originalRender: (this: unknown, container: any, widgets: Map<string, any>, spacerWhenEmpty: boolean, leadingSpacer: boolean) => void;
}

function taskStatus(marker: string): TaskStatus {
	return marker === "✔" ? "completed" : marker === "◻" ? "pending" : "in_progress";
}
interface ParsedWidget { tasks: TaskViewRecord[]; overflow: string[]; overflowBefore: boolean; reported?: { total: number; completed: number; inProgress: number; pending: number } }
function parseRenderedTasks(lines: readonly string[], labelFor: (id: string) => TaskLabel | undefined): ParsedWidget | null {
	const plain = lines.map((line) => stripAnsi(line).trimEnd()).filter((line) => line.trim());
	const headerIndex = plain.findIndex((line) => /^\s*●\s*\d+\s+tasks?\s+\([^)]+\)\s*$/i.test(line));
	if (headerIndex < 0) return null;
	const header = plain[headerIndex].trim().match(/^●\s*(\d+)\s+tasks?\s+\(([^)]+)\)$/i);
	if (!header) return null;
	const buckets = { completed: 0, inProgress: 0, pending: 0 };
	for (const rawBucket of header[2].split(/\s*,\s*/)) {
		const bucket = rawBucket.match(/^(\d+)\s+(done|in progress|open)$/i);
		if (!bucket) return null;
		if (/^done$/i.test(bucket[2])) buckets.completed = Number(bucket[1]);
		else if (/^in progress$/i.test(bucket[2])) buckets.inProgress = Number(bucket[1]);
		else buckets.pending = Number(bucket[1]);
	}
	const reported: ParsedWidget["reported"] = { total: Number(header[1]), ...buckets };
	const tasks: TaskViewRecord[] = [];
	const overflow: string[] = [];
	let overflowBefore = false;
	for (const line of plain.slice(headerIndex + 1)) {
		const text = line.trim();
		if (/^…\s+(?:and\s+)?\d+\s+more/i.test(text)) { if (tasks.length === 0) overflowBefore = true; overflow.push(text); continue; }
		const match = text.match(/^(?:⎿\s+)?([✔◼◻✢✳✶✻✽✸*])\s+#([^\s]+)\s+(.+?)(?:\s+›\s+blocked by\s+(.+))?$/);
		if (!match) return null;
		const id = match[2];
		const blockers = match[4]?.match(/#([^,\s]+)/g)?.map((value) => value.slice(1)) ?? [];
		const active = !["✔", "◼", "◻"].includes(match[1]);
		const visibleText = active ? match[3].replace(/…\s*(?:\([^)]*\))?\s*$/, "").trim() : match[3].trim();
		const cached = labelFor(id);
		const subject = active ? cached?.subject ?? visibleText : visibleText;
		tasks.push({ id, status: active ? "in_progress" : taskStatus(match[1]), subject, description: "", activeForm: active ? visibleText : cached?.activeForm ?? subject, blocks: [], blockedBy: blockers, active });
	}
	tasks.sort((left, right) => {
		const a = Number(left.id), b = Number(right.id);
		return Number.isFinite(a) && Number.isFinite(b) ? a - b : left.id.localeCompare(right.id);
	});
	return tasks.length ? { tasks, overflow, overflowBefore, reported } : null;
}

function counts(tasks: readonly TaskViewRecord[]): Record<TaskStatus, number> {
	return tasks.reduce((value, task) => { value[task.status]++; return value; }, { pending: 0, in_progress: 0, completed: 0 });
}

class TaskWidgetAdapter implements Component {
	constructor(
		private readonly source: Component,
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly controller: TaskPresentationController,
	) { (this as any)[TASK_WIDGET_BRAND] = true; (this as any)[TASK_WIDGET_CONTROLLER] = controller; }

	render(width: number): string[] {
		const native = this.source.render(width);
		const parsed = this.controller.parseWidget(native);
		if (!parsed) { this.controller.markUnrecognized(); return native; }
		this.controller.markRecognized();
		const { tasks, overflow, overflowBefore, reported } = parsed;
		const safeWidth = Math.max(1, width);
		const active = this.controller.isWorking();
		this.controller.observeWorking(active);
		const counted = counts(tasks);
		const totalCount = reported?.total ?? tasks.length;
		const completedCount = reported?.completed ?? counted.completed;
		const inProgressCount = reported?.inProgress ?? counted.in_progress;
		const pendingCount = reported?.pending ?? counted.pending;
		const lines: string[] = [];
		if (!active) {
			const summary = `${this.theme.bold(String(totalCount))} ${totalCount === 1 ? "task" : "tasks"} (${this.theme.bold(String(completedCount))} done, ${this.theme.bold(String(inProgressCount))} in progress, ${this.theme.bold(String(pendingCount))} open)`;
			lines.push(this.theme.fg("dim", `  ${summary}`));
		}
		if (overflowBefore) for (const line of overflow) lines.push(this.theme.fg("dim", `  ${line}`));
		tasks.forEach((task, index) => {
			let marker: string;
			let subject: string;
			if (task.status === "completed") {
				marker = this.theme.fg("success", "✔");
				const struck = typeof (this.theme as any).strikethrough === "function" ? (this.theme as any).strikethrough(task.subject) : task.subject;
				subject = this.theme.fg("dim", struck);
			} else if (task.status === "in_progress") {
				marker = this.theme.fg("accent", "◼");
				subject = this.theme.bold(task.subject);
			} else {
				marker = "◻";
				subject = task.subject;
			}
			const blocker = task.blockedBy.length ? this.theme.fg("dim", ` › blocked by ${task.blockedBy.map((id) => `#${id}`).join(", ")}`) : "";
			const prefix = active ? (index === 0 ? "  ⎿  " : "     ") : "  ";
			lines.push(truncateToWidth(`${prefix}${marker} ${subject}${blocker}`, safeWidth, "…"));
		});
		if (!overflowBefore) for (const line of overflow) lines.push(this.theme.fg("dim", `  ${line}`));
		return lines.map((line) => visibleWidth(line) <= safeWidth ? line : truncateToWidth(line, safeWidth, "…"));
	}

	handleInput(data: string): void { this.source.handleInput?.(data); }
	handleMouse(event: any): any { return (this.source as any).handleMouse?.(event); }
	invalidate(): void { this.source.invalidate(); }
	dispose(): void { this.controller.markUnrecognized(); (this.source as any).dispose?.(); }
	sourceComponent(): Component { return this.source; }
}

export interface TaskPresentationOptions {
	isSupportedOwner(name: TaskToolName): boolean;
	toolEnabled(name: TaskToolName): boolean;
	refreshOwnership?(): void;
}

/** Presentation-only adapter over an externally owned `tasks` widget. */
export class TaskPresentationController {
	private recognized = false;
	private context?: any;
	private host?: any;
	private interactivePrototype?: any;
	private sessionKey?: string;
	private activeFormOverride?: string;
	private lastWorking?: boolean;
	private readonly labels = new Map<string, TaskLabel>();
	private readonly staged = new Map<string, StagedTaskCall>();

	constructor(private readonly runtime: RuntimeHandle, private readonly options: TaskPresentationOptions) {}

	register(pi: ExtensionAPI, InteractiveModeClass: any): void {
		if (!TASK_TOOL_NAMES.every((name) => this.options.toolEnabled(name)) || !this.installHostPatch(InteractiveModeClass)) return;
		const bind = (ctx: any, resetSession = false): void => {
			if (!this.runtime.isCurrent() || ctx?.mode !== "tui" || !ctx?.hasUI) return;
			this.context = ctx;
			this.installUiRoute(ctx.ui);
			this.adoptUnclaimedHost(ctx.ui?.theme);
			let nextSessionKey: string | undefined;
			try { nextSessionKey = String(ctx.sessionManager?.getSessionId?.() ?? ctx.sessionManager?.getSessionFile?.() ?? "") || undefined; } catch { nextSessionKey = undefined; }
			if (resetSession || nextSessionKey !== this.sessionKey) {
				this.labels.clear();
				this.staged.clear();
				this.activeFormOverride = undefined;
				this.recognized = false;
				this.lastWorking = undefined;
			}
			this.sessionKey = nextSessionKey;
			const cached = this.sessionKey ? reloadCaches().get(this.sessionKey) : undefined;
			if (cached) {
				this.labels.clear();
				for (const [id, label] of cached.slice(0, MAX_LABELS)) this.labels.set(id, { ...label });
				reloadCaches().delete(this.sessionKey!);
			}
		};
		pi.on("session_start", async (_event, ctx) => bind(ctx, true));
		pi.on("resources_discover", async (_event, ctx) => bind(ctx));
		pi.on("tool_call", async (event: any) => {
			const name = normalizeTaskToolName(event.toolName);
			if (!this.runtime.isCurrent() || !name || !this.options.toolEnabled(name) || !this.options.isSupportedOwner(name)) return;
			while (this.staged.size >= MAX_STAGED_CALLS) this.staged.delete(this.staged.keys().next().value!);
			this.staged.set(event.toolCallId, { name, input: { ...(event.input ?? {}) } });
		});
		pi.on("tool_result", async (event: any) => {
			const staged = this.staged.get(event.toolCallId);
			this.staged.delete(event.toolCallId);
			if (!staged || event.isError || !this.runtime.isCurrent()) return;
			this.commitLabels(staged, event);
		});
		pi.on("tool_execution_end", async (event: any) => { this.staged.delete(event.toolCallId); });
		pi.on("session_shutdown", async (event: any) => {
			this.recognized = false;
			this.activeFormOverride = undefined;
			this.lastWorking = undefined;
			this.staged.clear();
			if (event.reason === "reload" && this.sessionKey) reloadCaches().set(this.sessionKey, [...this.labels].map(([id, label]) => [id, { ...label }]));
			else {
				if (this.sessionKey) reloadCaches().delete(this.sessionKey);
				this.labels.clear();
			}
			this.context = undefined;
			this.host = undefined;
			if (event.reason !== "reload" && event.reason !== "quit") return;
			const release = () => testedPiPatchBroker.releaseSurface(this.runtime.owner, SURFACE);
			if (event.reason === "reload") deferGenerationRelease(release); else release();
		});
	}

	parseWidget(lines: readonly string[]): ParsedWidget | null {
		const parsed = parseRenderedTasks(lines, (id) => this.labels.get(id));
		if (!parsed) { this.activeFormOverride = undefined; return null; }
		const active = parsed.tasks.find((task) => task.active === true);
		const label = active ? this.labels.get(active.id) : undefined;
		this.activeFormOverride = active ? active.activeForm || label?.activeForm || label?.subject || active.subject : undefined;
		return parsed;
	}

	activeForm(): string | undefined { return this.recognized && this.isWorking() ? this.activeFormOverride : undefined; }
	isCurrent(): boolean { return this.runtime.isCurrent(); }

	private hasCompleteSupport(refresh = false): boolean {
		if (!this.runtime.isCurrent()) return false;
		if (refresh) this.options.refreshOwnership?.();
		return TASK_TOOL_NAMES.every((name) => this.options.toolEnabled(name) && this.options.isSupportedOwner(name));
	}

	supports(name: unknown): boolean {
		const taskName = normalizeTaskToolName(name);
		return !!taskName && this.recognized && this.hasCompleteSupport();
	}

	renderCall(name: string): Component | undefined { return this.supports(name) ? { render: () => [], invalidate() {} } : undefined; }
	renderResult(name: string, isError: boolean): Component | undefined { return this.supports(name) && !isError ? { render: () => [], invalidate() {} } : undefined; }
	shouldHideRow(value: unknown): boolean {
		const row = value as any;
		if (!this.supports(row?.toolName) || row?.isError === true || row?.result?.isError === true) return false;
		return !row?.result || row?.isPartial === true || this.resultRecognized(row);
	}
	shouldUseNativeResult(value: unknown): boolean {
		const row = value as any;
		if (!this.supports(row?.toolName)) return false;
		return row?.isError === true || row?.result?.isError === true || (!!row?.result && row?.isPartial !== true && !this.resultRecognized(row));
	}
	isWorking(): boolean {
		if (this.host?.activeStatusIndicator) return this.host.activeStatusIndicator.kind === "working";
		try { return this.context?.isIdle?.() === false; } catch { return false; }
	}
	private resultRecognized(row: any): boolean {
		const name = normalizeTaskToolName(row?.toolName);
		const result = row?.result ?? {};
		const details = result?.details ?? {};
		const text = getTextContent(result).trim();
		if (name === "TaskList") {
			const structured = details.tasks ?? details.toolUseResult?.tasks;
			const success = details.success ?? details.toolUseResult?.success;
			const validText = /^(?:No tasks(?: found)?\.?|Task list is empty\.?)$/i.test(text) || parseTaskListText(text).length > 0;
			return validText || (!text && success !== false && Array.isArray(structured));
		}
		if (name === "TaskCreate") {
			const task = details.task ?? details.toolUseResult?.task;
			const success = details.success ?? details.toolUseResult?.success;
			return /^Task\s+#\S+\s+created successfully:\s*\S/i.test(text)
				|| (!text && success !== false && !!task?.id && typeof task?.subject === "string");
		}
		if (name === "TaskGet") {
			const task = details.task ?? details.toolUseResult?.task;
			const success = details.success ?? details.toolUseResult?.success;
			const validText = /^Task\s+#\S+:\s*\S/i.test(text) && /^Status:\s*(?:pending|in_progress|completed)$/im.test(text);
			return validText || (!text && success !== false && !!task?.id && typeof task?.subject === "string");
		}
		if (name === "TaskUpdate") {
			const id = String(row?.args?.taskId ?? row?.args?.task_id ?? "");
			if (!id) return false;
			return new RegExp(`^Updated task #${id.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text)
				|| (details.success === true && String(details.taskId ?? "") === id)
				|| (details.toolUseResult?.success === true && String(details.toolUseResult.taskId ?? "") === id);
		}
		return false;
	}

	private remember(id: string, subject: string, activeForm?: string): void {
		const safeId = sanitizeToolText(id).trim();
		const safeSubject = sanitizeToolContent(subject).trim();
		if (!safeId || !safeSubject) return;
		if (!this.labels.has(safeId) && this.labels.size >= MAX_LABELS) this.labels.delete(this.labels.keys().next().value!);
		this.labels.set(safeId, { subject: safeSubject, activeForm: sanitizeToolContent(activeForm ?? "").trim() || undefined });
	}

	private commitLabels(call: StagedTaskCall, result: any): void {
		const text = getTextContent(result).trim();
		if (call.name === "TaskCreate") {
			const textId = text.match(/^Task\s+#([^\s]+)\s+created successfully:\s*\S/i)?.[1];
			const structured = result?.details?.task ?? result?.details?.toolUseResult?.task;
			const structuredFlag = result?.details?.success ?? result?.details?.toolUseResult?.success;
			const structuredSuccess = !text && structuredFlag !== false && !!structured?.id && typeof structured?.subject === "string";
			const id = textId ?? (structuredSuccess ? String(structured.id) : "");
			if (!id) return;
			this.remember(id, String(call.input.subject ?? ""), String(call.input.activeForm ?? call.input.active_form ?? ""));
		} else if (call.name === "TaskUpdate") {
			const id = String(call.input.taskId ?? call.input.task_id ?? "");
			const resultId = String(result?.details?.taskId ?? result?.details?.toolUseResult?.taskId ?? "");
			const success = new RegExp(`^Updated task #${id.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text)
				|| (result?.details?.success === true && !!resultId && resultId === id)
				|| (result?.details?.toolUseResult?.success === true && !!resultId && resultId === id);
			if (!id || !success) return;
			const previous = this.labels.get(id);
			const subject = typeof call.input.subject === "string" ? call.input.subject : previous?.subject;
			const activeForm = typeof (call.input.activeForm ?? call.input.active_form) === "string" ? call.input.activeForm ?? call.input.active_form : previous?.activeForm;
			if (subject) this.remember(id, subject, activeForm);
		} else if (call.name === "TaskGet") {
			if (!this.resultRecognized({ toolName: "TaskGet", result })) return;
			const task = result?.details?.task ?? result?.details?.toolUseResult?.task;
			if (task?.id && task?.subject) this.remember(String(task.id), String(task.subject), String(task.activeForm ?? task.active_form ?? ""));
		} else if (call.name === "TaskList") {
			for (const task of parseTaskListText(text)) this.remember(task.id, task.subject, this.labels.get(task.id)?.activeForm);
		}
	}

	observeWorking(value: boolean): void {
		if (this.lastWorking === value) return;
		this.lastWorking = value;
		queueMicrotask(() => { try { this.host?.renderWidgets?.(); } catch {} });
	}

	markRecognized(): void {
		const changed = !this.recognized;
		this.recognized = true;
		if (changed) queueMicrotask(() => { try { this.host?.renderWidgets?.(); } catch {} });
	}
	markUnrecognized(): void {
		const changed = this.recognized || this.activeFormOverride !== undefined;
		this.recognized = false;
		this.activeFormOverride = undefined;
		this.lastWorking = undefined;
		if (changed) queueMicrotask(() => { try { this.host?.renderWidgets?.(); } catch {} });
	}

	private wrapContent(content: unknown): unknown {
		if (!this.hasCompleteSupport(true)) return content;
		if (content === undefined) { this.markUnrecognized(); return content; }
		const active = this;
		return typeof content === "function"
			? (tui: TUI, theme: Theme) => {
				const source = (content as any)(tui, theme);
				return source && typeof source.render === "function" ? new TaskWidgetAdapter(source, tui, theme, active) : source;
			}
			: (tui: TUI, theme: Theme) => {
				const lines = Array.isArray(content) ? content.map(String) : [String(content)];
				const source: Component = { render: () => lines, invalidate() {} };
				return new TaskWidgetAdapter(source, tui, theme, active);
			};
	}

	private installUiRoute(ui: any): void {
		if (!ui || typeof ui.setWidget !== "function") return;
		let registry = ui[UI_ROUTE_PATCH] as UiRouteRegistry | undefined;
		if (registry) { registry.controller = this; return; }
		registry = { original: ui.setWidget, controller: this };
		ui[UI_ROUTE_PATCH] = registry;
		ui.setWidget = function routedTaskWidget(this: any, ...args: any[]) {
			const root = globalThis as Record<PropertyKey, unknown>;
			const previous = root[ACTIVE_ROUTE];
			root[ACTIVE_ROUTE] = registry!.controller;
			try { return registry!.original.apply(this, args); }
			finally {
				if (previous === undefined) delete root[ACTIVE_ROUTE]; else root[ACTIVE_ROUTE] = previous;
			}
		};
	}

	private adoptUnclaimedHost(theme: Theme | undefined): void {
		if (!this.hasCompleteSupport(true)) return;
		const registry = this.interactivePrototype?.[PATCH_FLAG] as WidgetPatchRegistry | undefined;
		const candidate = this.host ?? (registry?.unclaimedHosts.length === 1 ? registry.unclaimedHosts.pop() : undefined);
		if (!candidate) return;
		this.host = candidate;
		if (!theme) return;
		const map = candidate.extensionWidgetsAbove as Map<string, any> | undefined;
		const existing = map?.get("tasks");
		if (!existing) return;
		const source = (existing as any)?.[TASK_WIDGET_BRAND] && typeof (existing as any).sourceComponent === "function" ? (existing as any).sourceComponent() : existing;
		if (!source || typeof source.render !== "function") return;
		map!.set("tasks", new TaskWidgetAdapter(source, candidate.ui, theme, this));
		try { candidate.renderWidgets?.(); } catch {}
	}

	private installHostPatch(InteractiveModeClass: any): boolean {
		const proto = InteractiveModeClass?.prototype as any;
		if (!proto || typeof proto.setExtensionWidget !== "function" || typeof proto.renderWidgetContainer !== "function") return false;
		this.interactivePrototype = proto;
		const predecessor = testedPiPatchBroker.values<TaskPresentationController>(SURFACE).find((candidate) => !candidate.isCurrent() && candidate.host);
		if (predecessor) this.host = predecessor.host;
		let registry = proto[PATCH_FLAG] as WidgetPatchRegistry | undefined;
		if (!registry || registry.version !== 3) {
			registry = {
				version: 3,
				unclaimedHosts: registry?.unclaimedHosts ?? [],
				originalSet: registry?.originalSet ?? proto.setExtensionWidget,
				originalRender: registry?.originalRender ?? proto.renderWidgetContainer,
			};
			proto[PATCH_FLAG] = registry;
			proto.setExtensionWidget = function stableTaskWidgetSetter(this: any, key: string, content: unknown, options?: unknown) {
				const routed = (globalThis as Record<PropertyKey, unknown>)[ACTIVE_ROUTE] as TaskPresentationController | undefined;
				const candidates = testedPiPatchBroker.values<TaskPresentationController>(SURFACE).filter((candidate) => candidate.isCurrent());
				const active = routed?.isCurrent() ? routed : candidates.find((candidate) => candidate.host === this) ?? (candidates.length === 1 ? candidates[0] : undefined);
				if (active) active.host = this;
				else if (key === "tasks" && !registry!.unclaimedHosts.includes(this)) {
					registry!.unclaimedHosts.push(this);
					if (registry!.unclaimedHosts.length > 16) registry!.unclaimedHosts.shift();
				}
				return registry!.originalSet.call(this, key, key === "tasks" && active ? active.wrapContent(content) : content, options);
			};
			proto.renderWidgetContainer = function stableTaskWidgetContainer(this: any, container: any, widgets: Map<string, any>, spacerWhenEmpty: boolean, leadingSpacer: boolean) {
				registry!.originalRender.call(this, container, widgets, spacerWhenEmpty, leadingSpacer);
				if (!leadingSpacer || widgets.size !== 1) return;
				const taskWidget = widgets.values().next().value;
				const controller = (taskWidget as any)?.[TASK_WIDGET_CONTROLLER] as TaskPresentationController | undefined;
				if (!(taskWidget as any)?.[TASK_WIDGET_BRAND] || !controller?.recognized || !controller.isWorking() || !Array.isArray(container?.children) || container.children.length === 0) return;
				if (container.children[0]?.constructor?.name !== "Spacer") return;
				container.children.shift();
			};
		}
		testedPiPatchBroker.bind(this.runtime.owner, SURFACE, this);
		return true;
	}
}
