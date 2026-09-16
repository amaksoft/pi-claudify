import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

const root = mkdtempSync(join(tmpdir(), "cc-contracts-"));
const home = join(root, "home");
const startupCwd = join(root, "startup");
const runtimeCwd = join(root, "runtime");
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
mkdirSync(startupCwd, { recursive: true });
mkdirSync(runtimeCwd, { recursive: true });
writeFileSync(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ shellCommandPrefix: "export CLFY_PREFIX=forwarded" }));
writeFileSync(join(runtimeCwd, "runtime.txt"), "runtime cwd\n");
process.env.HOME = home;
process.chdir(startupCwd);

const { default: extension } = await import("../extensions/index.ts");

class FakePi {
	tools = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void { this.tools.set(definition.name, definition); }
	registerCommand(): void {}
	on(name: string, handler: (...args: any[]) => any): void { this.events.set(name, [...(this.events.get(name) ?? []), handler]); }
	getThinkingLevel(): string { return "off"; }
	getAllTools(): any[] { return [...this.tools.values()]; }
}

const pi = new FakePi();
extension(pi as any);

const nativeDefinitions = new Map([
	["read", createReadToolDefinition(startupCwd)],
	["bash", createBashToolDefinition(startupCwd)],
	["grep", createGrepToolDefinition(startupCwd)],
	["find", createFindToolDefinition(startupCwd)],
	["ls", createLsToolDefinition(startupCwd)],
	["write", createWriteToolDefinition(startupCwd)],
	["edit", createEditToolDefinition(startupCwd)],
]);
for (const [name, native] of nativeDefinitions) {
	const overridden = pi.tools.get(name);
	assert.ok(overridden, `${name} override registered`);
	assert.deepEqual(overridden.promptSnippet, native.promptSnippet, `${name} forwards promptSnippet`);
	assert.deepEqual(overridden.promptGuidelines, native.promptGuidelines, `${name} forwards promptGuidelines`);
}

const edit = pi.tools.get("edit");
assert.equal(typeof edit.prepareArguments, "function", "edit forwards Pi's argument normalizer");
assert.deepEqual(
	edit.prepareArguments({ path: "a.ts", edits: '[{"oldText":"a","newText":"b"}]' }),
	{ path: "a.ts", edits: [{ oldText: "a", newText: "b" }] },
	"JSON-string edits are normalized before schema validation",
);
assert.deepEqual(
	edit.prepareArguments({ path: "a.ts", oldText: "a", newText: "b" }),
	{ path: "a.ts", edits: [{ oldText: "a", newText: "b" }] },
	"legacy top-level edit arguments are normalized",
);

const runtimeCtx = {
	cwd: runtimeCwd,
	model: undefined,
	thinkingLevel: "off",
	sessionManager: { getSessionId: () => "contract-test", getSessionFile: () => undefined },
};
const readResult = await pi.tools.get("read").execute("runtime-read", { path: "runtime.txt" }, undefined, undefined, runtimeCtx);
assert.match(readResult.content[0]?.text ?? "", /runtime cwd/, "read executes relative to ctx.cwd, not extension startup cwd");

await pi.tools.get("write").execute("runtime-write", { path: "written.txt", content: "written here\n" }, undefined, undefined, runtimeCtx);
assert.equal(readFileSync(join(runtimeCwd, "written.txt"), "utf8"), "written here\n", "write executes relative to ctx.cwd");

const bashResult = await pi.tools.get("bash").execute("runtime-bash", { command: 'printf "%s:%s" "$CLFY_PREFIX" "$PWD"' }, undefined, undefined, runtimeCtx);
const bashText = bashResult.content[0]?.text ?? "";
assert.match(bashText, /^forwarded:.*\/runtime$/, `bash forwards shellCommandPrefix and runtime cwd; got ${JSON.stringify(bashText)}`);

console.log("builtin contract forwarding tests passed");
