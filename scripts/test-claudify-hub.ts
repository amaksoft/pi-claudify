import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
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
const { MAX_CUSTOM_SPINNER_VERBS, sanitizeSpinnerVerbs } = await import("../extensions/spinner.ts");
const { MAX_CUSTOM_WORKED_VERBS, sanitizeWorkedVerbs } = await import("../extensions/message-chrome.ts");
const pickerCandidates = { diffThemes: DIFF_PRESET_KEYS, colorKeys: COMMON_COLOR_KEYS };

assert.equal(
	sanitizeSpinnerVerbs(Array.from({ length: MAX_CUSTOM_SPINNER_VERBS + 1 }, (_, index) => `Spinner ${index}`)).length,
	MAX_CUSTOM_SPINNER_VERBS,
	"the Spinner sanitizer caps custom verbs at its exported limit",
);
assert.equal(
	sanitizeWorkedVerbs(Array.from({ length: MAX_CUSTOM_WORKED_VERBS + 1 }, (_, index) => `Worked ${index}`)).length,
	MAX_CUSTOM_WORKED_VERBS,
	"the Worked sanitizer caps custom verbs at its exported limit",
);

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
			|| (action === "tui.editor.deleteCharBackward" && data === "backspace")
			|| (action === "tui.editor.deleteCharForward" && data === "delete")
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
assert.match(toolOutput, /^\s*MCP output\s+preview\s+\(Claude: hidden\)[ \t]*$/m, "a deviating fidelity enum names its Claude-authentic value");
assert.doesNotMatch(toolOutput, /[╭╮╰╯│]/, "Tool output rows are unboxed");
assert.ok(toolOutput.includes("Enter/Space to change · Esc to back"), "enum rows render the change footer");

settingsScreen.handleInput("down");
settingsScreen.handleInput("right");
assert.match(render(settingsScreen), /^\s*❯ MCP output\s+hidden\s+✓ Claude[ \t]*$/m, "an authentic fidelity enum renders its Claude marker");
settingsScreen.handleInput("up");
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
assert.match(themeSection, /^\s*Diff palette\s+claude[ \t]*$/m, "a self-evident claude-valued enum renders no redundant marker");
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
assert.match(render(diffScreen), /^\s*❯ Collapsed diff lines\s+10[ \t]*$/m, "a preference row renders its default with no Claude marker");
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

const verbChanges: Array<[string, unknown]> = [];
const verbScreen = new ClaudifyScreen(
	{ requestRender(): void {} } as any,
	theme,
	keybindings as any,
	() => {},
	(key, value) => { verbChanges.push([key, value]); },
	undefined,
	pickerCandidates,
);
verbScreen.handleInput("down");
verbScreen.handleInput("down");
verbScreen.handleInput("enter");
const spinnerVerbRows = render(verbScreen);
assert.ok(spinnerVerbRows.includes("While working"), "Spinner renders the Spinner verbs editor under While working");
assert.ok(spinnerVerbRows.includes("After finishing"), "Spinner renders the Worked verbs editor under After finishing");
assert.match(spinnerVerbRows, /While working\s+0 custom · append/, "Spinner verbs summarize their custom count and effective mode");
assert.match(spinnerVerbRows, /After finishing\s+0 custom · append/, "Worked verbs summarize their custom count and effective mode");

verbScreen.handleInput("down");
verbScreen.handleInput("down");
verbScreen.handleInput("enter");
assert.ok(render(verbScreen).includes("No custom verbs — using built-ins"), "an empty Spinner verb list visibly falls back to built-ins");
assert.match(render(verbScreen), /^\s*❯ Mode\s+append/m, "the Spinner verb editor opens on its mode row");
verbScreen.handleInput("enter");
assert.equal(readWrittenSettings().spinnerVerbMode, "replace", "Spinner verb mode toggles to replace");
verbScreen.handleInput("enter");
assert.equal(readWrittenSettings().spinnerVerbMode, "append", "Spinner verb mode toggles back to append");
verbScreen.handleInput("enter");
assert.equal(readWrittenSettings().spinnerVerbMode, "replace", "Spinner verb mode can persist replace again");

