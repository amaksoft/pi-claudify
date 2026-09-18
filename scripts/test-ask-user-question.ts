import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../extensions/domain/render-text.ts";

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESCAPE = "\x1b";

import { AskUserQuestionRejection, clarificationResult, declinedResult, formatAnsweredResult, normalizeQuestions } from "../extensions/domain/questions.ts";
import { QuestionDialog, type QuestionDialogResult } from "../extensions/host/question-dialog.ts";
import { registerAskUserQuestionTool } from "../extensions/tools/ask-user-question.ts";

const questions = normalizeQuestions([{ question: "Which language?", header: "Language", multiSelect: false, options: [{ label: "Python", description: "For scripting" }, { label: "TypeScript", description: "For typed web apps" }] }]);
const multiQuestions = normalizeQuestions([{ question: "Select toppings", header: "Toppings", multiSelect: true, options: [{ label: "Cheese", description: "" }, { label: "Pepperoni", description: "" }] }]);
assert.throws(() => normalizeQuestions([]), /between 1 and 4/);
assert.throws(() => normalizeQuestions([{ question: "Q", header: "H", options: [{ label: "one" }] }]), /between 2 and 4/);
assert.throws(() => normalizeQuestions([{ question: "Q", header: "One", multiSelect: false, options: [{ label: "A", description: "" }, { label: "B", description: "" }] }, { question: "Q", header: "Two", multiSelect: false, options: [{ label: "A", description: "" }, { label: "B", description: "" }] }]), /duplicates an earlier question/);
assert.throws(() => normalizeQuestions([{ question: "Q", header: "H", multiSelect: false, options: [{ label: "A", description: "" }, { label: "A", description: "" }] }]), /duplicate option label/);
assert.equal(formatAnsweredResult(questions, { "Which language?": "Python" }, new Set()), 'Your questions have been answered: "Which language?"="Python". You can now continue with these answers in mind.');
assert.match(declinedResult(), /declined this question request/);

const tui = { requestRender() {} } as any;
const theme = { fg: (_key: string, value: string) => value } as any;
let completed: QuestionDialogResult | undefined;
const dialog = new QuestionDialog(tui, theme, questions, (result) => { completed = result; });
assert.match(stripAnsi(dialog.render(80).join("\n")), /☐ Language/);
assert.match(stripAnsi(dialog.render(80).join("\n")), /❯ 1\. Python/);
for (const width of [1, 5, 10, 12, 16, 19, 20, 30, 32, 80]) {
	for (const line of dialog.render(width)) assert.ok(visibleWidth(line) <= width, `single-question row fits width ${width}`);
}
const longHeader = normalizeQuestions([{ ...questions[0], header: "A deliberately very long question header that must be fitted" }]);
const longHeaderDialog = new QuestionDialog(tui, theme, longHeader, () => {});
const narrowLongHeader = longHeaderDialog.render(30);
for (const line of narrowLongHeader) assert.ok(visibleWidth(line) <= 30, "long header and footer never overflow the TUI width contract");
assert.match(stripAnsi(narrowLongHeader[0]), /…/, "narrow headers use an ellipsis rather than silently clipping");
const wrappedQuestionDialog = new QuestionDialog(tui, theme, normalizeQuestions([{ ...questions[0], question: "A deliberately long question that wraps naturally without decorative continuation rails" }]), () => {});
assert.doesNotMatch(stripAnsi(wrappedQuestionDialog.render(32).join("\n")), /^│/m, "wrapped questions remain Pi-native and do not copy Claude's continuation rail");
dialog.handleInput(DOWN);
dialog.handleInput(ENTER);
assert.equal(completed?.kind, "answered", "a single-select question submits immediately without a review screen");
if (completed?.kind === "answered") assert.equal(completed.answers["Which language?"], "TypeScript");

let freeResult: QuestionDialogResult | undefined;
const freeDialog = new QuestionDialog(tui, theme, questions, (result) => { freeResult = result; });
freeDialog.handleInput(DOWN);
freeDialog.handleInput(DOWN);
freeDialog.handleInput(ENTER);
freeDialog.handleInput("Zig");
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
let incompleteMouseResult: QuestionDialogResult | undefined;
const incompleteMouse = new QuestionDialog(tui, theme, twoQuestions, (value) => { incompleteMouseResult = value; });
incompleteMouse.handleInput("\x1b[C"); incompleteMouse.handleInput("\x1b[C");
const incompleteReview = incompleteMouse.render(80).map(stripAnsi);
const submitReviewRow = incompleteReview.findIndex((line) => line.includes("Submit answers"));
incompleteMouse.handleMouse({ type: "click", button: "left", x: 3, y: submitReviewRow } as any);
assert.equal(incompleteMouseResult, undefined, "mouse submission cannot bypass unanswered validation");
assert.match(stripAnsi(incompleteMouse.render(80).join("\n")), /Which language\?/);

