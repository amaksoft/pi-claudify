import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COMPATIBILITY_FEATURE_IDS } from "../extensions/domain/compatibility.ts";
import { trackedTempDir } from "./sandbox-home.ts";

const root = trackedTempDir("claudify-feature-kill-switches");
const oldHome = process.env.HOME;
try {
	process.env.HOME = root;
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({
		compatibility: {
			enabled: true,
			features: Object.fromEntries(COMPATIBILITY_FEATURE_IDS.map((id) => [id, false])),
			tools: { default: false },
		},
	}));
	const { default: claudify } = await import(`../extensions/index.ts?kill-switch-test=${Date.now()}`);
	const { testedPiPatchBroker } = await import("../extensions/adapters/tested-pi/patch-broker.ts");
	const { installMouseLayout } = await import("../extensions/mouse-layout.ts");
	const tools: string[] = [];
	const commands: string[] = [];
	const events = new Map<string, Function[]>();
	claudify({
		registerTool(definition: any) { tools.push(String(definition?.name)); },
		registerCommand(name: string) { commands.push(name); },
		on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); },
		getAllTools() { return []; },
		getThinkingLevel() { return "off"; },
		sendUserMessage() {},
	} as any);
	assert.deepEqual(tools, [], "all tool switches suppress every Claudify registration");
	assert.deepEqual(commands, [], "settings command switch suppresses its registration");
	assert.deepEqual(testedPiPatchBroker.inspect(), { owners: 0, retiring: 0, surfaces: 0 }, "fresh disabled features install no private host binding");
	assert.equal(events.has("tool_call") || events.has("tool_result") || events.has("tool_execution_end"), false, "disabled mutation presentation installs no provenance observers");
	const foreignLayout = { width: 7, children: [] };
	const foreignComponent: any = { mouseLayout: foreignLayout };
	installMouseLayout(foreignComponent, { width: 9, children: [] });
	assert.equal(foreignComponent.mouseLayout, foreignLayout, "disabled mouse integration preserves another owner's hit map");
	const foreignTheme = { bgColors: { userMessageBg: "FOREIGN_USER", toolPendingBg: "FOREIGN_PENDING", toolSuccessBg: "FOREIGN_SUCCESS", toolErrorBg: "FOREIGN_ERROR" } };
	const footerCalls: unknown[] = [];
	const hiddenLabels: unknown[] = [];
	const ctx = {
		mode: "tui", hasUI: true, sessionManager: { getSessionId: () => "kill-switch-session" },
		ui: { theme: foreignTheme, setFooter: (value: unknown) => footerCalls.push(value), setHiddenThinkingLabel: (value: unknown) => hiddenLabels.push(value) },
	};
	for (const handler of events.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
	for (const handler of events.get("turn_start") ?? []) await handler({}, ctx);
	assert.deepEqual(foreignTheme.bgColors, { userMessageBg: "FOREIGN_USER", toolPendingBg: "FOREIGN_PENDING", toolSuccessBg: "FOREIGN_SUCCESS", toolErrorBg: "FOREIGN_ERROR" }, "disabled background features preserve another extension's theme state");
	assert.deepEqual(footerCalls, [], "disabled footer never clears another extension's footer");
	assert.deepEqual(hiddenLabels, [], "disabled assistant messages never overwrite the hidden-thinking label");
} finally {
	if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
	rmSync(root, { recursive: true, force: true });
}

console.log("feature kill-switch side-effect tests passed");
