import assert from "node:assert/strict";

import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { ClaudifyScreen } from "../extensions/claudify-screen.ts";
import extension from "../extensions/index.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

const keybindings = {
	matches(data: string, action: string): boolean {
		return (
			(action === "tui.select.up" && data === "up")
			|| (action === "tui.select.down" && data === "down")
			|| (action === "tui.select.confirm" && data === "enter")
			|| (action === "tui.select.cancel" && data === "escape")
		);
	},
};

initTheme("dark", false);
let renderRequests = 0;
let closeCount = 0;
const screen = new ClaudifyScreen(
	{ requestRender: () => { renderRequests += 1; } } as any,
	theme,
	keybindings as any,
	() => { closeCount += 1; },
);

const hub = stripAnsi(screen.render(80).join("\n"));
const sectionNames = ["Theme", "Diffs", "Spinner", "Messages", "Tool output"];
let previousIndex = -1;
for (const sectionName of sectionNames) {
	const index = hub.indexOf(sectionName);
	assert.ok(index > previousIndex, `${sectionName} renders after the preceding Section`);
	previousIndex = index;
}
assert.match(hub, /^\s*❯ Theme/m, "the highlighted Hub row uses the Claude selector");
assert.doesNotMatch(hub, /[╭╮╰╯│]/, "the Hub has no outer box chrome");
assert.ok(hub.includes("↑/↓ to move · Enter to open · Esc to close"), "the Hub renders its stateful footer");

screen.handleInput("down");
screen.handleInput("down");
const movedHub = stripAnsi(screen.render(80).join("\n"));
assert.match(movedHub, /^\s*❯ Spinner/m, "arrow navigation moves the Hub highlight");

screen.handleInput("enter");
const section = stripAnsi(screen.render(80).join("\n"));
assert.ok(section.includes("Spinner settings — coming soon"), "Enter drills into the highlighted Section");
assert.ok(section.includes("Esc to go back"), "a Section renders its own footer");
assert.ok(!section.includes("Esc to close"), "a Section does not render the Hub footer");

screen.handleInput("escape");
assert.match(stripAnsi(screen.render(80).join("\n")), /^\s*❯ Spinner/m, "Esc returns to the Hub and preserves its highlight");
screen.handleInput("escape");
assert.equal(closeCount, 1, "Esc from the Hub closes the Claudify screen");
assert.ok(renderRequests >= 4, "navigation requests TUI repaints");

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
const command = pi.commands.get("claudify");
assert.ok(command, "/claudify is registered");

let tuiCustomCalls = 0;
let receivedOverlayOptions: any;
await command.handler("", {
	mode: "tui",
	hasUI: true,
	ui: {
		notify(): void {},
		custom(factory: any, options: any): Promise<void> {
			tuiCustomCalls += 1;
			receivedOverlayOptions = options;
			return new Promise((resolve) => {
				const component = factory(
					{ requestRender(): void {} },
					theme,
					keybindings,
					resolve,
				);
				component.handleInput("escape");
			});
		},
	},
});
assert.equal(tuiCustomCalls, 1, "TUI mode opens one custom overlay");
assert.deepEqual(receivedOverlayOptions, {
	overlay: true,
	overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left" },
}, "the command opens a full-width overlay anchored over the transcript");

for (const mode of ["rpc", "json", "print"] as const) {
	const notices: Array<[string, string]> = [];
	let customCalls = 0;
	await command.handler("", {
		mode,
		hasUI: mode === "rpc",
		ui: {
			notify(message: string, level: string): void {
				notices.push([message, level]);
			},
			custom(): Promise<void> {
				customCalls += 1;
				return Promise.resolve();
			},
		},
	});
	assert.equal(customCalls, 0, `${mode} mode does not open the overlay`);
	assert.deepEqual(notices, [["/claudify needs the interactive TUI", "info"]], `${mode} mode emits the TUI notice`);
}

console.log("claudify Hub tests passed");
