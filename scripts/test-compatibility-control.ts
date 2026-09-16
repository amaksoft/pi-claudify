import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pi-claudify-compat-control-"));
const previousHome = process.env.HOME;
try {
	process.env.HOME = root;
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ compatibility: { enabled: false } }));

	const { default: claudify } = await import("../extensions/index.ts");
	const registrations = { tools: [] as string[], commands: [] as string[], events: [] as string[] };
	const pi = {
		registerTool(definition: any) { registrations.tools.push(String(definition?.name)); },
		registerCommand(name: string) { registrations.commands.push(name); },
		on(name: string) { registrations.events.push(name); },
		getAllTools() { return []; },
		getThinkingLevel() { return "off"; },
	};
	claudify(pi as any);
	assert.deepEqual(registrations.tools, [], "global compatibility off registers no tool definitions");
	assert.deepEqual(registrations.commands, [], "global compatibility off registers no commands");
	assert.deepEqual(registrations.events, [], "global compatibility off registers no event handlers");
} finally {
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	rmSync(root, { recursive: true, force: true });
}

console.log("compatibility integration control tests passed");
