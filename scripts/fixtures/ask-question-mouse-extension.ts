import { writeFileSync } from "node:fs";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { QuestionDialog, type QuestionDialogResult } from "../../extensions/host/question-dialog.ts";
import type { UserQuestion } from "../../extensions/domain/questions.ts";

const single: UserQuestion[] = [{ question: "Pick a language?", header: "Language", multiSelect: false, options: [{ label: "Python", description: "Scripting" }, { label: "TypeScript", description: "Typed applications" }] }];
const multi: UserQuestion[] = [{ question: "Pick toppings", header: "Toppings", multiSelect: true, options: [{ label: "Cheese", description: "" }, { label: "Pepperoni", description: "" }] }];

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("ask-mouse-probe", {
		description: "Exercise AskUserQuestion mouse behavior",
		handler: async (args, ctx) => {
			const questions = args.trim() === "multi" ? multi : single;
			const result = await ctx.ui.custom<QuestionDialogResult>((tui, theme: Theme, _keys, done) => new QuestionDialog(tui, theme, questions, done));
			writeFileSync(process.env.PI_CLAUDIFY_ASK_MOUSE_STATE!, JSON.stringify(result));
		},
	});
}
