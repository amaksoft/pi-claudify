import assert from "node:assert/strict";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { useSandboxHome } from "./sandbox-home.ts";

useSandboxHome("cc-presentation-refresh");
initTheme("dark");

const externalEdit = {
	name: "edit",
	description: "External edit",
	parameters: {},
	execute: async () => ({ content: [{ type: "text", text: "updated" }], details: {} }),
	renderCall: () => new Text("EXTERNAL_EDIT_CALL", 0, 0),
	renderResult: () => new Text("EXTERNAL_EDIT_RESULT", 0, 0),
	sourceInfo: { path: "/third-party/edit.ts", source: "extension:third-party" },
};
const row = new ToolExecutionComponent(
	"edit",
	"restored-before-adapters",
	{ path: "old.ts", edits: [{ oldText: "old", newText: "new" }] },
	{ showImages: false },
	externalEdit as any,
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
row.markExecutionStarted();
row.setArgsComplete();
row.updateResult({
	content: [{ type: "text", text: "updated" }],
	details: { patch: "@@ -1,1 +1,1 @@\n-old\n+new\n" },
	isError: false,
} as any, false);
assert.match(row.render(100).join("\n"), /EXTERNAL_EDIT_CALL/, "restored row initially owns its native presentation");

const { default: extension } = await import("../extensions/index.ts");
class FakePi {
	tools = new Map<string, any>([["edit", externalEdit]]);
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void { this.tools.set(definition.name, definition); }
	registerCommand(): void {}
	on(name: string, handler: (...args: any[]) => any): void { this.events.set(name, [...(this.events.get(name) ?? []), handler]); }
	getThinkingLevel(): string { return "off"; }
	getAllTools(): any[] { return [...this.tools.values()]; }
	async emit(name: string, event: any = {}, ctx: any = { ui: {} }): Promise<void> {
		for (const handler of this.events.get(name) ?? []) await handler(event, ctx);
	}
}
const oldPi = new FakePi();
extension(oldPi as any);
const pi = new FakePi();
extension(pi as any);
// Some hosts overlap generations while reloading: the old shutdown can arrive
// after the replacement generation has installed its delegates.
await oldPi.emit("session_shutdown");
assert.equal(pi.tools.get("edit"), externalEdit, "external execution ownership is preserved");
const refreshed = row.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
if (typeof (row as any).handleMouse === "function") {
	assert.match(refreshed, /Update\(/, "a pre-existing row refreshes after compatible presentation adapters install");
	assert.doesNotMatch(refreshed, /EXTERNAL_EDIT_/, "stale native child components are replaced lazily on repaint");
} else {
	assert.match(refreshed, /Update\(|EXTERNAL_EDIT_CALL/, "older hosts either refresh compatible presentation or safely retain the external native renderer");
}

console.log("presentation refresh tests passed");
