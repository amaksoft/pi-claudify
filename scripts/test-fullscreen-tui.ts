import assert from "node:assert/strict";

import extension from "../extensions/index.ts";
import {
	ALT_SCREEN_ENTER,
	ALT_SCREEN_LEAVE,
	FULLSCREEN_WIDGET_KEY,
	NORMAL_SCREEN_CLEAR,
	createFullscreenController,
	createFullscreenMarker,
	fillFullscreenLines,
	stripMountedIdleStatus,
} from "../extensions/fullscreen-tui.ts";

const marker = "\x1b_pi:claudify-fullscreen:test\x07";
const capturedMouseEnable = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
const capturedMouseDisable = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

const idle = ["header", " ".repeat(20), " ".repeat(20), "", marker, "editor", "footer"];
const filledIdle = fillFullscreenLines(idle, marker, 8, 20);
assert.equal(filledIdle.length, 8, "short idle output fills exactly to terminal height");
assert.deepEqual(filledIdle.slice(0, 2), ["header", ""], "only Pi's exact two full-width idle rows are removed");
assert.deepEqual(filledIdle.slice(-2), ["editor", "footer"], "the editor and footer remain the final rows");
assert.equal(filledIdle.some((line) => line.includes(marker)), false, "the invisible layout marker never reaches the terminal");

const working = ["header", "working", "", marker, "editor", "footer"];
const filledWorking = fillFullscreenLines(working, marker, 8, 20);
assert.equal(filledWorking.length, 8, "working output fills to terminal height");
assert.deepEqual(filledWorking.slice(0, 3), ["header", "working", ""], "a real working indicator is preserved");

const nonIdleBlanks = ["header", "", "", "", marker, "editor"];
assert.equal(
	fillFullscreenLines(nonIdleBlanks, marker, 6, 20).filter((line) => line === "").length,
	4,
	"ordinary empty transcript rows are not mistaken for Pi's full-width IdleStatus grammar",
);

const shorterWhitespace = ["header", " ".repeat(19), " ".repeat(19), "", marker, "editor"];
assert.equal(
	fillFullscreenLines(shorterWhitespace, marker, 6, 20).filter((line) => line.length === 19).length,
	2,
	"shorter whitespace rows do not match the exact full-width IdleStatus grammar",
);
assert.deepEqual(
	stripMountedIdleStatus(["header", " ".repeat(20), " ".repeat(20), "", "editor"], 20),
	["header", "", "editor"],
	"cleanup removes a mounted IdleStatus after fullscreen mode restores clear-on-shrink",
);
const long = [...Array.from({ length: 10 }, (_, index) => `line ${index}`), marker, "editor", "footer"];
assert.deepEqual(
	fillFullscreenLines(long, marker, 5, 20),
	["line 7", "line 8", "line 9", "editor", "footer"],
	"long output is bounded to the live transcript viewport while editor/footer rows remain pinned",
);
const scrolledLong = fillFullscreenLines(long, marker, 5, 80, 2);
assert.deepEqual(scrolledLong.slice(0, 2), ["line 5", "line 6"], "a bottom-relative scroll offset reveals earlier transcript rows");
assert.match(scrolledLong[2] ?? "", /line 7.*Jump to bottom/, "a scrolled viewport identifies how to return to the live bottom");
assert.deepEqual(scrolledLong.slice(-2), ["editor", "footer"], "the scroll hint does not displace editor/footer rows");
const noMarker = ["header", "editor", "footer"];
assert.equal(fillFullscreenLines(noMarker, marker, 20, 20), noMarker, "missing-marker fallback is an exact passthrough");
assert.deepEqual(fillFullscreenLines([marker, "editor"], marker, Number.NaN, 20), ["editor"], "invalid terminal height adds no filler");
assert.deepEqual(createFullscreenMarker(marker).render(1), [marker], "the widget exposes only its zero-width marker");

