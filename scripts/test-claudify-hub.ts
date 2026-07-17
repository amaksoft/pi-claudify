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
const { MAX_CUSTOM_SPINNER_VERBS, MAX_SPINNER_VERB_LENGTH, sanitizeSpinnerVerbs } = await import("../extensions/spinner.ts");
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
const sectionNames = ["Theme", "Diffs", "Spinner", "Messages", "Tool output", "Footer"];
let previousIndex = -1;
for (const sectionName of sectionNames) {
	const index = hub.indexOf(sectionName);
	assert.ok(index > previousIndex, `${sectionName} renders after the preceding Section`);
	previousIndex = index;
}
assert.match(hub, /^\s*❯ Theme/m, "the highlighted Hub row uses the Claude selector");
assert.doesNotMatch(hub, /[╭╮╰╯│]/, "the Hub has no outer box chrome");
assert.ok(hub.includes("↑/↓ to move · Enter to open · Esc to close"), "the Hub renders its stateful footer");

// The screen frames itself like the Extensions Manager: an accent rule top and bottom, a
// "Claudify" title, and a section-count subtitle on the Hub. The rule is a plain ─ run, not
// box chrome (the assertion above still holds).
const hubLines = hub.split("\n");
assert.match(hubLines[0], /^─{5,}$/, "the Hub opens with a full-width accent rule");
assert.match(hubLines.at(-1) ?? "", /^─{5,}$/, "the Hub closes with a full-width accent rule");
assert.match(hub, /^\s*Claudify[ \t]*$/m, "the framed panel renders its title");
assert.match(hub, /^\s*6 sections[ \t]*$/m, "the Hub renders its section-count subtitle");
assert.ok(
	hub.indexOf("Claudify") < hub.indexOf("❯ Theme"),
	"the title sits above the body rows",
);
assert.ok(
	hub.lastIndexOf("Enter to open") < hub.lastIndexOf("─"),
	"the footer is pinned above the closing rule",
);

// The panel fills the viewport height when a terminal size is available (mirroring the
// Extensions Manager's `rows - 12` list sizing). The default fake tui has no `.terminal`, so
// this uses a screen wired with an explicit row count.
const filledScreen = new ClaudifyScreen(
	{ requestRender() {}, terminal: { rows: 40, columns: 100 } } as any,
	theme,
	keybindings as any,
	() => {},
	undefined,
	undefined,
	pickerCandidates,
);
const filledLines = stripAnsi(filledScreen.render(100).join("\n")).split("\n");
assert.equal(filledLines.length, 35, "the framed panel fills to terminal.rows minus the reserve");
assert.match(filledLines.at(-1) ?? "", /^─{5,}$/, "the filled panel still closes with the accent rule");
assert.match(filledLines.at(-2) ?? "", /Enter to open/, "the footer stays pinned directly above the closing rule when filled");
assert.equal(filledLines[filledLines.length - 3], "", "fill padding sits between the body and the pinned footer");

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
assert.match(
	toolOutput,
	/^[ \t]+Keeps pi backgrounds, clears them, or outlines tool rows horizontally\.[ \t]*$/m,
	"the selected row renders its one-line description directly beneath it",
);
assert.doesNotMatch(
	toolOutput,
	/Hides MCP results, shows a status summary, or previews their payload\./,
	"an unselected row does not render its description",
);
assert.match(toolOutput, /^\s*MCP output\s+preview\s+\(Claude: hidden\)[ \t]*$/m, "a deviating fidelity enum names its Claude-authentic value");
assert.doesNotMatch(toolOutput, /[╭╮╰╯│]/, "Tool output rows are unboxed");
assert.ok(toolOutput.includes("Enter/Space to change · Esc to back"), "enum rows render the change footer");
const naturalToolOutputLines = toolOutput.split("\n");
assert.ok(naturalToolOutputLines.length < 35, "a Section without terminal dimensions keeps its natural framed height");
assert.match(naturalToolOutputLines[0], /^─{5,}$/, "the naturally sized Section opens with the accent rule");
assert.match(naturalToolOutputLines.at(-1) ?? "", /^─{5,}$/, "the naturally sized Section closes with the accent rule");

