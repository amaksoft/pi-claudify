import assert from "node:assert/strict";
import { Container, Spacer, visibleWidth } from "@earendil-works/pi-tui";

import { parseTaskListText, taskPresentationEnvironmentEnabled } from "../extensions/domain/task-view.ts";
import { RuntimeHandle } from "../extensions/runtime/runtime-handle.ts";
import { TaskPresentationController } from "../extensions/tools/task-presentation.ts";

const parsed = parseTaskListText("#1 [completed] Completed sample\n#2 [in_progress] Active sample (capture-owner)\n#3 [pending] Pending blocked sample [blocked by #2]");
assert.equal(parsed.length, 3);
assert.equal(parsed[1].owner, "capture-owner");
assert.deepEqual(parsed[2].blockedBy, ["2"]);
assert.equal(parseTaskListText("#1 [pending] Fix parser (phase 2)")[0]?.subject, "Fix parser (phase 2)");
assert.deepEqual(parseTaskListText("#1 [pending] Good\nmalformed row"), [], "partially malformed task lists fail native");
assert.deepEqual(parseTaskListText("#1 [mystery] Unknown status"), [], "unknown statuses fail native");
assert.equal(taskPresentationEnvironmentEnabled(undefined), true);
assert.equal(taskPresentationEnvironmentEnabled("0"), false);

class FakePi {
	events = new Map<string, Function[]>();
	on(name: string, handler: Function): void { this.events.set(name, [...(this.events.get(name) ?? []), handler]); }
	async emit(name: string, event: any, ctx: any = {}): Promise<void> { for (const handler of this.events.get(name) ?? []) await handler(event, ctx); }
}

const theme = { fg: (_key: string, text: string) => text, bold: (text: string) => text, strikethrough: (text: string) => `~${text}~` } as any;
class FakeInteractiveMode {
	activeStatusIndicator: any;
	extensionWidgetsAbove = new Map<string, any>();
	ui = { requestRender() {} };
	renderCount = 0;
	setExtensionWidget(key: string, content: any): void {
		if (content === undefined) this.extensionWidgetsAbove.delete(key);
		else this.extensionWidgetsAbove.set(key, typeof content === "function" ? content(this.ui, theme) : { render: () => content, invalidate() {} });
	}
	renderWidgetContainer(container: any, widgets: Map<string, any>, spacerWhenEmpty: boolean, leadingSpacer: boolean): void {
		container.clear();
		if (widgets.size === 0) { if (spacerWhenEmpty) container.addChild(new Spacer(1)); return; }
		if (leadingSpacer) container.addChild(new Spacer(1));
		for (const component of widgets.values()) container.addChild(component);
	}
	renderWidgets(): void { this.renderCount++; }
}