function makeTui(lines: () => string[] = () => ["header", "", marker, "editor", "footer"]) {
	const writes: string[] = [];
	const renderRequests: boolean[] = [];
	const focusedComponent = {};
	let clearOnShrink = false;
	const tui: any = {
		focusedComponent,
		terminal: {
			rows: 8,
			write(value: string): void {
				writes.push(value);
			},
		},
		render(): string[] {
			return lines();
		},
		requestRender(force = false): void {
			renderRequests.push(force);
			if (force) {
				this.render(80);
				this.terminal.write("\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jframe\x1b[?2026l");
			}
		},
		getClearOnShrink(): boolean {
			return clearOnShrink;
		},
		setClearOnShrink(value: boolean): void {
			clearOnShrink = value;
		},
	};
	return { tui, writes, renderRequests, focusedComponent, get clearOnShrink() { return clearOnShrink; } };
}

const controlled = makeTui();
const originalRender = controlled.tui.render;
const controller = createFullscreenController(controlled.tui, marker);
assert.ok(controller, "the installed Pi TUI capability set is accepted");
controller.enable();
assert.equal(controller.active, true, "enable marks the controller active");
assert.notEqual(controlled.tui.render, originalRender, "enable wraps the renderer that existed at activation");
assert.equal(controlled.clearOnShrink, true, "fullscreen rendering enables clear-on-shrink");
assert.equal(controlled.writes.filter((write) => write === ALT_SCREEN_ENTER).length, 1, "enable owns one captured alternate-screen transition");
assert.equal(controlled.writes.filter((write) => write === capturedMouseEnable).length, 1, "enable owns the captured terminal mouse modes");
assert.deepEqual(controlled.renderRequests, [true], "enable forces one clean redraw after entering the alternate screen");
assert.equal(controlled.tui.render(80).length, 8, "the live renderer uses current terminal height");
controlled.tui.terminal.rows = 6;
assert.equal(controlled.tui.render(40).length, 6, "the wrapper recalculates fill after resize");
controller.enable();
assert.equal(controlled.writes.filter((write) => write === ALT_SCREEN_ENTER).length, 1, "repeated enable is idempotent");
controller.disable();
assert.equal(controller.active, false, "disable marks the controller inactive");
assert.equal(controlled.tui.render, originalRender, "disable restores the renderer by identity when still owned");
assert.equal(controlled.clearOnShrink, false, "disable restores the previous clear-on-shrink value");
assert.equal(controlled.writes.filter((write) => write === ALT_SCREEN_LEAVE).length, 1, "disable leaves the alternate screen exactly once");
assert.equal(controlled.writes.filter((write) => write === capturedMouseDisable).length, 1, "disable restores every captured terminal mouse mode");
assert.ok(
	controlled.writes.indexOf(capturedMouseDisable) < controlled.writes.indexOf(ALT_SCREEN_LEAVE),
	"mouse reporting is disabled before the alternate screen is released",
);
assert.equal(controlled.writes.at(-1)?.includes("\x1b[3J"), false, "the normal-buffer redraw preserves restored shell scrollback");
assert.deepEqual(controlled.renderRequests, [true, true], "disable resets Pi's differential-render coordinates");
controller.disable();
assert.equal(controlled.writes.filter((write) => write === ALT_SCREEN_LEAVE).length, 1, "repeated disable is idempotent");

const failedActivation = makeTui();
const failedOriginalRender = failedActivation.tui.render;
const failedWrite = failedActivation.tui.terminal.write;
let rejectMouseEnable = true;
failedActivation.tui.terminal.write = (value: string): void => {
	failedWrite(value);
	if (value === capturedMouseEnable && rejectMouseEnable) {
		rejectMouseEnable = false;
		throw new Error("mouse mode write failed");
	}
};
const failedController = createFullscreenController(failedActivation.tui, marker)!;
assert.throws(() => failedController.enable(), /mouse mode write failed/, "activation surfaces a terminal mouse-mode failure");
assert.equal(failedController.active, false, "failed activation leaves the controller inactive");
assert.equal(failedActivation.tui.render, failedOriginalRender, "failed activation restores the original renderer");
assert.equal(failedActivation.clearOnShrink, false, "failed activation restores clear-on-shrink");
assert.equal(failedActivation.writes.filter((write) => write === capturedMouseDisable).length, 1, "failed activation disables possibly-partial mouse reporting");
assert.equal(failedActivation.writes.filter((write) => write === ALT_SCREEN_LEAVE).length, 1, "failed activation releases the alternate screen");