const filledSectionScreen = new ClaudifyScreen(
	{ requestRender() {}, terminal: { rows: 40, columns: 100 } } as any,
	theme,
	keybindings as any,
	() => {},
	undefined,
	undefined,
	pickerCandidates,
);
for (let index = 0; index < 4; index++) filledSectionScreen.handleInput("down");
filledSectionScreen.handleInput("enter");
const filledSectionLines = stripAnsi(filledSectionScreen.render(100).join("\n")).split("\n");
assert.equal(filledSectionLines.length, 35, "a Section with a selected-row description still fills to terminal.rows minus the reserve");
assert.match(filledSectionLines[0], /^─{5,}$/, "the filled Section opens with the accent rule");
assert.match(filledSectionLines.at(-1) ?? "", /^─{5,}$/, "the filled Section closes with the accent rule");
assert.match(filledSectionLines.at(-2) ?? "", /Enter\/Space to change/, "the filled Section footer stays directly above the closing rule");
assert.equal(filledSectionLines[filledSectionLines.length - 3], "", "the selected-row description reduces fill without displacing the footer");

settingsScreen.handleInput("down");
const selectedMcpOutput = render(settingsScreen);
assert.match(
	selectedMcpOutput,
	/^[ \t]+Hides MCP results, shows a status summary, or previews their payload\.[ \t]*$/m,
	"moving selection renders the new row's description",
);
assert.doesNotMatch(
	selectedMcpOutput,
	/Keeps pi backgrounds, clears them, or outlines tool rows horizontally\./,
	"moving selection removes the previous row's description",
);
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
	["Hidden thinking label", "Thinking..."],
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
for (let index = 0; index < 4; index++) settingsScreen.handleInput("down");
settingsScreen.handleInput("enter");
settingsScreen.handleInput("345678");
settingsScreen.handleInput("enter");
assert.equal(readWrittenSettings().userMessageBox, "#345678", "a custom user-message background commits as normalized hex");
assert.ok(changedKeys.includes("userMessageBox"), "a custom user-message background reaches the host for live reflection");

assert.deepEqual(DIFF_PRESET_KEYS, ["default", "midnight", "neon"], "the Picker consumes the renderer's exact diff preset keys");
assert.ok(COMMON_COLOR_KEYS.includes("borderAccent") && COMMON_COLOR_KEYS.includes("muted"), "the Spinner Picker consumes the renderer's common color keys");

