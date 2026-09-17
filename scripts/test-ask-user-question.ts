import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../extensions/domain/render-text.ts";

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESCAPE = "\x1b";

import { declinedResult, formatAnsweredResult, normalizeQuestions } from "../extensions/domain/questions.ts";
import { QuestionDialog, type QuestionDialogResult } from "../extensions/host/question-dialog.ts";
import { registerAskUserQuestionTool } from "../extensions/tools/ask-user-question.ts";

const questions = normalizeQuestions([{ question: "Which language?", header: "Language", multiSelect: false, options: [{ label: "Python", description: "For scripting" }, { label: "TypeScript", description: "For typed web apps" }] }]);
assert.throws(() => normalizeQuestions([]), /between 1 and 4/);
assert.throws(() => normalizeQuestions([{ question: "Q", header: "H", options: [{ label: "one" }] }]), /between 2 and 4/);
assert.equal(formatAnsweredResult(questions, { "Which language?": "Python" }, new Set()), 'Your questions have been answered: "Which language?"="Python". You can now continue with these answers in mind.');
assert.match(declinedResult(), /STOP what you are doing/);

const tui = { requestRender() {} } as any;
const theme = { fg: (_key: string, value: string) => value } as any;
let completed: QuestionDialogResult | undefined;
const dialog = new QuestionDialog(tui, theme, questions, (result) => { completed = result; });
assert.match(stripAnsi(dialog.render(80).join("\n")), /☐ Language/);
assert.match(stripAnsi(dialog.render(80).join("\n")), /❯ 1\. Python/);
for (const width of [20, 30]) {
	for (const line of dialog.render(width)) assert.ok(visibleWidth(line) <= width, `single-question row fits width ${width}`);
}
const longHeader = normalizeQuestions([{ ...questions[0], header: "A deliberately very long question header that must be fitted" }]);
const longHeaderDialog = new QuestionDialog(tui, theme, longHeader, () => {});
for (const line of longHeaderDialog.render(30)) assert.ok(visibleWidth(line) <= 30, "long header and footer never overflow the TUI width contract");
dialog.handleInput(DOWN);
dialog.handleInput(ENTER);
assert.match(stripAnsi(dialog.render(80).join("\n")), /Review your answers/);
dialog.handleInput(ENTER);
assert.equal(completed?.kind, "answered");
if (completed?.kind === "answered") assert.equal(completed.answers["Which language?"], "TypeScript");

let freeResult: QuestionDialogResult | undefined;
const freeDialog = new QuestionDialog(tui, theme, questions, (result) => { freeResult = result; });
freeDialog.handleInput(DOWN);
freeDialog.handleInput(DOWN);
freeDialog.handleInput("Zig");
freeDialog.handleInput(ENTER);
freeDialog.handleInput(ENTER);
assert.equal(freeResult?.kind, "answered");
if (freeResult?.kind === "answered") {
	assert.equal(freeResult.answers["Which language?"], "Zig");
	assert.equal(freeResult.freeText.has("Which language?"), true);
}

let cancelled: QuestionDialogResult | undefined;
new QuestionDialog(tui, theme, questions, (result) => { cancelled = result; }).handleInput(ESCAPE);
assert.deepEqual(cancelled, { kind: "cancelled" });

const twoQuestions = normalizeQuestions([
	...questions,
	{ question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "" }, { label: "Blue", description: "" }] },
]);
let incomplete: QuestionDialogResult | undefined;
const incompleteDialog = new QuestionDialog(tui, theme, twoQuestions, (result) => { incomplete = result; });
incompleteDialog.handleInput("\x1b[C");
incompleteDialog.handleInput("\x1b[C");
incompleteDialog.handleInput(ENTER);
assert.equal(incomplete, undefined, "submitting an incomplete review does not report a decline");
assert.match(stripAnsi(incompleteDialog.render(80).join("\n")), /Which language\?/, "incomplete review returns to the first unanswered question");

const pasteDialog = new QuestionDialog(tui, theme, questions, () => {});
pasteDialog.handleInput(DOWN);
pasteDialog.handleInput(DOWN);
pasteDialog.handleInput("\x1b[200~Golang\x1b[201~");
assert.match(stripAnsi(pasteDialog.render(80).join("\n")), /Golang/, "bracketed terminal paste populates free text");
assert.doesNotMatch(stripAnsi(pasteDialog.render(80).join("\n")), /ctrl\+g/, "the dialog does not advertise an unsupported external-editor key");

