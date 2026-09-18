import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	ToolExecutionComponent,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { trackedTempDir } from "./sandbox-home.ts";

const root = trackedTempDir("claudify-native-execution");
const oldHome = process.env.HOME;
const oldMode = process.env.PI_CLAUDIFY_NATIVE_EXECUTION;
try {
	process.env.HOME = root;
	process.env.PI_CLAUDIFY_NATIVE_EXECUTION = "1";
	mkdirSync(join(root, ".pi"), { recursive: true });
	initTheme("dark", false);
	const { default: claudify } = await import(`../extensions/index.ts?native-execution-test=${Date.now()}`);
	const definitions = [
		createReadToolDefinition(root), createBashToolDefinition(root), createGrepToolDefinition(root),
		createFindToolDefinition(root), createLsToolDefinition(root), createWriteToolDefinition(root), createEditToolDefinition(root),
	];
	const originals = new Map(definitions.map((definition: any) => [definition.name, definition]));
	const tools = new Map(originals);
	const events = new Map<string, Function[]>();
	const pi = {
		registerTool(definition: any) { tools.set(definition.name, definition); },
		registerCommand() {},
		on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); },
		getAllTools() {
			return [...tools.values()].map((definition: any) => originals.has(definition.name)
				? { ...definition, sourceInfo: { source: "builtin", path: `<builtin:${definition.name}>` } }
				: definition);
		},
		getThinkingLevel() { return "off"; },
		sendUserMessage() {},
	};
	claudify(pi as any);
	for (const name of ["read", "bash", "grep", "find", "ls", "write", "edit"]) {
		assert.equal(tools.get(name), originals.get(name), `${name} execution definition remains exactly Pi-owned`);
	}
	for (const handler of events.get("session_start") ?? []) {
		await handler({ reason: "startup" }, { mode: "tui", hasUI: true, cwd: root, ui: { theme: {}, requestRender() {}, setHeader() {}, setFooter() {}, setHiddenThinkingLabel() {}, setWidget() {}, custom() {}, input() {} }, isProjectTrusted: () => false });
	}
	const read = new ToolExecutionComponent(
		"read", "native-read", { path: "sample.txt" }, { showImages: false }, tools.get("read"),
		{ requestRender() {}, previousLines: [] } as any, root,
	);
	read.markExecutionStarted(); read.setArgsComplete();
	read.updateResult({ content: [{ type: "text", text: "hello" }], details: {}, isError: false } as any, false);
	assert.match(read.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, ""), /Read\(/, "Pi-owned read receives Claudify presentation");
	const edit = new ToolExecutionComponent(
		"edit", "native-edit", { path: "sample.ts", edits: [{ oldText: "a", newText: "b" }] }, { showImages: false }, tools.get("edit"),
		{ requestRender() {}, previousLines: [] } as any, root,
	);
	edit.markExecutionStarted(); edit.setArgsComplete();
	edit.updateResult({ content: [{ type: "text", text: "updated" }], details: { patch: "@@ -1,1 +1,1 @@\n-a\n+b\n" }, isError: false } as any, false);
	assert.match(edit.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, ""), /Update\(/, "Pi-owned self-shell edit receives Claudify presentation from registry ownership");
	const externalSelfShell = {
		...createGrepToolDefinition(root),
		renderShell: "self",
		renderCall: () => new Text("EXTERNAL_SELF_SHELL", 0, 0),
		sourceInfo: { source: "extension:external", path: "/external/grep.ts" },
	};
	const externalRow = new ToolExecutionComponent(
		"grep", "external-self", { pattern: "needle" }, { showImages: false }, externalSelfShell as any,
		{ requestRender() {}, previousLines: [] } as any, root,
	);
	assert.match(externalRow.render(100).join("\n"), /EXTERNAL_SELF_SHELL/, "external self-owned shells are never replaced by builtin presentation adapters");

	writeFileSync(join(root, "value.ts"), "const value = 1;\n");
	const input = { path: "value.ts", content: "const value = 2;\n" };
	for (const handler of events.get("tool_call") ?? []) await handler({ toolCallId: "write-1", toolName: "write", input }, { cwd: root });
	writeFileSync(join(root, "value.ts"), input.content);
	let details: any = {};
	for (const handler of events.get("tool_result") ?? []) {
		const patch = await handler({ toolCallId: "write-1", toolName: "write", input, content: [{ type: "text", text: "wrote" }], details, isError: false }, { cwd: root });
		if (patch?.details) details = patch.details;
	}
	assert.equal(details._type, "diff", "presentation provenance is attached after Pi-owned execution");
	assert.equal(readFileSync(join(root, "value.ts"), "utf8"), input.content);
} finally {
	if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
	if (oldMode === undefined) delete process.env.PI_CLAUDIFY_NATIVE_EXECUTION; else process.env.PI_CLAUDIFY_NATIVE_EXECUTION = oldMode;
	rmSync(root, { recursive: true, force: true });
}

console.log("native execution profile tests passed");