const pasteDialog = new QuestionDialog(tui, theme, questions, () => {});
pasteDialog.handleInput(DOWN);
pasteDialog.handleInput(DOWN);
pasteDialog.handleInput(ENTER);
pasteDialog.handleInput("\x1b[200~Golang\x1b[201~");
assert.match(stripAnsi(pasteDialog.render(80).join("\n")), /Golang/, "bracketed terminal paste populates free text");
assert.doesNotMatch(stripAnsi(pasteDialog.render(80).join("\n")), /ctrl\+g/, "the dialog does not advertise an unsupported external-editor key");

let chatResult: QuestionDialogResult | undefined;
const chatDialog = new QuestionDialog(tui, theme, twoQuestions, (result) => { chatResult = result; });
chatDialog.handleInput(ENTER); // answer question one, auto-advance
chatDialog.handleInput(DOWN);
chatDialog.handleInput(DOWN);
chatDialog.handleInput(DOWN);
chatDialog.handleInput(ENTER);
assert.deepEqual(chatResult, { kind: "clarify", answers: { "Which language?": "Python" } }, "Chat about this rejects the whole tool while preserving current answers");
assert.match(clarificationResult(twoQuestions, { "Which language?": "Python" }), /Which color\?[\s\S]*No answer provided/);

let mouseAnswer: QuestionDialogResult | undefined;
const mouseDialog = new QuestionDialog(tui, theme, questions, (value) => { mouseAnswer = value; });
const mouseLines = mouseDialog.render(80).map(stripAnsi);
const secondOptionRow = mouseLines.findIndex((line) => /2\. TypeScript/.test(line));
assert.ok(secondOptionRow >= 0);
assert.deepEqual(mouseDialog.handleMouse({ type: "click", button: "left", x: 3, y: secondOptionRow } as any), { handled: true, focus: true, render: true });
assert.equal(mouseAnswer?.kind, "answered");
if (mouseAnswer?.kind === "answered") assert.equal(mouseAnswer.answers["Which language?"], "TypeScript");
assert.equal(mouseDialog.handleMouse({ type: "wheel", button: "wheel-down", x: 3, y: secondOptionRow } as any), undefined);
assert.equal(mouseDialog.handleMouse({ type: "click", button: "left", x: 3, y: 999 } as any), undefined);

let mouseMultiResult: QuestionDialogResult | undefined;
const mouseMulti = new QuestionDialog(tui, theme, normalizeQuestions([{ question: "Pick toppings", header: "Toppings", multiSelect: true, options: [{ label: "Cheese", description: "" }, { label: "Pepperoni", description: "" }] }]), (value) => { mouseMultiResult = value; });
const mouseMultiLines = mouseMulti.render(80).map(stripAnsi);
const pepperoniRow = mouseMultiLines.findIndex((line) => line.includes("[ ] Pepperoni"));
mouseMulti.handleMouse({ type: "click", button: "left", x: 3, y: pepperoniRow } as any);
mouseMulti.handleInput(ENTER);
mouseMulti.handleInput("\t");
mouseMulti.handleInput(ENTER);
assert.equal(mouseMultiResult?.kind, "answered");
if (mouseMultiResult?.kind === "answered") assert.equal(mouseMultiResult.answers["Pick toppings"], "Cheese, Pepperoni", "mouse toggles without moving keyboard focus and answers retain option order");

