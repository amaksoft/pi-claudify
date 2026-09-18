import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	ASK_USER_QUESTION_TOOL_NAME,
	CRON_COMPATIBILITY_TOOL_NAMES,
	resolveCompatibilityToolEnabled,
	type CompatibilityConfig,
} from "../domain/compatibility.ts";
import { ToolRegistrationCoordinator } from "../host/tool-registration.ts";
import type { ActivationPlan } from "../runtime/contracts.ts";
import { RuntimeHandle } from "../runtime/runtime-handle.ts";
import { registerAskUserQuestionTool } from "../tools/ask-user-question.ts";
import { CronScheduler, installCronLifecycle, registerCronTools } from "../tools/cron-tools.ts";

export interface AdditiveToolsOptions {
	cwd: string;
	compatibility: CompatibilityConfig | undefined;
	onDiagnostic?: (key: string, error: unknown) => void;
}

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

/** Collision-safe registration for tools whose execution Claudify owns. */
export class AdditiveToolsController {
	private askQueued = false;
	private readonly registration: ToolRegistrationCoordinator<RegisteredTool>;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly runtime: RuntimeHandle,
		private readonly plan: ActivationPlan,
		private readonly options: AdditiveToolsOptions,
	) {
		const disabled = new Set<string>();
		if (!plan.featureEnabled("scheduledTasks")) for (const name of CRON_COMPATIBILITY_TOOL_NAMES) disabled.add(name);
		if (!plan.featureEnabled("askUserQuestion")) disabled.add(ASK_USER_QUESTION_TOOL_NAME);
		for (const name of [...CRON_COMPATIBILITY_TOOL_NAMES, ASK_USER_QUESTION_TOOL_NAME]) {
			if (!resolveCompatibilityToolEnabled(options.compatibility, name)) disabled.add(name);
		}
		this.registration = new ToolRegistrationCoordinator<RegisteredTool>(
			{
				registerTool: (definition) => pi.registerTool(definition),
				getAllTools: () => (pi as any).getAllTools?.(),
			},
			{ skipped: disabled, replaceBuiltin: false, onDiagnostic: options.onDiagnostic },
		);
		if (plan.featureEnabled("scheduledTasks") && typeof (pi as any).sendUserMessage === "function") {
			const scheduler = new CronScheduler({
				cwd: options.cwd,
				sendUserMessage: (prompt) => (pi as any).sendUserMessage(prompt),
				onError: (error) => options.onDiagnostic?.("cron-scheduler", error),
			});
			registerCronTools(pi, scheduler, (definition) => this.registration.add(definition));
			installCronLifecycle(pi, scheduler);
		}
	}

	presentationAdapters() {
		return this.registration.presentationAdapters();
	}

	installDeferred(ctx?: any): void {
		if (!this.runtime.isCurrent()) return;
		this.registration.installDeferred(
			ctx?.hasUI ? (message, kind) => ctx.ui?.notify?.(message, kind) : undefined,
		);
	}

	registerAskForContext(ctx: any): boolean {
		if (
			!this.runtime.isCurrent()
			|| this.askQueued
			|| !this.plan.featureEnabled("askUserQuestion")
			|| ctx?.mode !== "tui"
			|| !ctx?.hasUI
			|| typeof ctx.ui?.custom !== "function"
		) return false;
		this.askQueued = true;
		registerAskUserQuestionTool(this.pi, (definition) => this.registration.add(definition));
		return true;
	}
}

export function registerPortableAdditiveLifecycle(pi: ExtensionAPI, runtime: RuntimeHandle, controller: AdditiveToolsController): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!runtime.isCurrent()) return;
		controller.registerAskForContext(ctx);
		controller.installDeferred(ctx);
	});
	pi.on("before_agent_start", async (_event, ctx) => controller.installDeferred(ctx));
	pi.on("session_shutdown", async (event) => {
		runtime.beginRetirement(event.reason);
		await runtime.dispose();
	});
}
