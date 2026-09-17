import assert from "node:assert/strict";

import {
	ToolExecutionComponent,
	createBashToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension from "../extensions/index.ts";

import { useSandboxHome } from "./sandbox-home.ts";

// Assert default rendering, not the settings of whoever runs the suite.
useSandboxHome("cc-readonly");

// Claude Code aggregates read-only tools at ANY count: a single read renders as
// `⏺ Reading 1 file…` and collapses to `Read 1 file` — never `⏺ Read(path)`.
// Captured side by side against pi: docs/plans/2026-07-14-tool-row-conformance-audit.md

class FakePi {
	tools = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void {
		this.tools.set(definition.name, definition);
	}
	registerCommand(): void {}
	on(name: string, handler: (...args: any[]) => any): void {
		const handlers = this.events.get(name) ?? [];
		handlers.push(handler);
		this.events.set(name, handlers);
	}
	getThinkingLevel(): string {
		return "off";
	}
	getAllTools(): any[] {
		return [...this.tools.values()];
	}
}

interface ToolOptions {
	settled?: boolean;
	isError?: boolean;
	expanded?: boolean;
	details?: unknown;
}

function tool(pi: FakePi, name: string, id: string, args: any, text: string, options: ToolOptions = {}): ToolExecutionComponent {
	const definition = pi.tools.get(name);
	assert.ok(definition, `${name} tool registered`);
	const component = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		definition,
		{ requestRender() {}, previousLines: [] } as any,
		process.cwd(),
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	if (options.expanded) (component as any).expanded = true;
	if (options.settled !== false) {
		component.updateResult(
			{ content: [{ type: "text", text }], details: options.details ?? {}, isError: !!options.isError } as any,
			false,
		);
	}
	return component;
}

function render(children: ToolExecutionComponent[], width = 120): string {
	const box = new Container();
	for (const child of children) box.addChild(child);
	return box
		.render(width)
		.map((line) =>
			line
				.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
				.replace(/\x1b\[[0-9;]*m/g, "")
				.replace(/\s+$/, ""),
		)
		.join("\n");
}

initTheme("dark", false);
const pi = new FakePi();
for (const definition of [
	createReadToolDefinition(process.cwd()), createBashToolDefinition(process.cwd()), createGrepToolDefinition(process.cwd()),
	createFindToolDefinition(process.cwd()), createLsToolDefinition(process.cwd()), createWriteToolDefinition(process.cwd()),
]) pi.tools.set(definition.name, { ...definition, sourceInfo: { source: "builtin", path: `<builtin:${definition.name}>` } });
extension(pi as any);

// --- A single read-only tool aggregates and collapses. ------------------------

const oneRead = render([tool(pi, "read", "r1", { path: "src/alpha.ts" }, "a\nb\nc\nd")]);
assert.match(oneRead, /^ {2}Read 1 file$/m);
assert.doesNotMatch(oneRead, /⏺ Read\(/);
assert.doesNotMatch(oneRead, /lines loaded/);

const oneBash = render([tool(pi, "bash", "b1", { command: "echo hello" }, "hello")]);
assert.match(oneBash, /^ {2}Ran 1 shell command$/m);
assert.doesNotMatch(oneBash, /⏺ Bash\(/);

const oneGrep = render([tool(pi, "grep", "g1", { pattern: "needle", path: "src" }, "src/alpha.ts:1: needle")]);
assert.match(oneGrep, /^ {2}Searched for 1 pattern$/m);
assert.doesNotMatch(oneGrep, /⏺ Grep\(/);

const oneLs = render([tool(pi, "ls", "l1", { path: "src" }, "alpha.ts\nbeta.ts")]);
assert.match(oneLs, /^ {2}Listed 1 directory$/m);
assert.doesNotMatch(oneLs, /⏺ List\(/);

// Claude Code folds Glob into grep's clause rather than giving it one of its own.
const oneGlob = render([tool(pi, "find", "f1", { pattern: "src/*.ts" }, "src/alpha.ts\nsrc/beta.ts")]);
assert.match(oneGlob, /^ {2}Searched for 1 pattern$/m);
assert.doesNotMatch(oneGlob, /Found 1 file|Finding/);

// A grep and a glob in the same turn count as two patterns, not one of each.
const grepAndGlob = render([
	tool(pi, "grep", "g3", { pattern: "needle", path: "src" }, "src/alpha.ts:1: needle"),
	tool(pi, "find", "f2", { pattern: "src/*.ts" }, "src/alpha.ts"),
]);
assert.match(grepAndGlob, /^ {2}Searched for 2 patterns$/m);

// --- In flight: the gerund header, and the ⎿ target rows. ---------------------

const inFlight = render([
	tool(pi, "read", "r2", { path: "src/alpha.ts" }, "", { settled: false }),
	tool(pi, "grep", "g2", { pattern: "needle", path: "src" }, "", { settled: false }),
	tool(pi, "bash", "b2", { command: "echo hi" }, "", { settled: false }),
]);
assert.match(inFlight, /^⏺ Searching for 1 pattern, reading 1 file, running 1 shell command…$/m);
assert.match(inFlight, /^ {2}⎿ {2}src\/alpha\.ts$/m);
// Claude Code shows the bare quoted pattern — never the search path.
assert.match(inFlight, /^ {2}⎿ {2}"needle"$/m);
assert.doesNotMatch(inFlight, /"needle" in src/);
assert.match(inFlight, /^ {2}⎿ {2}\$ echo hi$/m);

// --- Mutating tools keep their own persistent row. ----------------------------

const mutating = render([
	tool(pi, "read", "r3", { path: "src/alpha.ts" }, "a"),
	tool(pi, "write", "w1", { path: "src/new.ts", content: "x\n" }, "ok", {
		details: { _type: "new", lines: 1, filePath: "src/new.ts" },
	}),
]);
assert.match(mutating, /^ {2}Read 1 file$/m);
assert.match(mutating, /^⏺ Write\(src\/new\.ts\)/m);

// --- ctrl+o is the escape hatch: an expanded tool leaves the group and shows
// --- its full row, the way Claude Code's collapsed line expands on click.

const expanded = render([tool(pi, "read", "r4", { path: "src/alpha.ts" }, "alpha\nbeta", { expanded: true })]);
assert.match(expanded, /⏺ Read\(src\/alpha\.ts\)/);
assert.doesNotMatch(expanded, /^ {2}Read 1 file$/m);

// --- A failed read must not be reported as loaded content. --------------------

const failed = render([
	tool(pi, "read", "r5", { path: "src/missing.ts" }, "File not found: src/missing.ts", { isError: true, expanded: true }),
]);
assert.match(failed, /File not found/);
assert.doesNotMatch(failed, /lines? loaded/);

console.log("readonly aggregation tests passed");