let editRequest: QuestionDialogResult | undefined;
const editorDialog = new QuestionDialog(tui, theme, questions, (value) => { editRequest = value; }, { canUseExpandedEditor: true });
editorDialog.handleInput(DOWN);
editorDialog.handleInput(DOWN);
editorDialog.handleInput(ENTER);
assert.match(stripAnsi(editorDialog.render(80).join("\n")), /ctrl\+g to edit/);
editorDialog.handleInput("\x07");
assert.equal(editRequest?.kind, "edit", "ctrl+g exits through an explicit resumable editor request instead of nesting custom UI");

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
			});
		},
	},
});
assert.match(result.content[0].text, /Your questions have been answered/);
assert.equal(result.details.answers["Which language?"], "Python");
assert.deepEqual(result.details.annotations, {});
assert.equal("freeText" in result.details, false);
assert.equal(getEventListeners(sharedRunController.signal, "abort").length, 0, "normal answers remove the call-scoped abort listener from the shared run signal");
let editorCustomCalls = 0;
const editorToolResult = await tool.execute("editor", { questions }, undefined, undefined, {
	mode: "tui", hasUI: true,
	ui: {
		custom(factory: any) {
			editorCustomCalls++;
			return new Promise((resolve) => {
				const component = factory(tui, theme, {}, resolve);
				if (editorCustomCalls === 1) {
					component.handleInput(DOWN); component.handleInput(DOWN); component.handleInput(ENTER); component.handleInput("Old"); component.handleInput("\x07");
				} else if (typeof component.getValue === "function") {
					component.handleInput("X"); component.handleInput(ENTER);
				} else component.handleInput(ENTER);
			});
		},
	},
});
assert.equal(editorCustomCalls, 3, "expanded editor returns to the structured picker instead of nesting or stranding the tool call");
assert.equal(editorToolResult.details.answers["Which language?"], "OldX", "expanded editing appends at the end of the prefilled answer");
let clearEditorCalls = 0;
const clearedEditorResult = await tool.execute("editor-clear", { questions: multiQuestions }, undefined, undefined, {
	mode: "tui", hasUI: true,
	ui: {
		custom(factory: any) {
			clearEditorCalls++;
			return new Promise((resolve) => {
				const component = factory(tui, theme, {}, resolve);
				if (clearEditorCalls === 1) {
					component.handleInput(DOWN); component.handleInput(DOWN); component.handleInput(ENTER); component.handleInput("Old"); component.handleInput("\x07");
				} else if (typeof component.getValue === "function") {
					component.handleInput("\x15"); component.handleInput(ENTER);
				} else {
					component.handleInput("\x1b[A"); component.handleInput("\x1b[A"); component.handleInput(ENTER); component.handleInput("\t"); component.handleInput(ENTER);
				}
			});
		},
	},
});
assert.match(clearedEditorResult.content[0].text, /^Your questions have been answered:/, "clearing an expanded custom answer removes stale free-text semantics");
assert.equal(clearedEditorResult.details.answers["Select toppings"], "Cheese");
const editorAbort = new AbortController();
let abortCustomCalls = 0;
await assert.rejects(() => tool.execute("editor-abort", { questions }, editorAbort.signal, undefined, {
	mode: "tui", hasUI: true,
	ui: {
		custom(factory: any) {
			abortCustomCalls++;
			return new Promise((resolve) => {
				const component = factory(tui, theme, {}, resolve);
				if (abortCustomCalls === 1) {
					component.handleInput(DOWN); component.handleInput(DOWN); component.handleInput(ENTER); component.handleInput("\x07");
				} else if (abortCustomCalls === 2) queueMicrotask(() => editorAbort.abort());
			});
		},
	},
}), (error: unknown) => error instanceof AskUserQuestionRejection && error.reason === "declined");
assert.ok(abortCustomCalls >= 2, "abort dismisses the expanded editor and unblocks the tool call");
await assert.rejects(() => tool.execute("id", { questions }, undefined, undefined, { mode: "print", hasUI: false, ui: {} }), /interactive TUI/);

let inputCalled = false;
await assert.rejects(() => tool.execute("id", { questions }, undefined, undefined, {
	mode: "tui", hasUI: true,
	ui: { custom: async () => ({ kind: "clarify", answers: {} }), input: async () => { inputCalled = true; return "unused"; } },
}), (error: unknown) => error instanceof AskUserQuestionRejection && error.reason === "clarify" && /wants to clarify/.test(error.message));
assert.equal(inputCalled, false, "Chat about this returns control to normal conversation instead of turning clarification into an answer");

const abortController = new AbortController();
abortController.abort();
await assert.rejects(() => tool.execute("id", { questions }, abortController.signal, undefined, {
	mode: "tui", hasUI: true,
	ui: { custom: (factory: any) => new Promise((resolve) => factory(tui, theme, {}, resolve)) },
}), (error: unknown) => error instanceof AskUserQuestionRejection && error.reason === "declined" && /declined this question request/.test(error.message), "aborted interactive questions reject with structured denial metadata");
let multiResult: QuestionDialogResult | undefined;
const multiDialog = new QuestionDialog(tui, theme, multiQuestions, (value) => { multiResult = value; });
multiDialog.handleInput(ENTER);
multiDialog.handleInput(DOWN);
multiDialog.handleInput(ENTER);
assert.equal(multiResult, undefined, "Enter toggles multi-select options without advancing");
multiDialog.handleInput("\t");
multiDialog.handleInput(ENTER);
assert.equal(multiResult?.kind, "answered");
if (multiResult?.kind === "answered") assert.equal(multiResult.answers["Select toppings"], "Cheese, Pepperoni");

