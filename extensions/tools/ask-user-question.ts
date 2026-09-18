import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Input, Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

import { AskUserQuestionRejection, clarificationResult, declinedResult, formatAnsweredResult, normalizeQuestions, type QuestionAnswers, type UserQuestion } from "../domain/questions.ts";
import { QuestionDialog, type QuestionDialogResult, type QuestionDialogState } from "../host/question-dialog.ts";
import { sanitizeToolContent } from "../terminal-sanitize.ts";

export interface AskUserQuestionDetails {
	questions: UserQuestion[];
	answers?: QuestionAnswers;
	declined?: boolean;
	annotations: Record<string, unknown>;
}

async function editExpandedAnswer(ctx: any, initial: string, signal?: AbortSignal): Promise<string | undefined> {
	let abortHandler: (() => void) | undefined;
	try {
		return await ctx.ui.custom((_tui: any, _theme: Theme, _keys: any, done: (value: string | undefined) => void) => {
			let settled = false;
			const finish = (value: string | undefined) => { if (!settled) { settled = true; done(value); } };
			const input = new Input({ prompt: "❯ ", placeholder: "Type your answer" });
			input.setValue(initial);
			input.handleInput("\x05"); // Ctrl+E: place the cursor after the prefilled answer.
			input.onSubmit = finish;
			input.onEscape = () => finish(undefined);
			if (signal?.aborted) queueMicrotask(() => finish(undefined));
			else {
				abortHandler = () => finish(undefined);
				signal?.addEventListener("abort", abortHandler, { once: true });
			}
			return input;
		});
	} finally {
		if (abortHandler) signal?.removeEventListener("abort", abortHandler);
	}
}

function settledLines(details: AskUserQuestionDetails | undefined, isError: boolean, theme: Theme): string {
	const questions = details?.questions ?? [];
	const dim = (text: string) => theme.fg("dim", text);
	const oneLine = (text: string) => sanitizeToolContent(text).replace(/\s*\r?\n\s*/g, " ");
	if (isError || details?.declined) {
		return [dim("⏺ User declined to answer questions"), ...questions.map((question, index) => dim(`${index === 0 ? "  ⎿ · " : "     · "}${oneLine(question.question)} (${question.options.map((option) => oneLine(option.label)).join(" / ")})`))].join("\n");
	}
	return [dim("⏺ User answered Pi Agent's questions:"), ...questions.map((question, index) => dim(`${index === 0 ? "  ⎿ · " : "     · "}${oneLine(question.question)} → ${oneLine(details?.answers?.[question.question] ?? "")}`))].join("\n");
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
			let result: QuestionDialogResult;
			let initialState: QuestionDialogState | undefined;
			while (true) {
				let abortHandler: (() => void) | undefined;
				try {
					result = await ctx.ui.custom((tui: any, theme: Theme, _keys: any, done: (result: QuestionDialogResult) => void) => {
						const dialog = new QuestionDialog(tui, theme, questions, done, {
							canUseExpandedEditor: true,
							initialState,
						});
						if (signal?.aborted) queueMicrotask(() => dialog.cancel());
						else {
							abortHandler = () => dialog.cancel();
							signal?.addEventListener("abort", abortHandler, { once: true });
						}
						return dialog;
					}) as QuestionDialogResult;
				} finally {
					if (abortHandler) signal?.removeEventListener("abort", abortHandler);
				}
				if (result.kind !== "edit") break;
				if (signal?.aborted) { result = { kind: "cancelled" }; break; }
				initialState = result.state;
				const edited = await editExpandedAnswer(ctx, initialState.inputs[result.questionIndex] ?? "", signal);
				if (signal?.aborted) { result = { kind: "cancelled" }; break; }
				if (typeof edited === "string") {
					const normalized = edited.replace(/[\r\n]+/g, " ").trim();
					const index = result.questionIndex;
					const question = questions[index];
					initialState.inputs[index] = normalized;
					initialState.customSelected[index] = normalized.length > 0;
					initialState.freeText = initialState.freeText.filter((entry) => entry !== question.question);
					if (normalized) initialState.freeText.push(question.question);
					initialState.editingOther = true;
				}
			}
			if (result.kind === "clarify") throw new AskUserQuestionRejection(clarificationResult(questions, result.answers), "clarify", questions, result.answers);
			if (result.kind !== "answered") throw new AskUserQuestionRejection(declinedResult(), "declined", questions);
			return {
				content: [{ type: "text", text: formatAnsweredResult(questions, result.answers, result.freeText) }],
				details: { questions, answers: result.answers, annotations: {} } satisfies AskUserQuestionDetails,
			};
		},
		renderCall() { return new Text("", 0, 0); },
		renderResult(result: any, options: any, theme: Theme, ctx: any) {
			const candidate = result?.details as AskUserQuestionDetails | undefined;
			const details = candidate && Array.isArray(candidate.questions) ? candidate : undefined;
			const isError = ctx?.isError === true || options?.isError === true;
			let fallbackQuestions: UserQuestion[] = [];
			if (!details) { try { fallbackQuestions = normalizeQuestions(ctx?.args?.questions); } catch { /* malformed call: render the host error without crashing */ } }
			const fallback = details ?? { questions: fallbackQuestions, declined: isError, annotations: {} };
			return new Text(settledLines(fallback, isError, theme), 0, 0);
		},
	});
}
