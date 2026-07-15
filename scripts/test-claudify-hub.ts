import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const sandbox = mkdtempSync(join(tmpdir(), "claudify-sections-"));
const home = join(sandbox, "home");
const cwd = join(sandbox, "project");
const settingsPath = join(home, ".pi", "settings.json");
mkdirSync(join(home, ".pi"), { recursive: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(settingsPath, JSON.stringify({ spinnerVerbColor: "legacy-color", toolBackground: "border" }));
process.env.HOME = home;
process.chdir(cwd);

const { ClaudifyScreen } = await import("../extensions/claudify-screen.ts");
const { default: extension, COMMON_COLOR_KEYS, DIFF_PRESET_KEYS } = await import("../extensions/index.ts");
const pickerCandidates = { diffThemes: DIFF_PRESET_KEYS, colorKeys: COMMON_COLOR_KEYS };

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function render(screen: InstanceType<typeof ClaudifyScreen>): string {
	return stripAnsi(screen.render(100).join("\n"));
}

function readWrittenSettings(): Record<string, unknown> {
	return JSON.parse(readFileSync(settingsPath, "utf8"));
}

const keybindings = {
	matches(data: string, action: string): boolean {
		return (
			(action === "tui.select.up" && data === "up")
			|| (action === "tui.select.down" && data === "down")
			|| (action === "tui.select.confirm" && data === "enter")
			|| (action === "tui.select.cancel" && data === "escape")
			|| (action === "tui.editor.cursorLeft" && data === "left")
			|| (action === "tui.editor.cursorRight" && data === "right")
		);
	},
};

initTheme("dark", false);
let renderRequests = 0;
let closeCount = 0;
const changedKeys: string[] = [];
const screen = new ClaudifyScreen(
	{ requestRender: () => { renderRequests += 1; } } as any,
	theme,
	keybindings as any,
	() => { closeCount += 1; },
	(key) => { changedKeys.push(key); },
	undefined,
	pickerCandidates,
);

const hub = render(screen);
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
const movedHub = render(screen);
assert.match(movedHub, /^\s*❯ Spinner/m, "arrow navigation moves the Hub highlight");

screen.handleInput("enter");
const section = render(screen);
assert.ok(section.includes("Spinner color"), "Enter drills into the highlighted Spinner Section");
assert.ok(section.includes("Status color"), "Spinner renders both color Picker rows");
assert.ok(section.includes("Enter to choose · Esc to back"), "a Picker row renders its Section footer");
assert.ok(!section.includes("Esc to close"), "a Section does not render the Hub footer");

screen.handleInput("escape");
assert.match(render(screen), /^\s*❯ Spinner/m, "Esc returns to the Hub and preserves its highlight");
screen.handleInput("escape");
assert.equal(closeCount, 1, "Esc from the Hub closes the Claudify screen");

const settingsScreen = new ClaudifyScreen(
	{ requestRender: () => { renderRequests += 1; } } as any,
	theme,
	keybindings as any,
	() => {},
	(key) => { changedKeys.push(key); },
	undefined,
	pickerCandidates,
);
for (let index = 0; index < 4; index++) settingsScreen.handleInput("down");
settingsScreen.handleInput("enter");
const toolOutput = render(settingsScreen);
for (const label of [
	"Tool background",
	"MCP output",
	"Bash output",
	"Preview lines",
	"Collapsed Bash lines",
	"Stack consecutive Bash",
	"Semantic Bash display",
	"Group read-only tools",
	"Read-only group limit",
	"Expanded preview max lines",
]) {
	assert.ok(toolOutput.includes(label), `Tool output renders ${label}`);
}
assert.match(toolOutput, /^\s*❯ Tool background\s+outlines/m, "Tool output selects its first row and shows the effective legacy value");
assert.doesNotMatch(toolOutput, /[╭╮╰╯│]/, "Tool output rows are unboxed");
assert.ok(toolOutput.includes("Enter/Space to change · Esc to back"), "enum rows render the change footer");

settingsScreen.handleInput("left");
settingsScreen.handleInput("right");
assert.match(render(settingsScreen), /^\s*❯ Tool background\s+outlines/m, "cycling an enum updates the assembled render and keeps selection");
let written = readWrittenSettings();
assert.equal(written.toolBackground, "outlines", "the enum persists its canonical value");
assert.equal(written.spinnerColor, "legacy-color", "writing preserves a legacy alias value under its canonical key");
assert.ok(!Object.hasOwn(written, "spinnerVerbColor"), "writing drops the legacy alias key");

for (let index = 0; index < 5; index++) settingsScreen.handleInput("down");
assert.match(render(settingsScreen), /^\s*❯ Stack consecutive Bash\s+true/m, "boolean navigation reaches the expected row");
settingsScreen.handleInput("enter");
assert.match(render(settingsScreen), /^\s*❯ Stack consecutive Bash\s+false/m, "toggling a boolean updates the assembled render");
assert.equal(readWrittenSettings().bashStackConsecutive, false, "the boolean change persists immediately");

settingsScreen.handleInput("up");
settingsScreen.handleInput("up");
assert.match(render(settingsScreen), /^\s*❯ Preview lines\s+8/m, "number navigation reaches the expected row and default");
settingsScreen.handleInput("right");
assert.match(render(settingsScreen), /^\s*❯ Preview lines\s+9/m, "adjusting a number updates the assembled render");
assert.equal(readWrittenSettings().previewLines, 9, "the number change persists immediately");

settingsScreen.handleInput("escape");
settingsScreen.handleInput("up");
settingsScreen.handleInput("enter");
const messages = render(settingsScreen);
for (const [label, value] of [
	["Message style", "claude"],
	["Assistant prefix", "⏺"],
	["Thinking prefix", "✻"],
	["Message spacing", "comfortable"],
	["Hidden thinking label", "Pondering..."],
]) {
	assert.ok(messages.includes(label) && messages.includes(value), `Messages renders ${label} with its effective value`);
}
assert.match(messages, /^\s*❯ Message style\s+claude/m, "Messages selects its first row");
assert.doesNotMatch(messages, /[╭╮╰╯│]/, "Messages rows are unboxed");

settingsScreen.handleInput("enter");
assert.match(render(settingsScreen), /^\s*❯ Message style\s+classic/m, "cycling a message enum updates the assembled render");
assert.equal(readWrittenSettings().messageStyle, "classic", "the message enum persists immediately");
settingsScreen.handleInput("down");
settingsScreen.handleInput("enter");
assert.ok(render(settingsScreen).includes("Type a value · Enter to save · Esc to cancel"), "a text row opens an in-component input with a stateful footer");
settingsScreen.handleInput("◆");
settingsScreen.handleInput("enter");
assert.match(render(settingsScreen), /^\s*❯ Assistant prefix\s+◆/m, "submitting text updates the assembled render");
assert.equal(readWrittenSettings().assistantPrefix, "◆", "sanitized text persists immediately");

assert.deepEqual(DIFF_PRESET_KEYS, ["default", "midnight", "neon"], "the Picker consumes the renderer's exact diff preset keys");
assert.ok(COMMON_COLOR_KEYS.includes("borderAccent") && COMMON_COLOR_KEYS.includes("muted"), "the Spinner Picker consumes the renderer's common color keys");

const pickerChanges: Array<[string, unknown]> = [];
const pickerPreviews: Array<[string, unknown]> = [];
const pickerScreen = new ClaudifyScreen(
	{ requestRender: () => { renderRequests += 1; } } as any,
	theme,
	keybindings as any,
	() => {},
	(key, value) => { pickerChanges.push([key, value]); },
	(key, value) => { pickerPreviews.push([key, value]); },
	pickerCandidates,
);
pickerScreen.handleInput("enter");
let themeSection = render(pickerScreen);
for (const label of ["Adaptive colors", "Diff palette", "Tool chrome", "Diff theme"]) {
	assert.ok(themeSection.includes(label), `Theme renders ${label}`);
}
assert.doesNotMatch(themeSection, /coming soon/, "Theme no longer renders its placeholder");
pickerScreen.handleInput("enter");
assert.equal(readWrittenSettings().themeAdaptive, false, "Theme adaptive commits immediately");
pickerScreen.handleInput("down");
pickerScreen.handleInput("enter");
assert.equal(readWrittenSettings().diffPalette, "theme", "Diff palette commits immediately");
pickerScreen.handleInput("down");
pickerScreen.handleInput("enter");
assert.equal(readWrittenSettings().toolChrome, "theme", "Tool chrome commits immediately");
pickerScreen.handleInput("down");
pickerScreen.handleInput("enter");
assert.ok(render(pickerScreen).includes("Enter to select · Esc to cancel"), "opening a Picker renders the captured footer");
assert.match(render(pickerScreen), /None \(automatic\) ✔/, "the persisted unset diff theme keeps its marker");
const beforeDiffPreview = readFileSync(settingsPath, "utf8");
pickerScreen.handleInput("down");
assert.deepEqual(pickerPreviews.at(-1), ["diffTheme", "default"], "moving the Picker highlight emits a live preview");
assert.equal(readFileSync(settingsPath, "utf8"), beforeDiffPreview, "previewing a diff theme does not write settings");
assert.match(render(pickerScreen), /^\s*❯ 2\. default/m, "the preview marker moves independently of the persisted marker");
pickerScreen.handleInput("escape");
assert.deepEqual(pickerPreviews.at(-1), ["diffTheme", undefined], "Esc clears the diff theme preview");
assert.equal(readFileSync(settingsPath, "utf8"), beforeDiffPreview, "cancelling a diff theme Picker writes nothing");
pickerScreen.handleInput("enter");
pickerScreen.handleInput("down");
pickerScreen.handleInput("down");
pickerScreen.handleInput("enter");
assert.equal(readWrittenSettings().diffTheme, "midnight", "Enter persists the highlighted diff theme");
assert.deepEqual(pickerChanges.at(-1), ["diffTheme", "midnight"], "Picker commit notifies the host after clearing preview");

const diffScreen = new ClaudifyScreen(
	{ requestRender(): void {} } as any,
	theme,
	keybindings as any,
	() => {},
	(key) => { changedKeys.push(key); },
	undefined,
	pickerCandidates,
);
diffScreen.handleInput("down");
diffScreen.handleInput("enter");
assert.match(render(diffScreen), /^\s*❯ Collapsed diff lines\s+10/m, "Diffs renders its immediate-commit number row and default");
assert.doesNotMatch(render(diffScreen), /coming soon/, "Diffs no longer renders its placeholder");
diffScreen.handleInput("right");
assert.equal(readWrittenSettings().diffCollapsedLines, 11, "collapsed diff lines commits immediately");
for (let index = 0; index < 12; index++) diffScreen.handleInput("left");
assert.equal(readWrittenSettings().diffCollapsedLines, 0, "collapsed diff lines accepts zero and clamps at its minimum");

const spinnerScreen = new ClaudifyScreen(
	{ requestRender(): void {} } as any,
	theme,
	keybindings as any,
	() => {},
	(key, value) => { pickerChanges.push([key, value]); },
	(key, value) => { pickerPreviews.push([key, value]); },
	pickerCandidates,
);
spinnerScreen.handleInput("down");
spinnerScreen.handleInput("down");
spinnerScreen.handleInput("enter");
assert.match(render(spinnerScreen), /^\s*❯ Spinner color\s+borderAccent/m, "Spinner uses borderAccent as its effective default");
assert.doesNotMatch(render(spinnerScreen), /coming soon/, "Spinner no longer renders its placeholder");
spinnerScreen.handleInput("enter");
const beforeSpinnerPreview = readFileSync(settingsPath, "utf8");
spinnerScreen.handleInput("down");
assert.deepEqual(pickerPreviews.at(-1), ["spinnerColor", "success"], "spinner highlight movement emits the selected color key");
assert.equal(readFileSync(settingsPath, "utf8"), beforeSpinnerPreview, "spinner preview does not persist");
spinnerScreen.handleInput("escape");
assert.deepEqual(pickerPreviews.at(-1), ["spinnerColor", undefined], "Esc clears the spinner preview override");
assert.equal(readFileSync(settingsPath, "utf8"), beforeSpinnerPreview, "cancelling the spinner Picker writes nothing");
spinnerScreen.handleInput("enter");
spinnerScreen.handleInput("down");
spinnerScreen.handleInput("enter");
assert.equal(readWrittenSettings().spinnerColor, "success", "Enter commits the spinner color");
spinnerScreen.handleInput("down");
spinnerScreen.handleInput("enter");
spinnerScreen.handleInput("up");
spinnerScreen.handleInput("enter");
assert.equal(readWrittenSettings().spinnerStatusColor, "warning", "the status color Picker commits from the same candidate list");

assert.ok(changedKeys.includes("toolBackground"), "commits notify the host for live side effects");
assert.ok(changedKeys.includes("assistantPrefix"), "message commits notify the host for live side effects");
assert.ok(renderRequests >= 20, "navigation and commits request TUI repaints");

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
		theme,
		notify(): void {},
		setHiddenThinkingLabel(): void {},
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

console.log("claudify Hub and immediate-commit Section tests passed");
