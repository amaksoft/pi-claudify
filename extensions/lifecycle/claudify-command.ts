import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ClaudifyScreen } from "../claudify-screen.ts";

export interface ClaudifyCommandRuntime {
	diffThemes: readonly string[];
	colorKeys: readonly string[];
	onSettingChange(key: string, ctx: any, requestRender: () => void): void;
	onSettingPreview(key: string, value: unknown, ctx: any, requestRender: () => void): void;
}

export function registerClaudifyCommand(pi: ExtensionAPI, runtime: ClaudifyCommandRuntime): void {
	pi.registerCommand("claudify", {
		description: "Open the Claudify settings screen",
		async handler(_args, ctx) {
			const mode = (ctx as any).mode;
			if ((mode !== undefined && mode !== "tui") || !ctx.hasUI) {
				ctx.ui.notify("/claudify needs the interactive TUI", "info");
				return;
			}
			await ctx.ui.custom<void>(
				(tui, theme, keybindings, done) => new ClaudifyScreen(
					tui,
					theme,
					keybindings,
					() => done(undefined),
					(key) => runtime.onSettingChange(key, ctx, () => tui.requestRender()),
					(key, value) => runtime.onSettingPreview(key, value, ctx, () => tui.requestRender()),
					{ diffThemes: runtime.diffThemes, colorKeys: runtime.colorKeys },
					(message, type) => ctx.ui.notify(message, type),
				),
			);
		},
	});
}