const pickerChanges: Array<[string, unknown]> = [];
const pickerPreviews: Array<[string, unknown]> = [];
const pickerEvents: Array<["change" | "preview", string, unknown]> = [];
const pickerScreen = new ClaudifyScreen(
	{ requestRender: () => { renderRequests += 1; } } as any,
	theme,
	keybindings as any,
	() => {},
	(key, value) => {
		pickerChanges.push([key, value]);
		pickerEvents.push(["change", key, value]);
	},
	(key, value) => {
		pickerPreviews.push([key, value]);
		pickerEvents.push(["preview", key, value]);
	},
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
pickerScreen.handleInput("theme");
pickerScreen.handleInput("enter");
assert.equal(readWrittenSettings().accentColor, "theme", "Accent commits immediately");
pickerScreen.handleInput("enter");
pickerScreen.handleInput("12abef");
pickerScreen.handleInput("enter");
assert.equal(readWrittenSettings().accentColor, "#12ABEF", "a custom accent commits as normalized hex");
assert.deepEqual(pickerChanges.at(-1), ["accentColor", "#12ABEF"], "a custom accent reaches the host for live reflection");
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
assert.deepEqual(
	pickerEvents.slice(-2),
	[["preview", "diffTheme", undefined], ["change", "diffTheme", "midnight"]],
	"Picker commit clears its preview before notifying the host of the persisted live change",
);

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

const failedPickerChanges: Array<[string, unknown]> = [];
const failedPickerPreviews: Array<[string, unknown]> = [];
const failedPickerNotices: Array<[string, string | undefined]> = [];
const failedPickerScreen = new ClaudifyScreen(
	{ requestRender(): void {} } as any,
	theme,
	keybindings as any,
	() => {},
	(key, value) => { failedPickerChanges.push([key, value]); },
	(key, value) => { failedPickerPreviews.push([key, value]); },
	pickerCandidates,
	(message, type) => { failedPickerNotices.push([message, type]); },
);
failedPickerScreen.handleInput("down");
failedPickerScreen.handleInput("down");
failedPickerScreen.handleInput("enter");
failedPickerScreen.handleInput("enter");
failedPickerScreen.handleInput("down");
const previewBeforeFailure = failedPickerPreviews.at(-1);
const homeBeforeFailure = process.env.HOME;
process.env.HOME = "";
try {
	failedPickerScreen.handleInput("enter");
} finally {
	process.env.HOME = homeBeforeFailure;
}
assert.ok(render(failedPickerScreen).includes("Couldn't save to ~/.pi/settings.json"), "a failed Picker save replaces its footer with an inline error");
assert.deepEqual(failedPickerNotices.at(-1), ["Couldn't save to ~/.pi/settings.json", "error"], "a failed Picker save reaches the notification channel");
assert.deepEqual(failedPickerPreviews.at(-1), previewBeforeFailure, "a failed Picker save keeps its live preview installed");
assert.deepEqual(failedPickerChanges, [], "a failed Picker save does not report a persisted live change");
failedPickerScreen.handleInput("escape");
assert.deepEqual(failedPickerPreviews.at(-1), ["spinnerColor", undefined], "cancelling after a failed Picker save clears the retained preview");

const verbChanges: Array<[string, unknown]> = [];
const verbNotices: Array<[string, string | undefined]> = [];
const verbScreen = new ClaudifyScreen(
	{ requestRender(): void {} } as any,
	theme,
	keybindings as any,
	() => {},
	(key, value) => { verbChanges.push([key, value]); },
	undefined,
	pickerCandidates,
	(message, type) => { verbNotices.push([message, type]); },
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
assert.ok(render(verbScreen).includes("That verb or phrase is already in this list."), "a duplicate Add explains its rejection inline");
assert.deepEqual(verbNotices.at(-1), ["That verb or phrase is already in this list.", "warning"], "a duplicate Add reaches the notification channel");
verbScreen.handleInput("enter");
verbScreen.handleInput("   ");
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines"], "Spinner Add rejects whitespace-only input");
assert.ok(render(verbScreen).includes("Enter a verb or phrase before adding."), "an empty Add explains its rejection inline");
assert.deepEqual(verbNotices.at(-1), ["Enter a verb or phrase before adding.", "warning"], "an empty Add reaches the notification channel");
verbScreen.handleInput("enter");
const longVerb = "x".repeat(MAX_SPINNER_VERB_LENGTH + 1);
verbScreen.handleInput(longVerb);
verbScreen.handleInput("enter");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines", "x".repeat(MAX_SPINNER_VERB_LENGTH)], "Spinner Add persists the sanitized form of a long phrase");
assert.ok(render(verbScreen).includes(`Phrase shortened to ${MAX_SPINNER_VERB_LENGTH} characters.`), "a truncated Add reports the shortening inline");
assert.deepEqual(verbNotices.at(-1), [`Phrase shortened to ${MAX_SPINNER_VERB_LENGTH} characters.`, "warning"], "a truncated Add reaches the notification channel");
verbScreen.handleInput("down");
verbScreen.handleInput("enter");
verbScreen.handleInput(longVerb);
verbScreen.handleInput("enter");
const collapsedDuplicateNotice = `Phrase shortened to ${MAX_SPINNER_VERB_LENGTH} characters; that verb or phrase is already in this list.`;
assert.ok(render(verbScreen).includes(collapsedDuplicateNotice), "a truncated phrase that collapses to a duplicate reports both reasons inline");
assert.deepEqual(verbNotices.at(-1), [collapsedDuplicateNotice, "warning"], "a truncation-induced duplicate reaches the notification channel");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines", "x".repeat(MAX_SPINNER_VERB_LENGTH)], "a truncation-induced duplicate does not write");
verbScreen.handleInput("up");
verbScreen.handleInput("backspace");
assert.deepEqual(readWrittenSettings().spinnerVerbs, ["Reticulating splines"], "the truncated test phrase can be removed without disturbing earlier entries");
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

const recoverySandbox = mkdtempSync(join(tmpdir(), "claudify-recovery-"));
const recoveryHome = join(recoverySandbox, "home");
const recoverySettingsPath = join(recoveryHome, ".pi", "settings.json");
mkdirSync(join(recoveryHome, ".pi"), { recursive: true });
writeFileSync(recoverySettingsPath, "{ broken settings");
const homeBeforeRecovery = process.env.HOME;
process.env.HOME = recoveryHome;
try {
	const recoveryNotices: Array<[string, string | undefined]> = [];
	const recoveryScreen = new ClaudifyScreen(
		{ requestRender(): void {} } as any,
		theme,
		keybindings as any,
		() => {},
		undefined,
		undefined,
		pickerCandidates,
		(message, type) => { recoveryNotices.push([message, type]); },
	);
	for (let index = 0; index < 4; index++) recoveryScreen.handleInput("down");
	recoveryScreen.handleInput("enter");
	recoveryScreen.handleInput("enter");
	assert.ok(render(recoveryScreen).includes("Backed up invalid settings to ~/.pi/settings.json.bak"), "recovering invalid settings reports the backup inline");
	assert.deepEqual(recoveryNotices.at(-1), ["Backed up invalid settings to ~/.pi/settings.json.bak", "warning"], "settings recovery reaches the notification channel");
	assert.equal(readFileSync(`${recoverySettingsPath}.bak`, "utf8"), "{ broken settings", "the recovery notice corresponds to a real backup");

	writeFileSync(recoverySettingsPath, "{ backup then fail");
	mkdirSync(`${recoverySettingsPath}.tmp`);
	recoveryScreen.handleInput("enter");
	const partialRecoveryNotice = "Backed up to ~/.pi/settings.json.bak, but couldn't save to ~/.pi/settings.json";
	assert.ok(render(recoveryScreen).includes(partialRecoveryNotice), "a post-backup write failure keeps both outcomes in the inline footer");
	assert.deepEqual(recoveryNotices.at(-1), [partialRecoveryNotice, "error"], "a post-backup write failure sends one complete notification");
	assert.equal(readFileSync(`${recoverySettingsPath}.bak`, "utf8"), "{ backup then fail", "the partial-recovery notice corresponds to a real backup");
	assert.equal(readFileSync(recoverySettingsPath, "utf8"), "{ backup then fail", "a post-backup write failure leaves the invalid source intact");
} finally {
	process.env.HOME = homeBeforeRecovery;
}

const capSandbox = mkdtempSync(join(tmpdir(), "claudify-cap-"));
const capHome = join(capSandbox, "home");
const capSettingsPath = join(capHome, ".pi", "settings.json");
const cappedVerbs = Array.from({ length: MAX_CUSTOM_SPINNER_VERBS }, (_, index) => `Capped ${index}`);
mkdirSync(join(capHome, ".pi"), { recursive: true });
writeFileSync(capSettingsPath, JSON.stringify({ spinnerVerbs: cappedVerbs }));
const homeBeforeCap = process.env.HOME;
process.env.HOME = capHome;
try {
	const capNotices: Array<[string, string | undefined]> = [];
	const capScreen = new ClaudifyScreen(
		{ requestRender(): void {} } as any,
		theme,
		keybindings as any,
		() => {},
		undefined,
		undefined,
		pickerCandidates,
		(message, type) => { capNotices.push([message, type]); },
	);
	capScreen.handleInput("down");
	capScreen.handleInput("down");
	capScreen.handleInput("enter");
	capScreen.handleInput("down");
	capScreen.handleInput("down");
	capScreen.handleInput("enter");
	for (let index = 0; index <= MAX_CUSTOM_SPINNER_VERBS; index++) capScreen.handleInput("down");
	capScreen.handleInput("enter");
	capScreen.handleInput("One entry too many");
	capScreen.handleInput("enter");
	assert.ok(render(capScreen).includes(`Limit reached: ${MAX_CUSTOM_SPINNER_VERBS} custom entries.`), "Add at the cap explains its rejection inline");
	assert.deepEqual(capNotices.at(-1), [`Limit reached: ${MAX_CUSTOM_SPINNER_VERBS} custom entries.`, "warning"], "the cap rejection reaches the notification channel");
	assert.deepEqual(JSON.parse(readFileSync(capSettingsPath, "utf8")).spinnerVerbs, cappedVerbs, "Add at the cap leaves the persisted pool unchanged");
} finally {
	process.env.HOME = homeBeforeCap;
}

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
const commandNotices: Array<[string, string | undefined]> = [];
await command.handler("", {
	mode: "tui",
	hasUI: true,
	ui: {
		theme,
		notify(message: string, type?: string): void {
			commandNotices.push([message, type]);
		},
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
				const commandHome = process.env.HOME;
				process.env.HOME = "";
				try {
					component.handleInput("enter");
					component.handleInput("enter");
					assert.deepEqual(commandNotices.at(-1), ["Couldn't save to ~/.pi/settings.json", "error"], "the registered command forwards screen feedback through ctx.ui.notify");
				} finally {
					process.env.HOME = commandHome;
				}
				component.handleInput("escape");
				component.handleInput("escape");
				component.handleInput("escape");
			});
		},
	},
});
assert.equal(tuiCustomCalls, 1, "TUI mode opens one custom screen");
assert.ok(hostRenderRequests >= 8, "the real preview callback requests host repaints while the Picker is active");
assert.equal(receivedOverlayOptions, undefined, "the command renders the screen inline (no overlay) like the Extensions Manager");

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

