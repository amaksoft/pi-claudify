import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { clearPointerExpandedMembers, handlePointerExpansionInput, releasePointerExpansionOwner } from "../expansion-coordinator.ts";

export interface PointerExpansionLifecycleOptions {
	shouldWarnRestart(): boolean;
	warning: string;
}

export function registerPointerExpansionLifecycle(pi: ExtensionAPI, owner: object, options: PointerExpansionLifecycleOptions): void {
	let removeInput: (() => void) | undefined;
	let warningShown = false;
	pi.on("session_start", async (_event, ctx) => {
		clearPointerExpandedMembers(owner);
		if (options.shouldWarnRestart() && !warningShown && ctx.hasUI) {
			warningShown = true;
			ctx.ui.notify(options.warning, "warning");
		}
		try { removeInput?.(); } catch { /* stale host listener */ }
		removeInput = typeof ctx.ui?.onTerminalInput === "function"
			? ctx.ui.onTerminalInput((data) => {
				const result = handlePointerExpansionInput(data, owner);
				if (result) {
					const ui = ctx.ui as any;
					if (ui.getToolsExpanded?.() === false && typeof ui.setToolsExpanded === "function") {
						ui.setToolsExpanded(true);
						ui.setToolsExpanded(false);
					}
				}
				return result;
			})
			: undefined;
	});
	pi.on("session_shutdown", async () => {
		try { removeInput?.(); } catch { /* host is already closing */ }
		removeInput = undefined;
		releasePointerExpansionOwner(owner);
	});
	pi.on("session_compact", async () => { clearPointerExpandedMembers(owner); });
	pi.on("session_tree", async () => { clearPointerExpandedMembers(owner); });
}
