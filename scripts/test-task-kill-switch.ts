import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { trackedTempDir } from "./sandbox-home.ts";

const root = trackedTempDir("claudify-task-kill-switch");
const oldHome = process.env.HOME;
try {
	process.env.HOME = root;
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ compatibility: { tools: { "task:*": false } } }));
	initTheme("dark", false);
	const { default: claudify } = await import(`../extensions/index.ts?task-kill=${Date.now()}`);
	const native = {
		name: "TaskList", label: "TaskList", description: "external task list", parameters: {},
		execute: async () => ({ content: [] }),
		renderCall: () => new Text("EXTERNAL_TASK_CALL", 0, 0),
		renderResult: () => new Text("EXTERNAL_TASK_RESULT", 0, 0),
		sourceInfo: { source: "extension:tasks", path: "/external/tasks.ts" },
	};
	const events = new Map<string, Function[]>();
	const pi = {
		registerTool() {}, registerCommand() {}, sendUserMessage() {}, getThinkingLevel() { return "off"; },
		getAllTools() { return [native]; },
		on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); },
	};
	claudify(pi as any);
	const ctx = { mode: "tui", hasUI: true, sessionManager: { getSessionId: () => "task-kill" }, ui: { theme: {}, requestRender() {}, custom() {}, setWidget() {} } };
	for (const handler of events.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
	const row = new ToolExecutionComponent("TaskList", "task-kill", {}, { showImages: false }, native as any, { requestRender() {}, previousLines: [] } as any, root);
	row.markExecutionStarted(); row.setArgsComplete();
	row.updateResult({ content: [{ type: "text", text: "#1 [pending] Test" }], details: {}, isError: false } as any, false);
	const rendered = row.render(80).join("\n");
	assert.match(rendered, /EXTERNAL_TASK_CALL/);
	assert.match(rendered, /EXTERNAL_TASK_RESULT/, "task kill switch preserves the external owner's native UI");
} finally {
	if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
	rmSync(root, { recursive: true, force: true });
}
console.log("task presentation kill-switch tests passed");