verbScreen.handleInput("down");
verbScreen.handleInput("enter");
assert.ok(render(verbScreen).includes("Type a verb or phrase · Enter to add · Esc to cancel"), "Add opens the inline phrase input");
verbScreen.handleInput("Discard this draft");
verbScreen.handleInput("escape");
assert.ok(!Object.hasOwn(readWrittenSettings(), "spinnerVerbs"), "Esc cancels a partially entered verb without writing settings");
assert.match(render(verbScreen), /^\s*❯ Add…/m, "cancelling Add returns navigation to the same pool editor");
verbScreen.handleInput("enter");
verbScreen.handleInput("  Reticulating splines  ");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines"], "Spinner Add sanitizes and persists a multi-word phrase");
verbScreen.handleInput("down");
verbScreen.handleInput("enter");
verbScreen.handleInput("reticulating SPLINES");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines"], "Spinner Add rejects a case-insensitive duplicate");
verbScreen.handleInput("enter");
verbScreen.handleInput("   ");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines"], "Spinner Add rejects whitespace-only input");
verbScreen.handleInput("enter");
verbScreen.handleInput("Balancing gyros");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines", "Balancing gyros"], "Spinner Add preserves earlier custom entries");
verbScreen.handleInput("backspace");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines"], "Backspace removes the highlighted Spinner verb only");
verbScreen.handleInput("up");
verbScreen.handleInput("delete");
assert.ok(!Object.hasOwn(readWrittenSettings(), "spinnerVerbs"), "removing the last Spinner verb deletes the settings key instead of writing an empty list");
verbScreen.handleInput("enter");
verbScreen.handleInput("Spinning plates");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Spinning plates"], "Spinner verbs can be added again after falling back to built-ins");
verbScreen.handleInput("escape");

const spinnerSettingsBeforeWorkedEdit = {
	verbs: readWrittenSettings().spinnerVerbs,
	mode: readWrittenSettings().spinnerVerbMode,
};
verbScreen.handleInput("down");
verbScreen.handleInput("enter");
assert.ok(render(verbScreen).includes("No custom verbs — using built-ins"), "an empty Worked verb list visibly falls back to built-ins");
assert.match(render(verbScreen), /^\s*❯ Mode\s+append/m, "the Worked verb editor opens on its mode row");
verbScreen.handleInput("enter");
assert.equal(readWrittenSettings().workedVerbMode, "replace", "Worked verb mode toggles to replace");
verbScreen.handleInput("enter");
assert.equal(readWrittenSettings().workedVerbMode, "append", "Worked verb mode toggles back to append");
verbScreen.handleInput("enter");
assert.equal(readWrittenSettings().workedVerbMode, "replace", "Worked verb mode can persist replace again");

verbScreen.handleInput("down");
verbScreen.handleInput("enter");
verbScreen.handleInput("  Polished the brass  ");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().workedVerbs, ["Polished the brass"], "Worked Add sanitizes and persists a multi-word phrase");
verbScreen.handleInput("down");
verbScreen.handleInput("enter");
verbScreen.handleInput("polished THE BRASS");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().workedVerbs, ["Polished the brass"], "Worked Add rejects a case-insensitive duplicate");
verbScreen.handleInput("enter");
verbScreen.handleInput("   ");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().workedVerbs, ["Polished the brass"], "Worked Add rejects whitespace-only input");
verbScreen.handleInput("enter");
verbScreen.handleInput("Wrapped up");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().workedVerbs, ["Polished the brass", "Wrapped up"], "Worked Add preserves earlier custom entries");
verbScreen.handleInput("backspace");
assert.deepEqual(readWrittenSettings().workedVerbs, ["Polished the brass"], "Backspace removes the highlighted Worked verb only");
verbScreen.handleInput("up");
verbScreen.handleInput("delete");
assert.ok(!Object.hasOwn(readWrittenSettings(), "workedVerbs"), "removing the last Worked verb deletes the settings key instead of writing an empty list");
verbScreen.handleInput("enter");
verbScreen.handleInput("Filed the result");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().workedVerbs, ["Filed the result"], "Worked verbs can be added again after falling back to built-ins");
assert.deepEqual(
	{ verbs: readWrittenSettings().spinnerVerbs, mode: readWrittenSettings().spinnerVerbMode },
	spinnerSettingsBeforeWorkedEdit,
	"editing Worked verbs leaves the Spinner verb pool untouched",
);
assert.ok(verbChanges.some(([key]) => key === "spinnerVerbs"), "Spinner verb list commits notify the host");
assert.ok(verbChanges.some(([key]) => key === "spinnerVerbMode"), "Spinner verb mode commits notify the host");
assert.ok(verbChanges.some(([key]) => key === "workedVerbs"), "Worked verb list commits notify the host");
assert.ok(verbChanges.some(([key]) => key === "workedVerbMode"), "Worked verb mode commits notify the host");

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
const finishedAssistant = new AssistantMessageComponent({
	role: "assistant",
	content: [{ type: "text", text: "Finished." }],
	stopReason: "stop",
} as any, false);
assert.match(
	stripAnsi(finishedAssistant.render(100).join("\n")),
	/✻ Filed the result for \d+s/,
	"a finished assistant render immediately consumes the edited Worked verb pool",
);
const command = pi.commands.get("claudify");
assert.ok(command, "/claudify is registered");
for (const removedCommand of ["cc-tools", "cc-theme", "cc-spinner", "cc-message"]) {
	assert.equal(pi.commands.has(removedCommand), false, `/${removedCommand} is not registered`);
}

