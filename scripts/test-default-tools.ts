import { trackedTempDir } from "./sandbox-home.ts";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = trackedTempDir("pi-claudify-default-tools");
const previousHome = process.env.HOME;
try {
	process.env.HOME = root;
	mkdirSync(join(root, ".pi"), { recursive: true });
	const { default: claudify } = await import("../extensions/index.ts");
	const tools = new Map<string, any>();
	const events = new Map<string, Function[]>();
	const pi = {
		registerTool(definition: any) { tools.set(definition.name, definition); },
		registerCommand() {},
		on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); },
		getAllTools() { return [...tools.values()]; },
		getThinkingLevel() { return "off"; },
		sendUserMessage() {},
	};
	claudify(pi as any);
	for (const handler of events.get("session_start") ?? []) {
		await handler({}, { mode: "tui", hasUI: true, ui: { theme: {}, requestRender() {}, custom() {}, input() {} }, isProjectTrusted: () => false });
	}
	for (const name of ["CronCreate", "CronList", "CronDelete", "AskUserQuestion"]) {
		assert.ok(tools.has(name), `${name} is registered with zero configuration in interactive TUI mode`);
	}
	assert.ok(events.has("agent_settled"), "the default scheduler installs its idle-dispatch lifecycle");

	const printTools = new Map<string, any>();
	const printEvents = new Map<string, Function[]>();
	const printPi = {
		registerTool(definition: any) { printTools.set(definition.name, definition); }, registerCommand() {},
		on(name: string, handler: Function) { printEvents.set(name, [...(printEvents.get(name) ?? []), handler]); },
		getAllTools() { return [...printTools.values()]; }, getThinkingLevel() { return "off"; }, sendUserMessage() {},
	};
	claudify(printPi as any);
	for (const handler of printEvents.get("session_start") ?? []) await handler({}, { mode: "print", hasUI: false, ui: {}, isProjectTrusted: () => false });
	assert.equal(printTools.has("AskUserQuestion"), false, "AskUserQuestion is not model-visible outside interactive TUI mode");
	for (const name of ["CronCreate", "CronList", "CronDelete"]) assert.ok(printTools.has(name), `${name} remains available outside TUI mode`);

	const limitedTools = new Map<string, any>();
	const limitedEvents = new Map<string, Function[]>();
	claudify({
		registerTool(definition: any) { limitedTools.set(definition.name, definition); }, registerCommand() {},
		on(name: string, handler: Function) { limitedEvents.set(name, [...(limitedEvents.get(name) ?? []), handler]); },
		getAllTools() { return [...limitedTools.values()]; }, getThinkingLevel() { return "off"; },
	} as any);
	for (const handler of limitedEvents.get("session_start") ?? []) await handler({}, { mode: "tui", hasUI: true, ui: {}, isProjectTrusted: () => false });
	assert.equal(limitedTools.has("AskUserQuestion"), false, "Ask stays hidden when custom/input TUI capabilities are absent");
	for (const name of ["CronCreate", "CronList", "CronDelete"]) assert.equal(limitedTools.has(name), false, `${name} stays hidden without sendUserMessage`);
} finally {
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	rmSync(root, { recursive: true, force: true });
}

console.log("zero-config tool registration tests passed");
