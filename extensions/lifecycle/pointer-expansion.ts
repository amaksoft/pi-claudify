import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { clearPointerExpandedMembers, handlePointerExpansionInput, releasePointerExpansionOwner } from "../expansion-coordinator.ts";

export interface PointerExpansionLifecycleOptions {
	isCurrent?(): boolean;
	shouldWarnRestart(): boolean;
	warning: string;
}

export function registerPointerExpansionLifecycle(pi: ExtensionAPI, owner: object, options: PointerExpansionLifecycleOptions): void {
	let removeInput: (() => void) | undefined;
	let deferredInstall: ReturnType<typeof setTimeout> | undefined;
	let activeUi: any;
	let warningShown = false;
	const current = () => options.isCurrent?.() !== false;
	const installInput = (ctx: any): void => {
		if (!current()) return;
		activeUi = ctx.ui;
		try { removeInput?.(); } catch { /* stale host listener */ }
		removeInput = typeof ctx.ui?.onTerminalInput === "function"
			? ctx.ui.onTerminalInput((data: string) => {
				if (!current()) return undefined;
				const result = handlePointerExpansionInput(data, owner) ?? handlePointerExpansionInput(data);
				if (result) {
					const ui = activeUi;
					if (ui?.getToolsExpanded?.() === false && typeof ui.setToolsExpanded === "function") {
						ui.setToolsExpanded(true);
						ui.setToolsExpanded(false);
					}
				}
				return result;
			})
			: undefined;
	};
	const installAfterHostReset = (ctx: any): void => {
		if (deferredInstall) clearTimeout(deferredInstall);
		deferredInstall = setTimeout(() => {
			deferredInstall = undefined;
			installInput(ctx);
		}, 100);
		(deferredInstall as any).unref?.();
	};
	pi.on("session_start", async (_event, ctx) => {
		if (!current()) return;
		clearPointerExpandedMembers(owner);
		if (options.shouldWarnRestart() && !warningShown && ctx.hasUI) {
			warningShown = true;
			ctx.ui.notify(options.warning, "warning");
		}
		installInput(ctx);
		installAfterHostReset(ctx);
	});
	pi.on("resources_discover", async (_event, ctx) => { installInput(ctx); installAfterHostReset(ctx); });
	pi.on("session_shutdown", async (event) => {
		if (deferredInstall) clearTimeout(deferredInstall);
		deferredInstall = undefined;
		try { removeInput?.(); } catch { /* host is already closing */ }
		removeInput = undefined;
		activeUi = undefined;
		clearPointerExpandedMembers(owner);
		if (event.reason === "reload" || event.reason === "quit") releasePointerExpansionOwner(owner);
	});
	pi.on("session_compact", async () => { if (current()) clearPointerExpandedMembers(owner); });
	pi.on("session_tree", async () => { if (current()) clearPointerExpandedMembers(owner); });
}
