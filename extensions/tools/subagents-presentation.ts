import type { Theme } from "@earendil-works/pi-coding-agent";

import { getTextContent } from "../domain/tool-arguments.ts";
import type { OpenAiStylePresenter } from "./openai-tool.ts";

/**
 * subagents-presentation.ts — Claude-like rows for pi-subagents tools.
 *
 * Follows the bash-tool.ts precedent: the theme owns the pixels, but reads a
 * documented contract instead of sniffing text. pi-subagents tool results
 * carry typed `details` (status enum, agent id, live activity); this module
 * renders the states the generic OpenAI presenter gets wrong and returns
 * `undefined` for everything else, so generic handling (errors, empty
 * results, expanded multi-line previews) stays single-sourced.
 *
 * Covered states (tool: Agent):
 * - background/running/queued launch → "Running in background (ID: …)".
 *   A completed tool call is not a completed agent; the old hardcoded
 *   "Done" read as one.
 * - partial → live `details.activity` (tool description, queue position),
 *   falling back to "Initializing…" when an older caller sends none.
 * - completed (collapsed) → first meaningful result line, skipping JSON
 *   husk (a serialized result opens with `{`). Expanded keeps the generic
 *   multi-line preview.
 *
 * Sibling tools (get_subagent_result, steer/stop/snooze/follow/message,
 * team_tasks, workflow_control) return single-line human sentences the
 * generic renderer already presents well — deliberately out of scope.
 */

export type SubagentLaunchStatus = "background" | "running" | "queued";

export interface SubagentResultDetails {
	status?: string;
	agentId?: string;
	activity?: string;
}

const LAUNCH_STATUSES: ReadonlySet<string> = new Set(["background", "running", "queued"]);

const HUSK = /^[\s\[{\]},:]*$/;

export interface SubagentsPresentationRuntime {
	makeText(last: unknown, text: string): any;
	withBranch(content: string, theme: Theme): string;
}

/** Launch states that must read as running, never "Done". */
export function subagentLaunchInfo(details: SubagentResultDetails | undefined): { id?: string } | undefined {
	if (!details || !LAUNCH_STATUSES.has(details.status ?? "")) return undefined;
	return { id: details.agentId };
}

/** First meaningful result line, skipping blank/JSON-punctuation lines. */
export function firstMeaningfulLine(text: string, maxChars = 160): string | undefined {
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line && !HUSK.test(line)) return line.slice(0, maxChars);
	}
	return undefined;
}

export function renderSubagentResult(
	runtime: SubagentsPresentationRuntime,
	name: string,
	result: any,
	expanded: boolean,
	isPartial: boolean,
	theme: Theme,
	ctx: any,
): string | undefined {
	if (name !== "Agent" || ctx.isError) return undefined;
	const details = (result as any)?.details as SubagentResultDetails | undefined;
	if (isPartial) {
		return runtime.makeText(
			ctx.lastComponent,
			runtime.withBranch(theme.fg("dim", details?.activity || "Initializing…"), theme),
		);
	 }
	const launch = subagentLaunchInfo(details);
	if (launch) {
		return runtime.makeText(
			ctx.lastComponent,
			runtime.withBranch(theme.fg("muted", `Running in background${launch.id ? ` (ID: ${launch.id})` : ""}`), theme),
		);
	}
	if (!expanded) {
		const line = firstMeaningfulLine(getTextContent(result).trim());
		if (line) return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("muted", line), theme));
	}
	return undefined;
}

/** Chain entry: dedicated presenter over a typed details contract. Returns
 * undefined for everything the generic fallback handles better. */
export const subagentsPresenter: OpenAiStylePresenter = {
	id: "subagents",
	renderResult: (runtime, name, result, expanded, isPartial, theme, ctx) =>
		renderSubagentResult(runtime, name, result, expanded, isPartial, theme, ctx),
};
