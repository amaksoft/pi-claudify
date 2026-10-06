import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import {
	createToolRendererResolver,
	supportsToolRendererResolver,
	type ToolRendererResolverHooks,
} from "../extensions/host/tool-renderer-resolver.ts";
import { trackedTempDir } from "./sandbox-home.ts";

const root = trackedTempDir("claudify-tool-renderer-resolver");
const oldHome = process.env.HOME;
process.env.HOME = root;
mkdirSync(join(root, ".pi"), { recursive: true });
initTheme("dark", false);

const PATCH_FLAG = Symbol.for("pi-claudify:patched-tool-execution");

// --- probe -----------------------------------------------------------------

assert.equal(supportsToolRendererResolver({ registerToolRenderer() {} }), true);
assert.equal(supportsToolRendererResolver({}), false);
assert.equal(supportsToolRendererResolver(undefined), false);
assert.equal(supportsToolRendererResolver(null), false);

// --- pure resolver behavior --------------------------------------------------

function testHooks(overrides: Partial<ToolRendererResolverHooks> = {}): ToolRendererResolverHooks {
	return {
		isCurrent: () => true,
		presentationSkipped: () => false,
		shouldUseGeneric: () => false,
		canOverrideSelfShell: () => true,
		diagnostic: () => {},
		presentations: () => [],
		...overrides,
	};
}

const readAdapter: any = {
	name: "read",
	renderCall: (args: any) => ({ kind: "claudify-read", path: args?.path }),
	renderResult: (result: any) => ({ kind: "claudify-read-result" }),
};
const fallback = {
	renderCall: (...args: any[]) => ({ kind: "native-call" }),
	renderResult: (...args: any[]) => ({ kind: "native-result" }),
};
const next = () => fallback;

{
	const resolve = createToolRendererResolver(testHooks({ presentations: () => [readAdapter] }));
	const resolved: any = resolve("read", next);
	assert.notEqual(resolved, fallback, "known tool gets a wrapped renderer object");
	assert.equal(resolved.renderCall({ path: "a.ts" }, theme, {}).kind, "claudify-read");
	assert.equal(resolved.renderCall({}, theme, {}).kind, "native-call", "shape mismatch falls back to native");
	assert.equal(resolve("frobnicate", next), fallback, "unknown tool falls through by identity");
}

{
	const resolve = createToolRendererResolver(testHooks({ presentations: () => [readAdapter], isCurrent: () => false }));
	assert.equal(resolve("read", next), fallback, "stale generation serves native renderers");
}

{
	const resolve = createToolRendererResolver(testHooks({ presentations: () => [readAdapter], presentationSkipped: () => true }));
	assert.equal(resolve("read", next), fallback, "disabled tool serves native renderers");
}

{
	let diagnosed: string[] = [];
	const exploding = { name: "read", renderCall: () => { throw new Error("boom"); } };
	const resolve = createToolRendererResolver(testHooks({
		presentations: () => [exploding],
		diagnostic: (key) => { diagnosed.push(key); },
	}));
	const resolved: any = resolve("read", next);
	assert.equal(resolved.renderCall({ path: "a.ts" }, theme, {}).kind, "native-call", "adapter exceptions fall back to native");
	assert.deepEqual(diagnosed, ["presentation-call:read"]);
}

{
	const selfShellBase = { renderShell: "self", renderCall: (...args: any[]) => ({ kind: "native-self" }) };
	const resolve = createToolRendererResolver(testHooks({ presentations: () => [{ name: "read" }] }));
	assert.equal(resolve("read", () => selfShellBase), selfShellBase, "self-shell base is preserved without an override grant");
}

{
	const resolve = createToolRendererResolver(testHooks({}));
	const resolved: any = resolve("apply_patch", next);
	assert.equal(typeof resolved.renderCall, "function", "apply_patch keeps a dedicated renderer");
}

{
	const seen: string[] = [];
	const resolve = createToolRendererResolver(testHooks({ shouldUseGeneric: (name) => { seen.push(String(name)); return true; } }));
	const resolved: any = resolve("mcp__docs_search", next);
	assert.equal(typeof resolved.renderCall, "function", "generic tools keep dedicated renderers");
	assert.deepEqual(seen, ["mcp__docs_search"]);
}

// --- composition-root wiring ---------------------------------------------------

const resolvers: Array<(toolName: string, next: () => any) => any> = [];
class FakePi {
	tools = new Map<string, any>();
	events = new Map<string, Function[]>();
	registerTool(definition: any): void { this.tools.set(String(definition.name).toLowerCase(), definition); }
	registerToolRenderer(resolver: any): void { resolvers.push(resolver); }
	registerCommand() {}
	on(name: string, handler: Function): void { this.events.set(name, [...(this.events.get(name) ?? []), handler]); }
	getAllTools(): any[] { return []; }
	getThinkingLevel(): string { return "off"; }
	sendUserMessage() {}
}

const { default: claudify } = await import(`../extensions/index.ts?tool-renderer-resolver-test=${Date.now()}`);
claudify(new FakePi() as any);
assert.equal(resolvers.length, 1, "1.0.1 hosts get exactly one resolver registration");
assert.equal(
	(ToolExecutionComponent.prototype as any)[PATCH_FLAG],
	undefined,
	"resolver path installs no legacy prototype patch",
);
const wired: any = resolvers[0]("read", next);
assert.equal(typeof wired?.renderCall, "function", "wired resolver serves the read presentation");
const wiredGeneric: any = resolvers[0]("definitely-not-a-tool", next);
assert.equal(typeof wiredGeneric?.renderCall, "function", "wired resolver serves generic presentation for unknown tools, mirroring the legacy patch");
assert.notEqual(wiredGeneric, next(), "generic branch returns dedicated renderers, not the raw fallback");

process.env.HOME = oldHome as string;
console.log("tool renderer resolver tests passed");