let customMultiResult: QuestionDialogResult | undefined;
const customMulti = new QuestionDialog(tui, theme, multiQuestions, (value) => { customMultiResult = value; });
customMulti.handleInput(DOWN);
customMulti.handleInput(DOWN);
customMulti.handleInput(ENTER);
customMulti.handleInput("\x1b[71u");
customMulti.handleInput("reen");
customMulti.handleInput(" ");
customMulti.handleInput("Olives");
customMulti.handleInput(ENTER);
assert.match(stripAnsi(customMulti.render(80).join("\n")), /\[✔\] Green Olives/);
customMulti.handleInput("\t");
customMulti.handleInput(ENTER);
assert.equal(customMultiResult?.kind, "answered");
if (customMultiResult?.kind === "answered") assert.equal(customMultiResult.answers["Select toppings"], "Green Olives");
let mouseEditedResult: QuestionDialogResult | undefined;
const mouseEditCustom = new QuestionDialog(tui, theme, multiQuestions, (value) => { mouseEditedResult = value; }, {
	initialState: { tab: 0, row: 2, review: false, reviewRow: 0, editingOther: false, inputs: ["Green Olives"], choices: [[]], customSelected: [true], freeText: ["Select toppings"] },
});
const mouseEditLines = mouseEditCustom.render(80).map(stripAnsi);
const customRow = mouseEditLines.findIndex((line) => line.includes("Green Olives"));
mouseEditCustom.handleMouse({ type: "click", button: "left", x: 4, y: customRow });
mouseEditCustom.handleInput("X"); mouseEditCustom.handleInput(ENTER); mouseEditCustom.handleInput("\t"); mouseEditCustom.handleInput(ENTER);
assert.equal(mouseEditedResult?.kind, "answered");
if (mouseEditedResult?.kind === "answered") assert.equal(mouseEditedResult.answers["Select toppings"], "Green OlivesX", "mouse can re-enter an existing custom answer for editing");
let deselectedResult: QuestionDialogResult | undefined;
const deselectCustom = new QuestionDialog(tui, theme, multiQuestions, (value) => { deselectedResult = value; }, {
	initialState: { tab: 0, row: 2, review: false, reviewRow: 0, editingOther: false, inputs: ["Olives"], choices: [[]], customSelected: [true], freeText: ["Select toppings"] },
});
deselectCustom.handleInput(" ");
assert.match(stripAnsi(deselectCustom.render(80).join("\n")), /\[ \] Olives/, "multi-select custom answers can be toggled off without losing their text");
deselectCustom.handleInput("\x1b[A"); deselectCustom.handleInput("\x1b[A"); deselectCustom.handleInput(ENTER); deselectCustom.handleInput("\t"); deselectCustom.handleInput(ENTER);
assert.equal(deselectedResult?.kind, "answered");
if (deselectedResult?.kind === "answered") {
	assert.equal(deselectedResult.answers["Select toppings"], "Cheese");
	assert.equal(deselectedResult.freeText.size, 0, "deselected custom text does not retain free-text result semantics");
}

let reviewCancelled: QuestionDialogResult | undefined;
const cancelReview = new QuestionDialog(tui, theme, twoQuestions, (value) => { reviewCancelled = value; });
cancelReview.handleInput(ENTER);
cancelReview.handleInput(ENTER);
cancelReview.handleInput(DOWN);
cancelReview.handleInput(ENTER);
assert.deepEqual(reviewCancelled, { kind: "cancelled" }, "review Cancel is distinct from submission");

let replacedCustom: QuestionDialogResult | undefined;
const replaceCustomDialog = new QuestionDialog(tui, theme, twoQuestions, (value) => { replacedCustom = value; }, {
	initialState: { tab: 0, row: 0, review: false, reviewRow: 0, editingOther: false, inputs: ["custom", ""], choices: [[], ["Red"]], customSelected: [true, false], freeText: ["Which language?"] },
});
replaceCustomDialog.handleInput(ENTER);
replaceCustomDialog.handleInput(ENTER);
assert.equal(replacedCustom?.kind, "answered");
if (replacedCustom?.kind === "answered") assert.equal(replacedCustom.answers["Which language?"], "Python", "predefined single-select replaces rather than combines with custom text");

const renderedAnswer = tool.renderResult(result, { isError: false }, theme, { args: { questions } }).render(100).join("\n");
assert.match(stripAnsi(renderedAnswer), /User answered Pi Agent's questions/);
const renderedDecline = tool.renderResult({ content: [], details: {} }, { expanded: false, isPartial: false }, theme, { args: { questions }, isError: true }).render(100).join("\n");
assert.match(stripAnsi(renderedDecline), /User declined to answer questions/);
const renderedMultiple = stripAnsi(tool.renderResult({ details: { questions: twoQuestions, answers: { "Which language?": "Python", "Which color?": "Blue" }, annotations: {} } }, { isError: false }, theme, {}).render(120).join("\n"));
assert.equal((renderedMultiple.match(/⎿/g) ?? []).length, 1, "only the first settled answer owns the result gutter");
assert.match(renderedMultiple, /     · Which color\? → Blue/);

console.log("AskUserQuestion domain, interaction, and tool tests passed");