const failedDisable = makeTui();
const failedDisableController = createFullscreenController(failedDisable.tui, marker)!;
failedDisableController.enable();
const disableWrite = failedDisable.tui.terminal.write;
let rejectMouseDisable = true;
failedDisable.tui.terminal.write = (value: string): void => {
	disableWrite(value);
	if (value === capturedMouseDisable && rejectMouseDisable) {
		rejectMouseDisable = false;
		throw new Error("mouse mode restore failed");
	}
};
assert.throws(() => failedDisableController.disable(), /mouse mode restore failed/, "deactivation surfaces a terminal mouse-mode restoration failure");
assert.equal(failedDisableController.active, false, "failed deactivation still marks the controller inactive");
assert.equal(failedDisable.writes.filter((write) => write === ALT_SCREEN_LEAVE).length, 1, "failed mouse restoration still releases the alternate screen");
assert.equal(failedDisable.renderRequests.length, 2, "failed mouse restoration still resets Pi's differential-render coordinates");

let scrollTranscriptRows = 10;
const scrollable = makeTui(() => [
	...Array.from({ length: scrollTranscriptRows }, (_, index) => `line ${index}`),
	marker,
	"editor",
	"footer",
]);
const scrollController = createFullscreenController(scrollable.tui, marker)!;
scrollController.enable();
assert.deepEqual(
	scrollable.tui.render(80).slice(0, 6),
	["line 4", "line 5", "line 6", "line 7", "line 8", "line 9"],
	"the active viewport initially follows the transcript bottom",
);
assert.equal(scrollController.scrollPage("up"), true, "Page Up is consumed when transcript overflow exists");
const firstScrolledPage = scrollable.tui.render(80).slice(0, 6);
assert.deepEqual(firstScrolledPage.slice(0, 5), ["line 1", "line 2", "line 3", "line 4", "line 5"], "Page Up moves by half the available transcript viewport");
assert.match(firstScrolledPage[5] ?? "", /line 6.*Jump to bottom/, "Page Up shows the captured live-bottom hint");
scrollTranscriptRows = 12;
const anchoredPage = scrollable.tui.render(80).slice(0, 6);
assert.deepEqual(anchoredPage.slice(0, 5), ["line 1", "line 2", "line 3", "line 4", "line 5"], "a scrolled viewport stays anchored while streaming appends rows");
assert.match(anchoredPage[5] ?? "", /line 6.*Jump to bottom/, "the anchored viewport keeps its live-bottom hint");
assert.equal(scrollController.scrollPage("down"), true, "Page Down is consumed while transcript overflow exists");
assert.equal(scrollController.scrollPage("down"), true, "Page Down reaches the live bottom");
assert.deepEqual(
	scrollable.tui.render(80).slice(0, 6),
	["line 6", "line 7", "line 8", "line 9", "line 10", "line 11"],
	"the live bottom follows newly appended transcript rows",
);
scrollController.scrollPage("up");
scrollController.followBottom();
assert.deepEqual(
	scrollable.tui.render(80).slice(0, 6),
	["line 6", "line 7", "line 8", "line 9", "line 10", "line 11"],
	"submitting from a scrolled viewport can return directly to the live bottom",
);
scrollController.disable();

const composed = makeTui();
const composedOriginal = composed.tui.render;
const composedController = createFullscreenController(composed.tui, marker)!;
composedController.enable();
const claudifyWrapper = composed.tui.render;
const laterWrapper = function (this: any, width: number): string[] {
	return claudifyWrapper.call(this, width);
};
composed.tui.render = laterWrapper;
composedController.disable();
assert.equal(composed.tui.render, laterWrapper, "cleanup never clobbers a renderer installed later by another extension");
assert.deepEqual(composed.tui.render(80), composedOriginal.call(composed.tui, 80), "the retained Claudify wrapper becomes an inert delegate");

