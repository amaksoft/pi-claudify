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
editor.setText("hello");
let rows = editor.render(80).map(stripTerminalSequences);
assert.match(rows[0] ?? "", /^─+$/, "top border remains native");
assert.match(rows[1] ?? "", /^❯ hello/, "first content row receives the pointer");
assert.match(rows.at(-1) ?? "", /^─+$/, "bottom border remains native");
for (const row of rows) assert.ok(visibleWidth(row) <= 80);

editor.setPaddingX(0);
editor.setText("world");
rows = editor.render(60).map(stripTerminalSequences);
assert.match(rows[1] ?? "", /^❯ world/, "host padding copy cannot erase the pointer column");

let currentFactory: any;
const notices: string[] = [];
const ui = {
	getEditorComponent: () => currentFactory,
	setEditorComponent: (factory: any) => { currentFactory = factory; },
	notify: (message: string) => { notices.push(message); },
};
const ctx = { mode: "tui", ui };
applyPromptPointer(ctx);
assert.equal(typeof currentFactory, "function", "Claude-style prompt pointer defaults on");
const ownedFactory = currentFactory;
applyPromptPointer(ctx);
assert.equal(currentFactory, ownedFactory, "re-applying is idempotent");

writeSettingsKey("promptPointer", false);
clearSettingsCache();
applyPromptPointer(ctx);
assert.equal(currentFactory, undefined, "disabling restores the default when claudify owns the editor");

const foreignFactory = () => ({ render: () => [] });
currentFactory = foreignFactory;
writeSettingsKey("promptPointer", true);
clearSettingsCache();
applyPromptPointer(ctx);
assert.equal(currentFactory, foreignFactory, "another extension's editor is never replaced");
assert.match(notices.at(-1) ?? "", /another extension owns the editor/);

console.log("prompt editor tests passed");
