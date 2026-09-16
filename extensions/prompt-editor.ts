import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

import { settingsFeatureEnabled } from "./domain/compatibility.ts";
import { readSettings } from "./settings.ts";

const PROMPT_COLUMNS = 2;
// Pi 0.85 can move the stock working status into the editor border. Claude keeps
// it on a standalone row above the box, which is the default; `input` preserves
// Pi's native placement. Older supported hosts ignore the extra option.
function promptEditorOptions(): { paddingX: number; embedWorkingStatus: boolean } {
	return {
		paddingX: PROMPT_COLUMNS,
		embedWorkingStatus: readSettings().values.spinnerPlacement === "input",
	};
}
const installedFactories = new WeakMap<object, (...args: any[]) => PromptEditor>();

export class PromptEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, promptEditorOptions());
	}

	override setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(padding, PROMPT_COLUMNS));
	}

	override render(width: number): string[] {
		const rows = super.render(width);
		const first = rows[1];
		if (!this.getText().startsWith("!") && first !== undefined && first.startsWith("  ")) {
			// The prompt is ordinary foreground in Claude Code; only the rules use
			// the editor border tint. Shell input keeps Pi's native ! presentation.
			rows[1] = `❯ ${first.slice(PROMPT_COLUMNS)}`;
		}
		return rows;
	}
}

/** Apply the setting live without stealing an editor owned by another extension. */
export function applyPromptPointer(ctx: any, forceReinstall = false): void {
	const mode = ctx?.mode;
	if (!ctx?.hasUI || (mode !== undefined && mode !== "tui") || typeof ctx.ui?.setEditorComponent !== "function") return;
	const ui = ctx.ui as object;
	const installed = installedFactories.get(ui);
	const current = typeof ctx.ui.getEditorComponent === "function" ? ctx.ui.getEditorComponent() : undefined;
	const settings = readSettings().values;
	const enabled = settings.promptPointer !== false && settingsFeatureEnabled(settings, "promptPointer");
	if (!enabled) {
		if (installed && current === installed) ctx.ui.setEditorComponent(undefined);
		installedFactories.delete(ui);
		return;
	}
	if (current && current !== installed) {
		ctx.ui.notify?.("Claudify prompt pointer not installed: another extension owns the editor", "warning");
		return;
	}
	if (installed && forceReinstall) {
		if (current === installed) ctx.ui.setEditorComponent(undefined);
		installedFactories.delete(ui);
	} else if (installed) return;
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
