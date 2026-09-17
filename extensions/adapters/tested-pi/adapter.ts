import { RuntimeHandle } from "../../runtime/runtime-handle.ts";

/**
 * Transitional Tier-2 boundary. Existing compatibility wiring remains in the
 * composition root while it is migrated behind focused ports. Keeping the
 * transition explicit prevents imports from installing host patches by
 * accident and gives every generation one authority handle.
 */
export function activateTestedPiRuntime(runtime: RuntimeHandle, install: () => void): void {
	if (!runtime.isCurrent()) return;
	install();
	runtime.activate();
}
