import type { Theme } from "@earendil-works/pi-coding-agent";

import { getStringArg } from "../domain/tool-arguments.ts";

import type { OpenAiStylePresenter, OpenAiSummarizeHelpers } from "./openai-tool.ts";

/**
 * Background-shell engine tool summaries (track-owned).
 *
 * Registered during activation; `openai-tool.ts` is never edited to add tool
 * families. The call summaries below moved verbatim out of the built-in
 * switch so that switch stays the fallback for unowned tools.
 */
function summarizeBgToolCall(name: string, args: any, theme: Theme, _helpers: OpenAiSummarizeHelpers): string | undefined {
	switch (name) {
		case "tmux":
		case "bg": {
			const action = getStringArg(args, "action") || "list";
			const target = getStringArg(args, "window") || "";
			return target ? `${action} ${target}` : action;
		}
		default:
			return undefined;
	}
}

export const bgToolPresenter: OpenAiStylePresenter = {
	id: "bg-tools",
	summarizeCall: summarizeBgToolCall,
};
