import { trackedTempDir } from "./sandbox-home.ts";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { Container, Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { effectiveAgentDir, hostToolSettings } from "../extensions/builtin-contracts.ts";

initTheme("dark");

const root = trackedTempDir("cc-contracts");
const home = join(root, "home");
const fallbackAgentDir = join(home, ".pi", "agent");
const customAgentDir = join(root, "custom-agent");
const capabilityAgentDir = join(root, "capability-agent");
const startupCwd = join(root, "startup");
const runtimeCwd = join(root, "runtime");
const imageOverrideCwd = join(root, "image-override");
for (const path of [fallbackAgentDir, customAgentDir, capabilityAgentDir, startupCwd, runtimeCwd, imageOverrideCwd]) {
	mkdirSync(path, { recursive: true });
}
mkdirSync(join(runtimeCwd, ".pi"), { recursive: true });
mkdirSync(join(imageOverrideCwd, ".pi"), { recursive: true });

const shellWrapper = join(home, "contract-shell");
writeFileSync(shellWrapper, "#!/bin/sh\nexport CLFY_SHELL=custom\nexec /bin/sh \"$@\"\n");
chmodSync(shellWrapper, 0o755);
writeFileSync(join(fallbackAgentDir, "settings.json"), JSON.stringify({ shellCommandPrefix: "export CLFY_PREFIX=home" }));
writeFileSync(join(customAgentDir, "settings.json"), JSON.stringify({
	shellPath: "~/contract-shell",
	shellCommandPrefix: "export CLFY_PREFIX=global",
	images: { autoResize: false },
}));
writeFileSync(join(capabilityAgentDir, "settings.json"), JSON.stringify({ shellCommandPrefix: "export CLFY_PREFIX=capability" }));
writeFileSync(join(runtimeCwd, ".pi", "settings.json"), JSON.stringify({ shellCommandPrefix: "export CLFY_PREFIX=project" }));
writeFileSync(join(imageOverrideCwd, ".pi", "settings.json"), JSON.stringify({ images: { autoResize: true } }));
writeFileSync(join(runtimeCwd, "runtime.txt"), "runtime cwd\n");

process.env.HOME = home;
process.env.PI_CLAUDIFY_NATIVE_EXECUTION = "0";
process.env.PI_CODING_AGENT_DIR = customAgentDir;
assert.equal(effectiveAgentDir(() => capabilityAgentDir), capabilityAgentDir, "getAgentDir capability takes precedence");
assert.equal(effectiveAgentDir(), customAgentDir, "PI_CODING_AGENT_DIR is the compatibility fallback");
assert.equal(effectiveAgentDir(() => { throw new Error("unavailable"); }), customAgentDir, "a failing capability falls back to PI_CODING_AGENT_DIR");
delete process.env.PI_CODING_AGENT_DIR;
assert.equal(effectiveAgentDir(), fallbackAgentDir, "default agent dir is ~/.pi/agent");
process.env.PI_CODING_AGENT_DIR = customAgentDir;

const absentTrust = hostToolSettings(runtimeCwd, { agentDir: customAgentDir });
assert.equal(absentTrust.commandPrefix, "export CLFY_PREFIX=global", "absent trust capability ignores project settings");
assert.equal(absentTrust.shellPath, shellWrapper, "global shellPath expands from Pi's effective agent dir settings");
assert.equal(absentTrust.autoResizeImages, false, "global image autoResize is preserved");
assert.deepEqual(
	hostToolSettings(runtimeCwd, { agentDir: customAgentDir, projectTrusted: false }),
	absentTrust,
	"denied trust ignores project settings",
);
const trusted = hostToolSettings(runtimeCwd, { agentDir: customAgentDir, projectTrusted: true });
assert.equal(trusted.commandPrefix, "export CLFY_PREFIX=project", "trusted project settings override global values");
assert.equal(trusted.shellPath, shellWrapper, "trusted partial project settings preserve the global shellPath");
assert.equal(trusted.autoResizeImages, false, "trusted partial project settings preserve global image settings");
assert.equal(
	hostToolSettings(imageOverrideCwd, { agentDir: customAgentDir, projectTrusted: true }).autoResizeImages,
	true,
	"trusted project image autoResize overrides the global value",
);
assert.equal(
	hostToolSettings(imageOverrideCwd, { agentDir: customAgentDir }).autoResizeImages,
	false,
	"untrusted project image autoResize is ignored",
);
assert.equal(
	hostToolSettings(runtimeCwd, { agentDir: capabilityAgentDir }).commandPrefix,
	"export CLFY_PREFIX=capability",
	"global settings are read from the supplied effective agent dir",
);

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

const nativeDefinitions = new Map<string, any>([
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

const runtimeContext = (trust?: boolean) => ({
	cwd: runtimeCwd,
	model: undefined,
	thinkingLevel: "off",
	sessionManager: { getSessionId: () => "contract-test", getSessionFile: () => undefined },
	...(trust === undefined ? {} : { isProjectTrusted: () => trust }),
});
const runtimeCtx = runtimeContext();
const readResult = await pi.tools.get("read").execute("runtime-read", { path: "runtime.txt" }, undefined, undefined, runtimeCtx);
assert.match(readResult.content[0]?.text ?? "", /runtime cwd/, "read executes relative to ctx.cwd, not extension startup cwd");

await pi.tools.get("write").execute("runtime-write", { path: "written.txt", content: "written here\n" }, undefined, undefined, runtimeCtx);
assert.equal(readFileSync(join(runtimeCwd, "written.txt"), "utf8"), "written here\n", "write executes relative to ctx.cwd");

const runBash = async (label: string, ctx: ReturnType<typeof runtimeContext>) => {
	const result = await pi.tools.get("bash").execute(
		label,
		{ command: 'printf "%s:%s:%s" "$CLFY_SHELL" "$CLFY_PREFIX" "$PWD"' },
		undefined,
		undefined,
		ctx,
	);
	return result.content[0]?.text ?? "";
};
if (process.platform !== "win32") {
	const absentTrustText = await runBash("runtime-bash-absent-trust", runtimeContext());
	assert.match(absentTrustText, /^custom:global:.*\/runtime$/, `bash forwards global shellPath/commandPrefix without trust capability; got ${JSON.stringify(absentTrustText)}`);
	const deniedText = await runBash("runtime-bash-denied", runtimeContext(false));
	assert.match(deniedText, /^custom:global:.*\/runtime$/, `bash ignores project settings when trust is denied; got ${JSON.stringify(deniedText)}`);
	const trustedResult = await pi.tools.get("bash").execute(
		"runtime-bash-trusted",
		{ command: 'printf "%s:%s:%s" "$CLFY_SHELL" "$CLFY_PREFIX" "$PWD"' },
		undefined,
		undefined,
		runtimeContext(true),
	);
	const trustedText = trustedResult.content[0]?.text ?? "";
	assert.match(trustedText, /^custom:project:.*\/runtime$/, `bash uses project settings when trusted; got ${JSON.stringify(trustedText)}`);
	assert.equal(trustedResult.details?._claudifyPrefixApplied, true, "result records prefix presence without persisting its raw value");
	assert.doesNotMatch(JSON.stringify(trustedResult.details), /export CLFY_PREFIX=project/, "raw configured prefix is not added to persisted details");
	const expandedBash = new ToolExecutionComponent(
		"bash",
		"prefix-audit",
		{ command: "printf ok" },
		{ showImages: false },
		pi.tools.get("bash"),
		{ requestRender() {}, previousLines: [] } as any,
		runtimeCwd,
	);
	expandedBash.markExecutionStarted();
	expandedBash.setArgsComplete();
	expandedBash.updateResult(trustedResult as any, false);
	expandedBash.setExpanded(true);
	assert.match(expandedBash.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, ""), /Configured shell prefix applied/, "expanded audit discloses effective prefix presence");
}

const ownerPi = new FakePi();
const externalExecute = async () => ({ content: [{ type: "text", text: "remote.ts:7:needle" }], details: {} });
const externallyOwnedGrep = {
	name: "grep",
	description: "Remote policy-owned grep",
	parameters: {},
	execute: externalExecute,
	renderCall: () => new Text("REMOTE_NATIVE_CALL", 0, 0),
	renderResult: () => new Text("REMOTE_NATIVE_RESULT", 0, 0),
	sourceInfo: { path: "/third-party/remote-search.ts", source: "extension:remote-search" },
};
const externalEditExecute = async () => ({ content: [{ type: "text", text: "updated" }], details: {} });
const externallyOwnedEdit = {
	name: "edit",
	description: "Remote policy-owned edit",
	parameters: {},
	execute: externalEditExecute,
	renderCall: () => new Text("REMOTE_EDIT_NATIVE_CALL", 0, 0),
	renderResult: () => new Text("REMOTE_EDIT_NATIVE_RESULT", 0, 0),
	sourceInfo: { path: "/third-party/remote-edit.ts", source: "extension:remote-edit" },
};
ownerPi.tools.set("grep", externallyOwnedGrep);
ownerPi.tools.set("edit", externallyOwnedEdit);
extension(ownerPi as any);
assert.equal(ownerPi.tools.get("grep"), externallyOwnedGrep, "an already extension-owned tool is not replaced through deferred registration");
assert.equal(ownerPi.tools.get("grep").execute, externalExecute, "presentation adaptation never wraps external execution");
assert.equal(ownerPi.tools.get("edit"), externallyOwnedEdit, "an externally-owned mutation tool is not replaced");
assert.equal(ownerPi.tools.get("edit").execute, externalEditExecute, "edit presentation never wraps external execution");
const externalEditRow = new ToolExecutionComponent(
	"edit",
	"external-compatible-edit",
	{ path: "remote.ts", edits: [{ oldText: "const value = 1;", newText: "const value = 2;" }] },
	{ showImages: false },
	externallyOwnedEdit as any,
	{ requestRender() {}, previousLines: [] } as any,
	runtimeCwd,
);
externalEditRow.markExecutionStarted();
externalEditRow.setArgsComplete();
externalEditRow.updateResult({
	content: [{ type: "text", text: "updated" }],
	details: { patch: "@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;\n" },
	isError: false,
} as any, false);
const externalEditRaw = externalEditRow.render(100);
const externalEditText = externalEditRaw.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const externalEditHeader = externalEditRaw.find((line) => line.includes("Update")) ?? "";
const externalEditResultRow = externalEditRaw.find((line) => line.includes("rendering diff")) ?? "";
assert.match(externalEditHeader, /^\x1b\[49m/, "adapted edit header resets the host background before its glyph gutter");
assert.match(externalEditResultRow, /^\x1b\[49m/, "adapted edit result resets the host background before its branch gutter");
assert.doesNotMatch(externalEditHeader, /\x1b\[48;/, "adapted edit header neutralizes Pi's success background");
assert.match(externalEditText, /Update\(/, "compatible external edit keeps Claudify call presentation after registry rebuilds");
assert.doesNotMatch(externalEditText, /REMOTE_EDIT_NATIVE_/, "compatible external edit uses presentation-only adaptation");
const externalGrepRow = new ToolExecutionComponent(
	"grep",
	"external-compatible-grep",
	{ pattern: "^needle", path: "." },
	{ showImages: false },
	externallyOwnedGrep as any,
	{ requestRender() {}, previousLines: [] } as any,
	runtimeCwd,
);
externalGrepRow.markExecutionStarted();
externalGrepRow.setArgsComplete();
externalGrepRow.updateResult({ content: [{ type: "text", text: "remote.ts:7:needle" }], details: {}, isError: false } as any, false);
externalGrepRow.setExpanded(true);
const externalGrepLines = externalGrepRow.render(100);
const externalGrepText = externalGrepLines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
assert.match(externalGrepText, /Grep\(/, "contract-compatible external grep receives Claudify presentation without source-specific logic");
assert.match(externalGrepText, /1 matches/, "compatible external result receives the Claude-style summary");
assert.doesNotMatch(externalGrepText, /REMOTE_NATIVE_/, "compatible presentation replaces only the external renderer");
const externalHeaderRow = externalGrepLines.findIndex((line) => line.replace(/\x1b\[[0-9;]*m/g, "").includes("Grep("));
assert.ok(externalHeaderRow >= 0, "expanded external grep has a visible call header");
const externalMouseHandler = (externalGrepRow as any).handleMouse;
if (typeof externalMouseHandler === "function") {
	externalMouseHandler.call(externalGrepRow, { type: "click", button: "left", x: 2, y: externalHeaderRow, width: 100, height: externalGrepLines.length });
	assert.equal((externalGrepRow as any).expanded, false, "clicking the first visible call row collapses the adapted tool");
} else {
	assert.equal((externalGrepRow as any).expanded, true, "Pi 0.74/0.80 without mouse dispatch preserve keyboard expansion state");
}
const incompatibleGrepRow = new ToolExecutionComponent(
	"grep",
	"external-incompatible-grep",
	{ pattern: "^needle", path: "." },
	{ showImages: false },
	externallyOwnedGrep as any,
	{ requestRender() {}, previousLines: [] } as any,
	runtimeCwd,
);
incompatibleGrepRow.markExecutionStarted();
incompatibleGrepRow.setArgsComplete();
incompatibleGrepRow.updateResult({ content: [{ type: "remote-record", matches: [] }], details: {}, isError: false } as any, false);
const incompatibleText = incompatibleGrepRow.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
assert.match(incompatibleText, /Grep\(/, "call and result compatibility are selected independently");
assert.match(incompatibleText, /REMOTE_NATIVE_RESULT/, "an unfamiliar external result contract falls back to its native renderer");
const externalGroup = new Container();
for (let index = 0; index < 2; index++) {
	const row = new ToolExecutionComponent(
		"grep",
		`external-group-${index}`,
		{ pattern: `needle-${index}`, path: "." },
		{ showImages: false },
		externallyOwnedGrep as any,
		{ requestRender() {}, previousLines: [] } as any,
		runtimeCwd,
	);
	row.markExecutionStarted();
	row.setArgsComplete();
	row.updateResult({ content: [{ type: "text", text: `remote.ts:${index + 1}:needle` }], details: {}, isError: false } as any, false);
	externalGroup.addChild(row);
}
externalGroup.render(100);
assert.equal((externalGroup as any).children[0]?.constructor?.name, "InspectionGroupComponent", "compatible external inspection tools participate in Claudify grouping");

console.log("builtin contract forwarding tests passed");
