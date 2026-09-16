import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

import { readSettings } from "./settings.ts";

const PROMPT_COLUMNS = 2;
const installedFactories = new WeakMap<object, (...args: any[]) => PromptEditor>();

export class PromptEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { paddingX: PROMPT_COLUMNS });
	}

	override setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(padding, PROMPT_COLUMNS));
	}

	override render(width: number): string[] {
		const rows = super.render(width);
		const first = rows[1];
		if (first !== undefined && first.startsWith("  ")) {
			rows[1] = `${this.borderColor("❯")} ${first.slice(PROMPT_COLUMNS)}`;
		}
		return rows;
	}
}

/** Apply the setting live without stealing an editor owned by another extension. */
export function applyPromptPointer(ctx: any): void {
	if (ctx?.mode !== "tui" || typeof ctx.ui?.setEditorComponent !== "function") return;
	const ui = ctx.ui as object;
	const installed = installedFactories.get(ui);
	const current = typeof ctx.ui.getEditorComponent === "function" ? ctx.ui.getEditorComponent() : undefined;
	const enabled = readSettings().values.promptPointer !== false;
	if (!enabled) {
		if (installed && current === installed) ctx.ui.setEditorComponent(undefined);
		installedFactories.delete(ui);
		return;
	}
	if (current && current !== installed) {
		ctx.ui.notify?.("Claudify prompt pointer not installed: another extension owns the editor", "warning");
		return;
	}
	if (installed) return;
	const factory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => new PromptEditor(tui, theme, keybindings);
	installedFactories.set(ui, factory);
	ctx.ui.setEditorComponent(factory);
}

export function registerPromptPointer(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => applyPromptPointer(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		const ui = ctx.ui as object;
		const installed = installedFactories.get(ui);
		const current = typeof ctx.ui?.getEditorComponent === "function" ? ctx.ui.getEditorComponent() : undefined;
		if (installed && current === installed) ctx.ui.setEditorComponent(undefined);
		installedFactories.delete(ui);
	});
}