const incomplete = makeTui().tui;
delete incomplete.getClearOnShrink;
assert.equal(createFullscreenController(incomplete, marker), undefined, "partial Pi capability sets fail closed");

class FakePi {
	readonly tools = new Map<string, any>();
	readonly commands = new Map<string, any>();
	readonly events = new Map<string, Array<(...args: any[]) => any>>();

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
}

const pi = new FakePi();
extension(pi as any);
const command = pi.commands.get("tui");
assert.ok(command, "/tui is registered through Claudify's main entry point");

let widget: any;
let commandTranscript = ["header", ""];
const commandTui = makeTui(() => [...commandTranscript, ...(widget?.render(80) ?? []), "editor", "footer"]);
const notices: Array<[string, string | undefined]> = [];
const widgetOperations: Array<[string, "set" | "clear"]> = [];
const terminalInputHandlers = new Set<(data: string) => { consume?: boolean } | undefined>();
const ui = {
	theme: {},
	notify(message: string, type?: string): void {
		notices.push([message, type]);
	},
	setWidget(key: string, content: any): void {
		widgetOperations.push([key, content === undefined ? "clear" : "set"]);
		widget = content === undefined ? undefined : content(commandTui.tui, {});
	},
	onTerminalInput(handler: (data: string) => { consume?: boolean } | undefined): () => void {
		terminalInputHandlers.add(handler);
		return () => terminalInputHandlers.delete(handler);
	},
};
const tuiContext = { mode: "tui", hasUI: true, ui };

await command.handler("", tuiContext);
assert.deepEqual(widgetOperations, [[FULLSCREEN_WIDGET_KEY, "set"]], "first /tui invocation installs one marker widget");
assert.equal(commandTui.writes.filter((write) => write === ALT_SCREEN_ENTER).length, 1, "the command enters the alternate screen");
assert.deepEqual(notices.at(-1), ["Fullscreen TUI enabled", "info"], "enable reports its state");
assert.equal(commandTui.tui.render(80).length, commandTui.tui.terminal.rows, "the command's live marker drives fill rendering");
assert.equal(terminalInputHandlers.size, 1, "fullscreen activation installs one raw paging listener");
const initialInput = [...terminalInputHandlers][0];
assert.equal(initialInput("\x1b[5~"), undefined, "Page Up remains available to the editor when transcript does not overflow");
assert.deepEqual(initialInput("\x1b[<64;20;4M"), { consume: true }, "recognized wheel input cannot leak into the editor when no scrolling is needed");
assert.deepEqual(initialInput("\x1b[<0;20;4M"), { consume: true }, "non-wheel SGR mouse input cannot leak into Pi's editor");

await command.handler("", tuiContext);
assert.deepEqual(widgetOperations.at(-1), [FULLSCREEN_WIDGET_KEY, "clear"], "second /tui invocation removes the marker widget");
assert.equal(commandTui.writes.filter((write) => write === ALT_SCREEN_LEAVE).length, 1, "the command reverses alternate-screen ownership");
assert.equal(commandTui.writes.filter((write) => write === capturedMouseDisable).length, 1, "the command restores mouse reporting on toggle-off");
assert.deepEqual(notices.at(-1), ["Fullscreen TUI disabled", "info"], "disable reports its state");
assert.equal(terminalInputHandlers.size, 0, "fullscreen deactivation removes its raw paging listener");

for (const mode of ["rpc", "json", "print"] as const) {
	const modeNotices: Array<[string, string]> = [];
	await command.handler("", {
		mode,
		hasUI: mode === "rpc",
		ui: {
			notify(message: string, type: string): void {
				modeNotices.push([message, type]);
			},
			setWidget(): void {
				assert.fail(`${mode} mode must not install a fullscreen widget`);
			},
		},
	});
	assert.deepEqual(modeNotices, [["/tui needs the interactive TUI", "info"]], `${mode} mode gets a clear TUI-only notice`);
}

