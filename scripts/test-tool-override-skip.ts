import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ToolExecutionComponent, createGrepToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

initTheme("dark");

const root = mkdtempSync(join(tmpdir(), "cc-skip-tools-"));
const home = join(root, "home");
mkdirSync(join(home, ".pi"), { recursive: true });
writeFileSync(join(home, ".pi", "settings.json"), JSON.stringify({ ccSkipToolOverrides: ["grep", "find", "unknown"] }));
process.env.HOME = home;
process.env.PI_CLAUDIFY_SKIP_TOOL_OVERRIDES = "bash";

const { default: extension } = await import("../extensions/index.ts");
const { readSettings } = await import("../extensions/settings.ts");
const { skippedToolOverrides } = await import("../extensions/builtin-contracts.ts");

class FakePi {
	tools = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void { this.tools.set(definition.name, definition); }
	registerCommand(): void {}
	on(name: string, handler: (...args: any[]) => any): void { this.events.set(name, [...(this.events.get(name) ?? []), handler]); }
	getThinkingLevel(): string { return "off"; }
	getAllTools(): any[] { return [...this.tools.values()]; }
}

const values = readSettings().values;
assert.deepEqual(values.skipToolOverrides, ["grep", "find", "unknown"], "legacy fork key normalizes into claudify's setting");
assert.equal(Object.hasOwn(values, "ccSkipToolOverrides"), false, "legacy key does not leak past normalization");
assert.deepEqual([...skippedToolOverrides(values)].sort(), ["bash", "find", "grep"], "config and env merge; unknown tools are ignored");

const pi = new FakePi();
const externalGrep = {
	...createGrepToolDefinition(root),
	renderCall: () => new Text("EXTERNAL_GREP", 0, 0),
};
pi.registerTool(externalGrep);
extension(pi as any);
for (const name of ["bash", "find"]) assert.equal(pi.tools.has(name), false, `${name} override is skipped`);
assert.equal(pi.tools.get("grep"), externalGrep, "skipped grep keeps the pre-existing external definition");
for (const name of ["read", "ls", "write", "edit"]) assert.equal(pi.tools.has(name), true, `${name} override remains registered`);
const externalRow = new ToolExecutionComponent(
	"grep",
	"external-grep",
	{ pattern: "needle", path: "." },
	{ showImages: false },
	externalGrep,
	{ requestRender() {}, previousLines: [] } as any,
	root,
);
externalRow.markExecutionStarted();
externalRow.setArgsComplete();
externalRow.updateResult({ content: [{ type: "text", text: "match" }], details: {}, isError: false } as any, false);
const externalBox = new Container();
externalBox.addChild(externalRow);
assert.match(externalBox.render(100).join("\n"), /EXTERNAL_GREP/, "skipped tool keeps its external renderer");
assert.equal((externalBox as any).children[0], externalRow, "skipped tool is not wrapped into an inspection group");

delete process.env.PI_CLAUDIFY_SKIP_TOOL_OVERRIDES;
console.log("tool override opt-out tests passed");
