import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

import { declinedResult, formatAnsweredResult, normalizeQuestions, type QuestionAnswers, type UserQuestion } from "../domain/questions.ts";
import { QuestionDialog, type QuestionDialogResult } from "../host/question-dialog.ts";
import { sanitizeToolContent } from "../terminal-sanitize.ts";

export interface AskUserQuestionDetails {
	questions: UserQuestion[];
	answers?: QuestionAnswers;
	declined?: boolean;
	freeText?: string[];
}

function settledLines(details: AskUserQuestionDetails | undefined, isError: boolean, theme: Theme): string {
	const questions = details?.questions ?? [];
	const dim = (text: string) => theme.fg("dim", text);
	const oneLine = (text: string) => sanitizeToolContent(text).replace(/\s*\r?\n\s*/g, " ");
	if (isError || details?.declined) {
		return [dim("⏺ User declined to answer questions"), ...questions.map((question) => dim(`  ⎿  · ${oneLine(question.question)} (${question.options.map((option) => oneLine(option.label)).join(" / ")})`))].join("\n");
	}
	return [dim("⏺ User answered Claude's questions:"), ...questions.map((question) => dim(`  ⎿  · ${oneLine(question.question)} → ${oneLine(details?.answers?.[question.question] ?? "")}`))].join("\n");
}

export function registerAskUserQuestionTool(_pi: ExtensionAPI, register: (definition: any) => void): void {
	register({
		name: "AskUserQuestion",
		label: "AskUserQuestion",
		promptSnippet: "Ask the user structured single- or multi-select questions.",
		description: "Ask the user one to four structured questions. Use this when a decision requires user input. Each question needs 2-4 options; users may also type a custom answer.",
		promptGuidelines: ["Use AskUserQuestion when requirements are ambiguous and the answer materially affects implementation."],
		executionMode: "sequential",
		renderShell: "self",
		parameters: Type.Object({
			questions: Type.Array(Type.Object({
				question: Type.String(),
				header: Type.String(),
				multiSelect: Type.Boolean(),
				options: Type.Array(Type.Object({ label: Type.String(), description: Type.String() }), { minItems: 2, maxItems: 4 }),
			}), { minItems: 1, maxItems: 4 }),
		}),
		async execute(_id: string, params: any, signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
			const questions = normalizeQuestions(params.questions);
			if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") throw new Error("AskUserQuestion requires the interactive TUI.");
			let answeredQuestions = questions;
			let abortHandler: (() => void) | undefined;
			let result: QuestionDialogResult;
			try {
				result = await ctx.ui.custom((tui: any, theme: Theme, _keys: any, done: (result: QuestionDialogResult) => void) => {
					if (signal?.aborted) queueMicrotask(() => done({ kind: "cancelled" }));
					else {
						abortHandler = () => done({ kind: "cancelled" });
						signal?.addEventListener("abort", abortHandler, { once: true });
					}
					return new QuestionDialog(tui, theme, questions, done);
				}) as QuestionDialogResult;
			} finally {
				if (abortHandler) signal?.removeEventListener("abort", abortHandler);
			}
			if (result.kind === "chat") {
				const question = questions[result.questionIndex] ?? questions[0];
				answeredQuestions = [question];
				const answer = await ctx.ui.input("Chat about this", question.question);
				if (answer?.trim()) result = { kind: "answered", answers: { [question.question]: answer.trim() }, freeText: new Set([question.question]) };
				else result = { kind: "cancelled" };
			}
			if (result.kind !== "answered") throw new Error(declinedResult());
			return {
				content: [{ type: "text", text: formatAnsweredResult(answeredQuestions, result.answers, result.freeText) }],
				details: { questions: answeredQuestions, answers: result.answers, freeText: [...result.freeText] } satisfies AskUserQuestionDetails,
			};
		},
		renderCall() { return new Text("", 0, 0); },
		renderResult(result: any, options: any, theme: Theme, ctx: any) {
			const details = result?.details as AskUserQuestionDetails | undefined;
			let fallbackQuestions: UserQuestion[] = [];
			if (!details) { try { fallbackQuestions = normalizeQuestions(ctx?.args?.questions); } catch { /* malformed call: render the host error without crashing */ } }
			const fallback = details ?? { questions: fallbackQuestions, declined: options?.isError };
			return new Text(settledLines(fallback, !!options?.isError, theme), 0, 0);
		},
	});
}
