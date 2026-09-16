import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

import { applyPromptPointer, PromptEditor } from "../extensions/prompt-editor.ts";
import { clearSettingsCache, writeSettingsKey } from "../extensions/settings.ts";
import { useSandboxHome } from "./sandbox-home.ts";

useSandboxHome("cc-prompt");

function makeEditor(): PromptEditor {
	const tui = { terminal: { rows: 40 } } as never;
	const theme = { borderColor: (text: string) => `\x1b[38;5;244m${text}\x1b[0m` } as never;
	const keybindings = { matches: () => false } as never;
	return new PromptEditor(tui, theme, keybindings);
}

const stripTerminalSequences = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

const editor = makeEditor();
const workingStatusEditor = editor as PromptEditor & { embedWorkingStatus?: boolean };
if ("embedWorkingStatus" in workingStatusEditor) {
	assert.equal(workingStatusEditor.embedWorkingStatus, false, "working status defaults above the input like Claude Code");
	writeSettingsKey("spinnerPlacement", "input");
	clearSettingsCache();
	const inputStatusEditor = makeEditor() as PromptEditor & { embedWorkingStatus?: boolean };
	assert.equal(inputStatusEditor.embedWorkingStatus, true, "input placement preserves Pi's embedded working status");
	writeSettingsKey("spinnerPlacement", "above");
	clearSettingsCache();
} else {
	assert.equal(workingStatusEditor.embedWorkingStatus, undefined, "Pi 0.74/0.80 keep their stock standalone working row");
}
editor.setText("hello");
let renderedRows = editor.render(80);
assert.ok(renderedRows[1]?.startsWith("❯ "), "the pointer uses ordinary foreground rather than the border tint");
let rows = renderedRows.map(stripTerminalSequences);
assert.match(rows[0] ?? "", /^─+$/, "top border remains native");
assert.match(rows[1] ?? "", /^❯ hello/, "first content row receives the pointer");
assert.match(rows.at(-1) ?? "", /^─+$/, "bottom border remains native");
for (const row of rows) assert.ok(visibleWidth(row) <= 80);

editor.setPaddingX(0);
editor.setText("world");
rows = editor.render(60).map(stripTerminalSequences);
assert.match(rows[1] ?? "", /^❯ world/, "host padding copy cannot erase the pointer column");

editor.setText("!echo hello");
rows = editor.render(60).map(stripTerminalSequences);
assert.match(rows[1] ?? "", /^  !echo hello/, "shell input keeps Pi's native ! prompt without the normal pointer");
assert.doesNotMatch(rows[1] ?? "", /❯/, "the normal prompt pointer is suppressed in shell mode");

let currentFactory: any;
const notices: string[] = [];
const ui = {
	getEditorComponent: () => currentFactory,
	setEditorComponent: (factory: any) => { currentFactory = factory; },
	notify: (message: string) => { notices.push(message); },
};
const ctx = { mode: "tui", hasUI: true, ui };
applyPromptPointer(ctx);
assert.equal(typeof currentFactory, "function", "Claude-style prompt pointer defaults on");
const ownedFactory = currentFactory;
applyPromptPointer(ctx);
assert.equal(currentFactory, ownedFactory, "re-applying is idempotent");
writeSettingsKey("spinnerPlacement", "input");
clearSettingsCache();
applyPromptPointer(ctx, true);
assert.notEqual(currentFactory, ownedFactory, "changing spinner placement reinstalls Claudify's owned editor factory");
writeSettingsKey("spinnerPlacement", "above");
clearSettingsCache();

writeSettingsKey("promptPointer", false);
clearSettingsCache();
applyPromptPointer(ctx);
assert.equal(currentFactory, undefined, "disabling restores the default when claudify owns the editor");

writeSettingsKey("promptPointer", true);
clearSettingsCache();
applyPromptPointer({ hasUI: true, ui });
assert.equal(typeof currentFactory, "function", "Pi 0.74-shaped TUI context without mode still installs the default-on pointer");
applyPromptPointer({ hasUI: false, ui });
assert.equal(typeof currentFactory, "function", "headless context cannot change editor ownership");
currentFactory = undefined;

const foreignFactory = () => ({ render: () => [] });
currentFactory = foreignFactory;
writeSettingsKey("promptPointer", true);
clearSettingsCache();
applyPromptPointer(ctx);
assert.equal(currentFactory, foreignFactory, "another extension's editor is never replaced");
assert.match(notices.at(-1) ?? "", /another extension owns the editor/);

console.log("prompt editor tests passed");