await command.handler("", tuiContext);
assert.equal(commandTui.writes.filter((write) => write === ALT_SCREEN_ENTER).length, 2, "fullscreen can be enabled again after a clean toggle");
for (const handler of pi.events.get("session_shutdown") ?? []) {
	await handler({ reason: "reload" }, tuiContext);
}
assert.equal(commandTui.writes.filter((write) => write === ALT_SCREEN_LEAVE).length, 2, "reload shutdown leaves the alternate screen");
assert.equal(commandTui.writes.filter((write) => write === capturedMouseDisable).length, 2, "reload shutdown restores mouse reporting");
assert.deepEqual(widgetOperations.at(-1), [FULLSCREEN_WIDGET_KEY, "clear"], "reload shutdown removes the marker widget");

commandTranscript = Array.from({ length: 12 }, (_, index) => `line ${index}`);
await command.handler("", tuiContext);
const pageInput = [...terminalInputHandlers][0];
assert.deepEqual(pageInput("\x1b[<64;20;4M"), { consume: true }, "SGR wheel-up input is consumed for an overflowing fullscreen transcript");
const wheelScrolledPage = commandTui.tui.render(80).slice(0, 6);
assert.deepEqual(wheelScrolledPage.slice(0, 5), ["line 5", "line 6", "line 7", "line 8", "line 9"], "one wheel event moves the viewport by one transcript row");
assert.match(wheelScrolledPage[5] ?? "", /line 10.*Jump to bottom/, "wheel scrolling shows how to return to the live bottom");
assert.deepEqual(pageInput("\x1b[<65;20;4M"), { consume: true }, "SGR wheel-down input returns toward the live bottom");
assert.deepEqual(pageInput("\x1b[5~"), { consume: true }, "Page Up is consumed for an overflowing fullscreen transcript");
const rawScrolledPage = commandTui.tui.render(80).slice(0, 6);
assert.deepEqual(rawScrolledPage.slice(0, 5), ["line 3", "line 4", "line 5", "line 6", "line 7"], "raw Page Up input reveals the preceding half-page");
assert.match(rawScrolledPage[5] ?? "", /line 8.*Jump to bottom/, "raw Page Up shows how to return to the live bottom");
commandTui.tui.focusedComponent = {};
assert.equal(pageInput("\x1b[6~"), undefined, "paging input remains untouched while a custom component owns focus");
assert.equal(pageInput("\x1b[<64;20;4M"), undefined, "wheel input remains untouched while a custom component owns focus");
commandTui.tui.focusedComponent = commandTui.focusedComponent;
assert.deepEqual(pageInput("\x1b[6~"), { consume: true }, "Page Down returns the focused transcript toward the live bottom");
pageInput("\x1b[5~");
assert.equal(pageInput("\r"), undefined, "submitting input returns to the live bottom without consuming Enter");
assert.deepEqual(
	commandTui.tui.render(80).slice(0, 6),
	["line 6", "line 7", "line 8", "line 9", "line 10", "line 11"],
	"raw submit input restores the live transcript tail",
);
for (const handler of pi.events.get("session_shutdown") ?? []) {
	await handler({ reason: "quit" }, tuiContext);
}
commandTui.tui.requestRender(true); // a later extension's shutdown handler requests one last frame
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(commandTui.writes.filter((write) => write === ALT_SCREEN_LEAVE).length, 3, "quit shutdown leaves the alternate screen");
assert.equal(commandTui.writes.filter((write) => write === capturedMouseDisable).length, 3, "quit shutdown restores mouse reporting");
assert.equal(commandTui.writes.filter((write) => write === NORMAL_SCREEN_CLEAR).length, 1, "quit clears only the restored viewport before returning to the shell");
assert.equal(commandTui.writes.at(-1), NORMAL_SCREEN_CLEAR, "quit cleanup runs after later extensions' queued repaints");
assert.deepEqual(widgetOperations.at(-1), [FULLSCREEN_WIDGET_KEY, "clear"], "quit shutdown removes the marker widget");

console.log("fullscreen TUI tests passed");
