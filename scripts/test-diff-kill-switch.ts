import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolExecutionComponent, createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { trackedTempDir } from "./sandbox-home.ts";

const root = trackedTempDir("claudify-diff-kill-switch");
const oldHome = process.env.HOME;
try {
	process.env.HOME = root;
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ compatibility: { features: { diffPresentation: false } } }));
	initTheme("dark", false);
	const { default: claudify } = await import(`../extensions/index.ts?diff-kill=${Date.now()}`);
	const nativeEdit = createEditToolDefinition(root);
	const nativeWrite = createWriteToolDefinition(root);
	const applyPatch = { name: "apply_patch", label: "apply_patch", description: "patch", parameters: {}, execute: async () => ({ content: [] }), renderCall: () => new Text("NATIVE_APPLY", 0, 0) };
	const tools = new Map<string, any>([["edit", nativeEdit], ["write", nativeWrite], ["apply_patch", applyPatch]]);
	const events = new Map<string, Function[]>();
	const pi = {
		registerTool(definition: any) { tools.set(definition.name, definition); }, registerCommand() {},
		on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); },
		getAllTools() { return [...tools.values()].map((definition) => ({ ...definition, sourceInfo: { source: definition.name === "apply_patch" ? "extension:test" : "builtin", path: definition.name === "apply_patch" ? "/test/apply.ts" : `<builtin:${definition.name}>` } })); },
		getThinkingLevel() { return "off"; }, sendUserMessage() {},
	};
	claudify(pi as any);
	for (const handler of events.get("session_start") ?? []) await handler({ reason: "startup" }, { mode: "tui", hasUI: true, cwd: root, sessionManager: { getSessionId: () => "diff-off" }, ui: { theme: {}, requestRender() {}, custom() {}, input() {} }, isProjectTrusted: () => false });
	const row = (name: string, args: any, details: any) => {
		const component = new ToolExecutionComponent(name, `diff-off-${name}`, args, { showImages: false }, tools.get(name), { requestRender() {}, previousLines: [] } as any, root);
		component.markExecutionStarted(); component.setArgsComplete();
		component.updateResult({ content: [{ type: "text", text: "done" }], details, isError: false } as any, false);
		return component.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
	};
	const edit = row("edit", { path: "x.ts", edits: [{ oldText: "a", newText: "b" }] }, { patch: "@@ -1 +1 @@\n-a\n+b\n" });
	assert.match(edit, /Applied/);
	assert.doesNotMatch(edit, /rendering diff|^-a$|^\+b$/m);
	const write = row("write", { path: "x.ts", content: "b" }, { _type: "diff", diff: { lines: [], added: 1, removed: 1 } });
	assert.match(write, /Written/);
	assert.doesNotMatch(write, /rendering diff/);
	const apply = row("apply_patch", { patchText: "*** Begin Patch\n*** Update File: x.ts\n@@\n-a\n+b\n*** End Patch" }, {});
	assert.doesNotMatch(apply, /rendering|^-a$|^\+b$/m);
} finally {
	if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
	rmSync(root, { recursive: true, force: true });
}
console.log("diff presentation kill-switch tests passed");