let chatResult: QuestionDialogResult | undefined;
const chatDialog = new QuestionDialog(tui, theme, twoQuestions, (result) => { chatResult = result; });
chatDialog.handleInput("\x1b[C");
chatDialog.handleInput(DOWN);
chatDialog.handleInput(DOWN);
chatDialog.handleInput(DOWN);
chatDialog.handleInput(ENTER);
assert.deepEqual(chatResult, { kind: "chat", questionIndex: 1 }, "Chat about this retains the active question tab");

const definitions = new Map<string, any>();
registerAskUserQuestionTool({} as any, (definition) => definitions.set(definition.name, definition));
const tool = definitions.get("AskUserQuestion");
assert.ok(tool);
const sharedRunController = new AbortController();
const result = await tool.execute("id", { questions }, sharedRunController.signal, undefined, {
	mode: "tui", hasUI: true,
	ui: {
		custom(factory: any) {
			return new Promise((resolve) => {
				const component = factory(tui, theme, {}, resolve);
				component.handleInput(ENTER);
				component.handleInput(ENTER);
			});
		},
	},
});
assert.match(result.content[0].text, /Your questions have been answered/);
assert.equal(result.details.answers["Which language?"], "Python");
assert.equal(getEventListeners(sharedRunController.signal, "abort").length, 0, "normal answers remove the call-scoped abort listener from the shared run signal");
await assert.rejects(() => tool.execute("id", { questions }, undefined, undefined, { mode: "print", hasUI: false, ui: {} }), /interactive TUI/);

const chatToolResult = await tool.execute("id", { questions }, undefined, undefined, {
	mode: "tui", hasUI: true,
	ui: { custom: async () => ({ kind: "chat", questionIndex: 0 }), input: async () => "Please explain the tradeoff" },
});
assert.match(chatToolResult.content[0].text, /Please explain the tradeoff/, "tool-level Chat about this routes through ctx.ui.input");

const abortController = new AbortController();
abortController.abort();
await assert.rejects(() => tool.execute("id", { questions }, abortController.signal, undefined, {
	mode: "tui", hasUI: true,
	ui: { custom: (factory: any) => new Promise((resolve) => factory(tui, theme, {}, resolve)) },
}), /doesn't want to proceed/, "aborted interactive questions reject as a declined tool use");

const multiQuestions = normalizeQuestions([{ question: "Select toppings", header: "Toppings", multiSelect: true, options: [{ label: "Cheese", description: "" }, { label: "Pepperoni", description: "" }] }]);
let multiResult: QuestionDialogResult | undefined;
const multiDialog = new QuestionDialog(tui, theme, multiQuestions, (value) => { multiResult = value; });
multiDialog.handleInput(" ");
multiDialog.handleInput(DOWN);
multiDialog.handleInput(" ");
multiDialog.handleInput(ENTER);
multiDialog.handleInput(ENTER);
assert.equal(multiResult?.kind, "answered");
if (multiResult?.kind === "answered") assert.equal(multiResult.answers["Select toppings"], "Cheese, Pepperoni");

let reviewCancelled: QuestionDialogResult | undefined;
const cancelReview = new QuestionDialog(tui, theme, questions, (value) => { reviewCancelled = value; });
cancelReview.handleInput(ENTER);
cancelReview.handleInput(DOWN);
cancelReview.handleInput(ENTER);
assert.deepEqual(reviewCancelled, { kind: "cancelled" }, "review Cancel is distinct from submission");

const renderedAnswer = tool.renderResult(result, { isError: false }, theme, { args: { questions } }).render(100).join("\n");
assert.match(stripAnsi(renderedAnswer), /User answered Claude's questions/);
const renderedDecline = tool.renderResult({ content: [] }, { isError: true }, theme, { args: { questions } }).render(100).join("\n");
assert.match(stripAnsi(renderedDecline), /User declined to answer questions/);

console.log("AskUserQuestion domain, interaction, and tool tests passed");