let tuiCustomCalls = 0;
let hostRenderRequests = 0;
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
					{ requestRender(): void { hostRenderRequests += 1; } },
					theme,
					keybindings,
					resolve,
				);
				component.handleInput("down");
				component.handleInput("down");
				component.handleInput("enter");
				component.handleInput("enter");
				const beforeHostPreview = readFileSync(settingsPath, "utf8");
				component.handleInput("down");
				const spinnerPreviewKey = Symbol.for("pi-claudify:spinner-color-preview");
				assert.equal((globalThis as any)[spinnerPreviewKey], "error", "the registered command installs the real spinner preview override");
				assert.equal(readFileSync(settingsPath, "utf8"), beforeHostPreview, "the command-level preview path does not write settings");
				component.handleInput("escape");
				assert.equal((globalThis as any)[spinnerPreviewKey], undefined, "the registered command clears its preview override on cancel");

				component.handleInput("down");
				component.handleInput("down");
				component.handleInput("enter");
				const spinnerBustKey = Symbol.for("pi-claudify:spinner-settings-bust");
				const beforeModeBust = ((globalThis as any)[spinnerBustKey] as number | undefined) ?? 0;
				component.handleInput("enter");
				assert.equal(readWrittenSettings().spinnerVerbMode, "append", "the registered command persists Spinner verb mode changes");
				assert.ok((globalThis as any)[spinnerBustKey] > beforeModeBust, "Spinner verb mode changes bust the running Spinner settings cache");
				component.handleInput("down");
				component.handleInput("down");
				component.handleInput("enter");
				component.handleInput("Juggling planets");
				const beforeVerbBust = (globalThis as any)[spinnerBustKey] as number;
				component.handleInput("enter");
				assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Spinning plates", "Juggling planets"], "the registered command persists Spinner verb additions");
				assert.ok((globalThis as any)[spinnerBustKey] > beforeVerbBust, "Spinner verb list changes bust the running Spinner settings cache");
				component.handleInput("escape");
				component.handleInput("escape");
				component.handleInput("escape");
			});
		},
	},
});
assert.equal(tuiCustomCalls, 1, "TUI mode opens one custom overlay");
assert.ok(hostRenderRequests >= 8, "the real preview callback requests host repaints while the Picker is active");
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

// A theme missing one of COMMON_COLOR_KEYS must not crash the Picker render.
// theme.fg() throws on an unknown key, so a custom/minimal theme (or a key
// dropped across an upgrade) would otherwise take the whole /claudify overlay
// down the moment the Spinner Section or a color Picker paints.
const missingKey = COMMON_COLOR_KEYS[COMMON_COLOR_KEYS.length - 1];
const partialTheme = new Proxy(theme, {
	get(target, prop, receiver) {
		if (prop === "fg") {
			return (color: string, text: string): string => {
				if (color === missingKey) throw new Error(`Unknown theme color: ${color}`);
				return target.fg(color as never, text);
			};
		}
		return Reflect.get(target, prop, receiver);
	},
});
const resilientScreen = new ClaudifyScreen(
	{ requestRender: () => {} } as any,
	partialTheme as any,
	keybindings as any,
	() => {},
	() => {},
	() => {},
	pickerCandidates,
);
resilientScreen.handleInput("down");
resilientScreen.handleInput("down");
resilientScreen.handleInput("enter");
assert.doesNotThrow(() => render(resilientScreen), "the Spinner Section paints even when the theme lacks a color key");
resilientScreen.handleInput("enter");
assert.doesNotThrow(() => render(resilientScreen), "a color Picker candidate list paints past a theme key it cannot resolve");
assert.match(render(resilientScreen), new RegExp(missingKey), "the unresolved key still renders as plain text rather than crashing");

console.log("claudify Hub and immediate-commit Section tests passed");
