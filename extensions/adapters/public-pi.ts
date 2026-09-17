import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { CompatibilityConfig } from "../domain/compatibility.ts";
import type { ActivationPlan } from "../runtime/contracts.ts";
import { RuntimeHandle } from "../runtime/runtime-handle.ts";
import { AdditiveToolsController, registerPortableAdditiveLifecycle } from "./additive-tools.ts";

/**
 * Portable emergency profile. It deliberately installs no private host patch
 * and no feature whose complete public implementation has not been extracted
 * yet. Public features are migrated here one at a time behind conformance
 * tests; until then native Pi remains untouched.
 */
export function activatePortablePi(
	pi: ExtensionAPI,
	runtime: RuntimeHandle,
	plan: ActivationPlan,
	compatibility: CompatibilityConfig | undefined,
	onDiagnostic?: (key: string, error: unknown) => void,
): void {
	const additive = new AdditiveToolsController(pi, runtime, plan, {
		cwd: process.cwd(),
		compatibility,
		onDiagnostic,
	});
	registerPortableAdditiveLifecycle(pi, runtime, additive);
	runtime.activate();
}
