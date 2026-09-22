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
	if (plan.host.selectionReason === "unrecognized-host") {
		let warned = false;
		pi.on("session_start", async (_event, ctx) => {
			if (warned || !ctx?.hasUI || typeof ctx.ui?.notify !== "function") return;
			warned = true;
			ctx.ui.notify(
				`Claudify visual mode is disabled for unrecognized Pi ${plan.host.piVersion ?? "version"}: required compatibility probes did not pass. Running the portable profile; update Claudify or use PI_CLAUDIFY_PROFILE=tested-pi only after validation.`,
				"warning",
			);
		});
	}
	runtime.activate();
}