// --- Claude accent override (docs/plans/2026-07-16-cc-accent-color.md) -------

const { applyAccentOverride, applyToolBackgroundMode } = await import("../extensions/index.ts");
const { clearSettingsCache } = await import("../extensions/settings.ts");

// Fakes mirror real pi themes: fgColors hold READY-MADE ANSI ESCAPES (theme.fg
// concatenates them verbatim — storing hex renders literal "#B1B9F9" text and
// crashes pi on line overflow, the 2.3.0 regression).
writeFileSync(settingsPath, "{}");
clearSettingsCache();
const PI_TEAL = "\x1b[38;2;138;190;183m";
const CC_LAVENDER_TC = "\x1b[38;2;177;185;249m";
const darkFake = { mode: "truecolor", fgColors: { accent: PI_TEAL, mdCode: PI_TEAL, mdListBullet: PI_TEAL, mdHeading: "\x1b[38;2;240;198;116m", text: "\x1b[38;2;212;212;212m" } };
applyAccentOverride(darkFake);
assert.equal(darkFake.fgColors.accent, CC_LAVENDER_TC, "default: pi's teal accent becomes CC's dark lavender as an ANSI escape");
assert.equal(darkFake.fgColors.mdCode, CC_LAVENDER_TC, "keys aliased to the accent var (inline code) follow the override");
assert.equal(darkFake.fgColors.mdListBullet, CC_LAVENDER_TC, "list bullets follow too");
assert.equal(darkFake.fgColors.mdHeading, "\x1b[38;2;240;198;116m", "non-aliased keys are untouched");
assert.doesNotMatch(darkFake.fgColors.accent, /#/, "no raw hex ever reaches fgColors");
applyAccentOverride(darkFake);
assert.equal(darkFake.fgColors.accent, CC_LAVENDER_TC, "re-applying is idempotent");

writeFileSync(settingsPath, JSON.stringify({ accentColor: "theme" }));
clearSettingsCache();
applyAccentOverride(darkFake);
assert.equal(darkFake.fgColors.accent, PI_TEAL, "accentColor=theme restores the theme's own accent exactly");
assert.equal(darkFake.fgColors.mdCode, PI_TEAL, "aliased keys restore exactly too");

writeFileSync(settingsPath, JSON.stringify({ accentColor: "#123456" }));
clearSettingsCache();
applyAccentOverride(darkFake);
assert.equal(darkFake.fgColors.accent, "\x1b[38;2;18;52;86m", "a custom accent is stored as a truecolor ANSI escape, never hex");
assert.equal(darkFake.fgColors.mdCode, "\x1b[38;2;18;52;86m", "accent aliases follow a custom truecolor accent");
assert.equal(darkFake.fgColors.mdListBullet, "\x1b[38;2;18;52;86m", "every captured accent alias follows the custom color");
assert.doesNotMatch(darkFake.fgColors.accent, /#123456/, "custom accent hex never reaches fgColors");

const custom256 = { mode: "256color", fgColors: { accent: "\x1b[38;5;73m", mdCode: "\x1b[38;5;73m", text: "\x1b[38;5;252m" } };
applyAccentOverride(custom256);
assert.equal(custom256.fgColors.accent, "\x1b[38;5;23m", "a custom accent uses pi's rgbTo256 quantizer in 256-color mode");
assert.equal(custom256.fgColors.mdCode, "\x1b[38;5;23m", "accent aliases follow the quantized custom accent");
assert.doesNotMatch(custom256.fgColors.accent, /#123456/, "custom accent hex never reaches 256-color fgColors");

// pi hands the same logical theme over as BOTH the instance and a forwarding
// Proxy. Snapshotting per object identity left the second arrival with no record
// of the theme's real accent, so accentColor="theme" restored the override
// forever and pi's own accent was unreachable without restarting pi.
writeFileSync(settingsPath, JSON.stringify({ accentColor: "#123456" }));
clearSettingsCache();
const proxiedInstance: any = { mode: "truecolor", fgColors: { accent: PI_TEAL, mdCode: PI_TEAL, text: "\x1b[38;2;212;212;212m" } };
const forwardingProxy: any = new Proxy(proxiedInstance, {});
applyAccentOverride(proxiedInstance);
applyAccentOverride(forwardingProxy);
assert.equal(proxiedInstance.fgColors.accent, "\x1b[38;2;18;52;86m", "a custom accent survives a render through pi's forwarding Proxy");
writeFileSync(settingsPath, JSON.stringify({ accentColor: "theme" }));
clearSettingsCache();
applyAccentOverride(forwardingProxy);
assert.equal(proxiedInstance.fgColors.accent, PI_TEAL, "accentColor=theme restores pi's own accent even when the Proxy identity applies the change");
assert.equal(proxiedInstance.fgColors.mdCode, PI_TEAL, "accent aliases restore through the Proxy identity too");

writeFileSync(settingsPath, "{}");
clearSettingsCache();
const fake256 = { mode: "256color", fgColors: { accent: "\x1b[38;5;73m", text: "\x1b[38;5;252m" } };
applyAccentOverride(fake256);
assert.equal(fake256.fgColors.accent, "\x1b[38;5;147m", "256-color themes get the quantized lavender (147, matching the CC capture)");

const lightFake = { mode: "truecolor", fgColors: new Map<string, string>([["accent", "\x1b[38;2;23;143;127m"], ["text", "\x1b[38;2;51;51;51m"]]) };
applyAccentOverride(lightFake);
assert.equal(lightFake.fgColors.get("accent"), "\x1b[38;2;87;105;247m", "light themes (dark text) get CC's darker blue-purple, via Map storage");

const accentScreen = new ClaudifyScreen(
	{ requestRender: () => {} } as any,
	theme,
	keybindings,
	() => {},
	undefined,
	undefined,
	pickerCandidates,
);
accentScreen.handleInput("enter");
assert.match(render(accentScreen), /Accent\s+claude/, "the Theme Section exposes the Accent row defaulting to claude");

// --- User-message box (docs/plans/2026-07-16-cc-user-message-box.md) ---------

const { applyUserMessageBox } = await import("../extensions/index.ts");

writeFileSync(settingsPath, JSON.stringify({ userMessageBox: "#123456" }));
clearSettingsCache();
const customBoxTruecolorTheme = {
	mode: "truecolor",
	bgColors: { userMessageBg: "\x1b[48;2;52;53;65m" },
	getFgAnsi: () => "\x1b[38;2;128;128;128m",
};
applyToolBackgroundMode(customBoxTruecolorTheme);
const customBoxTruecolor = applyUserMessageBox(["❯ custom"], "#123456", 80);
assert.match(customBoxTruecolor[0], /^\x1b\[48;2;18;52;86m/, "a custom user-message background is stored and rendered as a truecolor ANSI escape");
assert.doesNotMatch(customBoxTruecolor[0], /#123456/, "custom background hex never reaches rendered output");

const customBox256Theme = {
	mode: "256color",
	bgColors: { userMessageBg: "\x1b[48;5;236m" },
	getFgAnsi: () => "\x1b[38;5;244m",
};
applyToolBackgroundMode(customBox256Theme);
const customBox256 = applyUserMessageBox(["❯ custom"], "#123456", 80);
assert.match(customBox256[0], /^\x1b\[48;5;23m/, "a custom user-message background uses pi's rgbTo256 quantizer in 256-color mode");
assert.doesNotMatch(customBox256[0], /#123456/, "custom background hex never reaches 256-color output");
applyToolBackgroundMode(customBoxTruecolorTheme);

const boxedClaude = applyUserMessageBox(["❯ first line of the message", "  wrapped tail", ""], "claude", 80);
assert.equal(
	boxedClaude[0],
	"\x1b[48;2;58;58;58m\x1b[38;2;78;78;78m❯\x1b[39m\x1b[38;2;255;255;255m first line of the message \x1b[49m\x1b[39m",
	"claude mode paints the captured CC gray with a dim prefix and bright text",
);
assert.equal(
	boxedClaude[1],
	"\x1b[48;2;58;58;58m\x1b[38;2;255;255;255m  wrapped tail              \x1b[49m\x1b[39m",
	"continuation lines pad to the widest line + 1 so the block is a rectangle",
);
assert.equal(boxedClaude[2], "", "lines outside the content range stay untouched");
assert.equal(
	stripAnsi(boxedClaude[0]).length,
	stripAnsi(boxedClaude[1]).length,
	"every boxed line spans the same rectangle width",
);

const boxedTheme = applyUserMessageBox(["❯ hi"], "theme", 80);
assert.match(boxedTheme[0], /^\x1b\[48;2;\d+;\d+;\d+m/, "theme mode paints a truecolor background");
assert.ok(boxedTheme[0].endsWith("\x1b[49m\x1b[39m"), "the box resets background and foreground at the line end");
assert.doesNotMatch(boxedTheme[0], /38;2;255;255;255/, "theme mode leaves the text color to the theme");

const interior = applyUserMessageBox(["❯ para one", "", "  para two", ""], "claude", 80);
assert.match(interior[1], /^\x1b\[48;2;58;58;58m {11}\x1b\[49m/, "interior blank lines are painted so the rectangle is solid");
assert.equal(interior[3], "", "the trailing spacing line stays unpainted");

const clamped = applyUserMessageBox(["\u276f full-width line here"], "claude", 22);
assert.equal(
	stripAnsi(clamped[0]).length,
	22,
	"the +1 right padding clamps to the render width instead of overflowing (pi throws on overflow)",
);

console.log("claudify Hub and immediate-commit Section tests passed");