const pi = new FakePi();
const runtime = new RuntimeHandle("tasks"); runtime.activate();
const controller = new TaskPresentationController(runtime, { isSupportedOwner: () => true, toolEnabled: () => true });
controller.register(pi as any, FakeInteractiveMode);
const context = { mode: "tui", hasUI: true, ui: {}, sessionManager: { getSessionId: () => "tasks" } };
await pi.emit("session_start", { reason: "startup" }, context);
await pi.emit("tool_call", { toolCallId: "create-active", toolName: "TaskCreate", input: { subject: "Active sample", activeForm: "Sampling active task color" } });
await pi.emit("tool_result", { toolCallId: "create-active", toolName: "TaskCreate", content: [{ type: "text", text: "Task #2 created successfully: Active sample" }], details: { task: { id: "2", subject: "Active sample" } }, isError: false });
await pi.emit("tool_call", { toolCallId: "bad-update", toolName: "TaskUpdate", input: { taskId: "2", subject: "Poisoned subject" } });
await pi.emit("tool_result", { toolCallId: "bad-update", toolName: "TaskUpdate", content: [{ type: "text", text: "Task #2 not found" }], details: { success: false, taskId: "2" }, isError: false });
const mode = new FakeInteractiveMode();
mode.setExtensionWidget("tasks", ["● 3 tasks (1 done, 1 in progress, 1 open)", "◻ #3 Pending blocked sample › blocked by #2", "✔ #1 Completed sample", "✸ #2 Sampling active task color… (11m 50s · ↑ 9.8k ↓ 790)"]);
const widget = mode.extensionWidgetsAbove.get("tasks");
let lines = widget.render(80);
await Promise.resolve();
assert.match(lines[0], /3 tasks \(1 done, 1 in progress, 1 open\)/);
assert.doesNotMatch(lines.join("\n"), /^\s*[✔◼◻] #/m, "task IDs stay hidden from task rows");
assert.doesNotMatch(lines.join("\n"), /11m 50s|9\.8k/, "per-task metrics stay hidden");
assert.equal(controller.supports("TaskList"), true);
assert.equal(controller.shouldHideRow({ toolName: "TaskGet", result: { content: [], details: { success: false, task: { id: "9", subject: "Poison" } } }, isError: false }), false, "explicitly unsuccessful structured TaskGet results remain native");
assert.equal(controller.shouldHideRow({ toolName: "TaskList", result: { content: [{ type: "text", text: "failed to list" }], details: { success: false, tasks: [] } }, isError: false }), false, "explicitly unsuccessful structured TaskList results remain native");
assert.deepEqual(controller.renderCall("TaskCreate")?.render(80), []);
assert.deepEqual(controller.renderResult("TaskUpdate", false)?.render(80), []);
assert.equal(controller.renderResult("TaskUpdate", true), undefined);
for (const line of widget.render(18)) assert.ok(visibleWidth(line) <= 18, "task rows truncate instead of wrapping");
mode.setExtensionWidget("tasks", ["● 20 tasks (1 done, 1 in progress, 18 open)", "✔ #1 First", "◻ #2 Second", "… and 18 more"]);
const overflowLines = mode.extensionWidgetsAbove.get("tasks").render(80).join("\n");
assert.match(overflowLines, /20 tasks \(1 done, 1 in progress, 18 open\)/, "reported totals include hidden overflow tasks");
assert.match(overflowLines, /… and 18 more/);
const activeContent = ["● 3 tasks (1 done, 1 in progress, 1 open)", "✔ #1 Completed sample", "✸ #2 Sampling active task color… (11m 50s · ↑ 9.8k ↓ 790)", "◻ #3 Pending blocked sample › blocked by #2"];
mode.setExtensionWidget("tasks", activeContent);
let activeWidget = mode.extensionWidgetsAbove.get("tasks");
activeWidget.render(80);

mode.activeStatusIndicator = { kind: "working" };
lines = activeWidget.render(80);
assert.doesNotMatch(lines.join("\n"), /3 tasks/);
assert.match(lines[0], /^  ⎿  ✔/);
assert.match(lines[1], /◼ Active sample/, "active row uses the task subject rather than activeForm metrics");
assert.equal(controller.activeForm(), "Sampling active task color");
await pi.emit("tool_call", { toolCallId: "structured-create", toolName: "TaskCreate", input: { subject: "Structured subject", activeForm: "Structuring" } });
await pi.emit("tool_result", { toolCallId: "structured-create", toolName: "TaskCreate", content: [], details: { task: { id: "5", subject: "Structured subject" } }, isError: false });
mode.setExtensionWidget("tasks", ["● 1 tasks (0 done, 1 in progress, 0 open)", "✢ #5 Raw active row"]);
assert.match(mode.extensionWidgetsAbove.get("tasks").render(80).join("\n"), /Structured subject/, "structured-only successful creates populate presentation labels");
assert.equal(controller.activeForm(), "Raw active row", "the authoritative starred row wins over cached active-form text");
await pi.emit("tool_call", { toolCallId: "malformed-create", toolName: "TaskCreate", input: { subject: "Poison", activeForm: "Poisoning" } });
await pi.emit("tool_result", { toolCallId: "malformed-create", toolName: "TaskCreate", content: [{ type: "text", text: "Task #6 created successfully:" }], details: { task: { id: "6", subject: "Poison" } }, isError: false });
mode.setExtensionWidget("tasks", ["● 1 tasks (0 done, 1 in progress, 0 open)", "✢ #6 Native active row"]);
assert.match(mode.extensionWidgetsAbove.get("tasks").render(80).join("\n"), /Native active row/, "malformed nonempty create output cannot poison the label cache");
assert.equal(controller.activeForm(), "Native active row");
mode.setExtensionWidget("tasks", activeContent);
activeWidget = mode.extensionWidgetsAbove.get("tasks");
activeWidget.render(80);
const container = new Container();
mode.renderWidgetContainer(container, mode.extensionWidgetsAbove, true, true);
assert.equal((container as any).children.length, 1, "recognized sole active task widget attaches without the host's leading spacer");
mode.activeStatusIndicator = undefined;
activeWidget.render(80);
mode.renderWidgetContainer(container, mode.extensionWidgetsAbove, true, true);
assert.equal((container as any).children.length, 2, "idle transition restores the host's leading spacer");

mode.setExtensionWidget("tasks", ["unknown external widget grammar"]);
const unknownWidget = mode.extensionWidgetsAbove.get("tasks");
assert.deepEqual(unknownWidget.render(80), ["unknown external widget grammar"], "unknown widget grammar passes through");
assert.equal(controller.supports("TaskList"), false);
mode.setExtensionWidget("tasks", ["◻ #1 Headerless task"]);
assert.deepEqual(mode.extensionWidgetsAbove.get("tasks").render(80), ["◻ #1 Headerless task"], "marker rows without the authoritative pi-tasks header fail native");
assert.equal(controller.supports("TaskList"), false);
mode.setExtensionWidget("other-widget", ["foreign"]);
assert.deepEqual(mode.extensionWidgetsAbove.get("other-widget").render(80), ["foreign"], "unrelated widgets pass through unchanged");
mode.setExtensionWidget("tasks", ["● 1 task (1 open)", "◻ #1 Disposable task"]);
const disposableWidget = mode.extensionWidgetsAbove.get("tasks");
disposableWidget.render(80);
assert.equal(controller.supports("TaskList"), true);
disposableWidget.dispose();
assert.equal(controller.supports("TaskList"), false, "widget disposal clears transcript-hiding authority");
mode.setExtensionWidget("tasks", undefined);
assert.equal(mode.extensionWidgetsAbove.has("tasks"), false, "external visibility controls remain authoritative");

await pi.emit("session_shutdown", { reason: "quit" }, context);
assert.equal(controller.supports("TaskList"), false, "disposal clears transcript-hiding authority");

class DisabledMode extends FakeInteractiveMode {}
const disabledPi = new FakePi();
const disabledRuntime = new RuntimeHandle("tasks-disabled"); disabledRuntime.activate();
new TaskPresentationController(disabledRuntime, { isSupportedOwner: () => true, toolEnabled: () => false }).register(disabledPi as any, DisabledMode);
const disabledMode = new DisabledMode();
disabledMode.setExtensionWidget("tasks", ["◻ Native task"]);
assert.deepEqual(disabledMode.extensionWidgetsAbove.get("tasks").render(80), ["◻ Native task"], "family/exact switches install no adapter");

class UnsupportedMode extends FakeInteractiveMode {}
const unsupportedPi = new FakePi();
const unsupportedRuntime = new RuntimeHandle("tasks-unsupported"); unsupportedRuntime.activate();
new TaskPresentationController(unsupportedRuntime, { isSupportedOwner: () => false, toolEnabled: () => true }).register(unsupportedPi as any, UnsupportedMode);
const unsupportedMode = new UnsupportedMode();
unsupportedMode.setExtensionWidget("tasks", ["◻ Native task"]);
assert.deepEqual(unsupportedMode.extensionWidgetsAbove.get("tasks").render(80), ["◻ Native task"], "builtin or unknown task ownership remains native");
await unsupportedPi.emit("session_shutdown", { reason: "quit" }, context);

class NestedMode extends FakeInteractiveMode {}
const parentPi = new FakePi(), childPi = new FakePi();
const parentRuntime = new RuntimeHandle("task-parent"), childRuntime = new RuntimeHandle("task-child"); parentRuntime.activate(); childRuntime.activate();
const parentController = new TaskPresentationController(parentRuntime, { isSupportedOwner: () => true, toolEnabled: () => true });
const childController = new TaskPresentationController(childRuntime, { isSupportedOwner: () => true, toolEnabled: () => true });
parentController.register(parentPi as any, NestedMode); childController.register(childPi as any, NestedMode);
const parentMode = new NestedMode(), childMode = new NestedMode(); childMode.activeStatusIndicator = { kind: "working" };
const parentUi = { theme, setWidget: (...args: any[]) => (parentMode as any).setExtensionWidget(...args) };
const childUi = { theme, setWidget: (...args: any[]) => (childMode as any).setExtensionWidget(...args) };
await parentPi.emit("session_start", {}, { ...context, ui: parentUi });
parentUi.setWidget("tasks", ["● 1 task (1 open)", "◻ #1 Parent task"]);
childMode.setExtensionWidget("tasks", ["● 1 task (1 in progress)", "◼ #1 Child task"]);
assert.deepEqual(childMode.extensionWidgetsAbove.get("tasks").render(80), ["● 1 task (1 in progress)", "◼ #1 Child task"], "ambiguous pre-bind nested widget initially fails native");
await childPi.emit("session_start", {}, { ...context, ui: childUi });
assert.match(parentMode.extensionWidgetsAbove.get("tasks").render(80).join("\n"), /1 task \(/);
assert.doesNotMatch(childMode.extensionWidgetsAbove.get("tasks").render(80).join("\n"), /1 task \(/, "late child binding adopts and wraps its own existing widget without using the outer controller");
await childPi.emit("session_shutdown", { reason: "quit" }, { ...context, ui: childUi });
await parentPi.emit("session_shutdown", { reason: "quit" }, { ...context, ui: parentUi });

console.log("task presentation tests passed");
