import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { InteractiveMode, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { trackedTempDir } from "./sandbox-home.ts";

const root = trackedTempDir("claudify-task-integration");
const oldHome = process.env.HOME;
try {
	process.env.HOME = root; mkdirSync(join(root, ".pi"), { recursive: true }); initTheme("dark", false);
	const { default: claudify } = await import(`../extensions/index.ts?task-integration=${Date.now()}`);
	const definition = {
		name: "TaskList", label: "TaskList", description: "external tasks", parameters: {}, execute: async () => ({ content: [] }),
		renderCall: () => new Text("EXTERNAL_CALL", 0, 0), renderResult: () => new Text("EXTERNAL_RESULT", 0, 0),
		sourceInfo: { source: "extension:tasks", path: "/external/tasks.ts" },
	};
	const events = new Map<string, Function[]>();
	const registered: string[] = [];
	const ui: any = { theme: {}, requestRender() {}, custom() {} };
	const pi = {
		registerTool(value: any) { registered.push(String(value?.name)); }, registerCommand() {}, sendUserMessage() {}, getThinkingLevel() { return "off"; },
		getAllTools() { return [definition, ...["TaskCreate", "TaskGet", "TaskUpdate"].map((name) => ({ name, sourceInfo: { source: "extension:tasks", path: "/external/tasks.ts" } }))]; },
		on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); },
	};
	claudify(pi as any);
	assert.equal(registered.some((name) => /^Task(?:Create|List|Get|Update)$/i.test(name)), false, "Claudify never registers or replaces Task execution tools");
	const ctx = { mode: "tui", hasUI: true, cwd: root, isIdle: () => true, sessionManager: { getSessionId: () => "task-integration" }, ui };
	for (const handler of events.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
	const mode: any = { extensionWidgetsAbove: new Map(), extensionWidgetsBelow: new Map(), ui: { requestRender() {} }, renderWidgets() {}, activeStatusIndicator: undefined };
	(InteractiveMode.prototype as any).setExtensionWidget.call(mode, "tasks", ["● 1 task (1 open)", "◻ #1 Build UI"]);
	const widget = mode.extensionWidgetsAbove.get("tasks");
	assert.match(widget.render(80).join("\n"), /1 task \(0 done, 0 in progress, 1 open\)/);
	const result = { content: [{ type: "text", text: "#1 [pending] Build UI" }], details: {}, isError: false };
	const row = new ToolExecutionComponent("TaskList", "task-list", {}, { showImages: false }, definition as any, { requestRender() {}, previousLines: [] } as any, root);
	row.markExecutionStarted(); row.setArgsComplete(); row.updateResult(result as any, false);
	assert.deepEqual(row.render(80), [], "successful task CRUD is hidden from transcript in collapsed mode");
	row.setExpanded(true);
	assert.deepEqual(row.render(80), [], "successful task CRUD remains hidden when tools are expanded");
	const failed = new ToolExecutionComponent("TaskList", "task-error", {}, { showImages: false }, definition as any, { requestRender() {}, previousLines: [] } as any, root);
	failed.markExecutionStarted(); failed.setArgsComplete(); failed.updateResult({ content: [{ type: "text", text: "task service unavailable" }], details: {}, isError: true } as any, false);
	const failedText = failed.render(80).join("\n");
	assert.match(failedText, /EXTERNAL_CALL/);
	assert.match(failedText, /EXTERNAL_RESULT/, "task errors preserve the complete external call/result UI");
	const malformed = new ToolExecutionComponent("TaskList", "task-malformed", {}, { showImages: false }, definition as any, { requestRender() {}, previousLines: [] } as any, root);
	malformed.markExecutionStarted(); malformed.setArgsComplete(); malformed.updateResult({ content: [{ type: "text", text: "unexpected success grammar" }], details: {}, isError: false } as any, false);
	const malformedText = malformed.render(80).join("\n");
	assert.match(malformedText, /EXTERNAL_CALL/);
	assert.match(malformedText, /EXTERNAL_RESULT/, "malformed successful Task results fail fully native instead of disappearing");
} finally {
	if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
	rmSync(root, { recursive: true, force: true });
}
console.log("task presentation integration tests passed");
