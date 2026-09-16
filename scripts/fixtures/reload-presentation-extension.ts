import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ToolExecutionComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

import claudify from "../../extensions/index.ts";

const RESTORED_EDIT_KEY = Symbol.for("pi-claudify:test-restored-edit-row");
const REQUEST_RENDER_KEY = Symbol.for("pi-claudify:test-restored-edit-request-render");

function restoredEditRow(cwd: string): ToolExecutionComponent {
	const shared = globalThis as Record<PropertyKey, unknown>;
	const existing = shared[RESTORED_EDIT_KEY];
	if (existing) return existing as ToolExecutionComponent;
	const row = new ToolExecutionComponent(
		"edit",
		"restored-edit",
		{ path: "reload-edit.ts", edits: [{ oldText: "const before = 1;", newText: "const after = 2;" }] },
		{ showImages: false },
		{
			name: "edit",
			description: "Restored external edit",
			parameters: {} as any,
			execute: async () => ({ content: [{ type: "text", text: "updated" }], details: {} }),
			renderCall: () => new Text("edit reload-edit.ts", 0, 0),
			renderResult: () => new Text("native restored edit result", 0, 0),
		} as any,
		{
			requestRender() {
				const request = shared[REQUEST_RENDER_KEY];
				if (typeof request === "function") request();
			},
			previousLines: [],
		} as any,
		cwd,
	);
	row.markExecutionStarted();
	row.setArgsComplete();
	row.updateResult({
		content: [{ type: "text", text: "Successfully replaced 1 block(s) in reload-edit.ts." }],
		details: { patch: "@@ -1,1 +1,1 @@\n-const before = 1;\n+const after = 2;\n" },
		isError: false,
	} as any, false);
	row.setExpanded(true);
	shared[RESTORED_EDIT_KEY] = row;
	return row;
}

export default function reloadPresentationFixture(pi: ExtensionAPI): void {
	// The row predates this presentation generation, just like restored history.
	const historicalEdit = restoredEditRow(process.cwd());
	claudify(pi);
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const statePath = process.env.PI_CLAUDIFY_RELOAD_STATE;
		let generation = 1;
		if (statePath && existsSync(statePath)) {
			try {
				const previous = JSON.parse(readFileSync(statePath, "utf8"));
				if (typeof previous?.generation === "number") generation = previous.generation + 1;
			} catch { /* retry from generation one */ }
		}
		if (statePath) writeFileSync(statePath, JSON.stringify({ generation }));
		const root = new Container();
		root.addChild(new Text(`RELOAD_PRESENTATION_GENERATION_${generation}`, 0, 0));
		root.addChild(historicalEdit);
		ctx.ui.setWidget("claudify-reload-presentation-fixture", (tui) => {
			(globalThis as Record<PropertyKey, unknown>)[REQUEST_RENDER_KEY] = () => tui.requestRender();
			return root;
		});
	});
}
