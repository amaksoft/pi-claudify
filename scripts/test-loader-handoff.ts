import assert from "node:assert/strict";

import { Loader } from "@earendil-works/pi-tui";

import extension from "../extensions/index.ts";
import { LOADER_INTERVAL_MS } from "../extensions/spinner.ts";
import { testedPiPatchBroker } from "../extensions/adapters/tested-pi/patch-broker.ts";

import { useSandboxHome } from "./sandbox-home.ts";

// Assert default settings, not the runner's own ~/.pi configuration.
useSandboxHome("loader-handoff");

const LOADER_ACTIVE = Symbol.for("pi-claudify:loader-active");
const LOADER_SURFACE = "spinner-loader";

class FakePi {
	tools = new Map<string, any>();
	commands = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void {
		this.tools.set(definition.name, definition);
	}
	registerCommand(name: string, command: any): void {
		this.commands.set(name, command);
	}
	on(name: string, handler: (...args: any[]) => any): void {
		this.events.set(name, [...(this.events.get(name) ?? []), handler]);
	}
	getThinkingLevel(): string {
		return "off";
	}
	getAllTools(): any[] {
		return [...this.tools.values()];
	}
	async emit(name: string, event: any, ctx: any = {}): Promise<void> {
		for (const handler of this.events.get(name) ?? []) await handler(event, ctx);
	}
}

function makeUi(): any {
	const ui: any = {
		theme: { fg: (_key: string, text: string) => text, bold: (text: string) => text },
		requestRender() {},
		setFooter() {},
		setWorkingMessage() {},
		notify() {},
		setHiddenThinkingLabel() {},
	};
	return ui;
}

function makeCtx(ui: any, sessionId: string): any {
	return {
		mode: "tui",
		hasUI: true,
		ui,
		sessionManager: { getSessionId: () => sessionId, getSessionFile: () => `${sessionId}.jsonl`, getCwd: () => process.cwd() },
		cwd: process.cwd(),
		isProjectTrusted: () => false,
		getContextUsage: () => ({ percent: 10 }),
	};
}

const identity = (text: string): string => text;
function spin(message: string): any {
	const loader = new Loader({ requestRender() {}, stopped: false, theme: undefined } as any, identity, identity, message);
	loader.start();
	return loader as any;
}
function stopped(loader: any): boolean {
	return loader[LOADER_ACTIVE] !== true && (loader.intervalId === null || loader.intervalId === undefined);
}
async function waitFor(label: string, predicate: () => boolean, timeoutMs = 6_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

// Two extension generations sharing one process, like /reload: the first
// generation retires while its spinner is still running, then a successor
// generation claims the same session and binds its own spinner surface.
const previous = new FakePi();
(extension as any)(previous);
const previousCtx = makeCtx(makeUi(), "loader-handoff-session");
await previous.emit("session_start", { reason: "startup" }, previousCtx);
const abandoned = spin("Working");
assert.equal(abandoned[LOADER_ACTIVE], true, "first-generation spinner arms its chain");
const firstFrame = abandoned.currentFrame;
await waitFor("first-generation chain to tick", () => abandoned.currentFrame !== firstFrame, LOADER_INTERVAL_MS * 6);

// The host retires the old runner, then the successor generation starts on
// the same session and claims the handoff rank.
await previous.emit("session_shutdown", { reason: "reload" }, previousCtx);
const successor = new FakePi();
(extension as any)(successor);
await successor.emit("session_start", { reason: "reload" }, makeCtx(makeUi(), "loader-handoff-session"));
await waitFor(
	"abandoned chain to stop itself after the surface handoff",
	() => stopped(abandoned),
	LOADER_INTERVAL_MS * 6,
);
const frozenFrame = abandoned.currentFrame;
await new Promise((resolve) => setTimeout(resolve, LOADER_INTERVAL_MS + 250));
assert.equal(abandoned.currentFrame, frozenFrame, "abandoned chain never re-arms after stopping");

// The successor generation's own spinners are unaffected by the handoff.
const current = spin("Working");
assert.equal(current[LOADER_ACTIVE], true, "successor spinner arms its own chain");
const successorFirst = current.currentFrame;
await waitFor("successor chain to tick", () => current.currentFrame !== successorFirst, LOADER_INTERVAL_MS * 6);
assert.equal(abandoned.currentFrame, frozenFrame, "successor ticks do not revive the abandoned chain");

// Quitting releases the surface; the remaining chain stops on its next tick
// instead of pinning the Loader for the rest of the process.
await successor.emit("session_shutdown", { reason: "quit" }, makeCtx(makeUi(), "loader-handoff-session"));
await waitFor("successor chain to stop after quit", () => stopped(current), LOADER_INTERVAL_MS * 6);

// The retired generation's deferred release settles, leaving no
// spinner-loader surface behind.
await new Promise((resolve) => setTimeout(resolve, 1_300));
assert.equal(
	testedPiPatchBroker.values(LOADER_SURFACE).length,
	0,
	"reload/quit releases every spinner-loader surface",
);

console.log("loader handoff tests passed");
