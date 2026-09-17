import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";

import type { QuestionAnswers, UserQuestion } from "../domain/questions.ts";

const RESET = "\x1b[0m";
const DIM = "\x1b[38;5;246m";
const ACCENT = "\x1b[38;5;153m";
const GREEN = "\x1b[38;5;114m";
const BOLD = "\x1b[1m";
const PILL = "\x1b[48;5;153m\x1b[38;5;16m";

export interface QuestionDialogAnswer {
	kind: "answered";
	answers: QuestionAnswers;
	freeText: Set<string>;
}
export interface QuestionDialogCancelled { kind: "cancelled" }
export interface QuestionDialogChat { kind: "chat"; questionIndex: number }
export type QuestionDialogResult = QuestionDialogAnswer | QuestionDialogCancelled | QuestionDialogChat;

function fit(line: string, width: number): string {
	return visibleWidth(line) <= width ? line : truncateToWidth(line, Math.max(1, width), "");
}

export class QuestionDialog {
	focused = true;
	private tab = 0;
	private row = 0;
	private review = false;
	private reviewRow = 0;
	private input = "";
	private readonly choices: string[][];
	private readonly freeText = new Set<string>();

	constructor(
		private readonly tui: TUI,
		private readonly _theme: Theme,
		private readonly questions: readonly UserQuestion[],
		private readonly done: (result: QuestionDialogResult) => void,
	) {
		this.choices = questions.map(() => []);
	}

	render(width: number): string[] {
		const safeWidth = Math.max(20, width);
		if (this.review) return this.renderReview(safeWidth);
		const question = this.questions[this.tab];
		const lines: string[] = [];
		if (this.questions.length === 1) lines.push(fit(`${PILL} ☐ ${question.header} ${RESET}`, safeWidth));
		else {
			const tabs = this.questions.map((item, index) => `${this.choices[index].length ? "☒" : "☐"} ${item.header}`);
			tabs.push("✔ Submit");
			lines.push(fit(`←  ${tabs.map((label, index) => index === this.tab ? `${PILL} ${label} ${RESET}` : `${DIM}${label}${RESET}`).join("  ")}  →`, safeWidth));
		}
		lines.push("");
		const wrappedQuestion = wrapTextWithAnsi(question.question, Math.max(10, safeWidth - 2));
		for (const part of wrappedQuestion) lines.push(`${wrappedQuestion.length > 1 ? `${DIM}│ ${RESET}` : ""}${BOLD}${part}${RESET}`);
		lines.push("");
		question.options.forEach((option, index) => {
			const active = this.row === index;
			const mark = question.multiSelect ? (this.choices[this.tab].includes(option.label) ? "[✔]" : "[ ]") : `${index + 1}.`;
			lines.push(fit(`${active ? "❯" : " "} ${active ? ACCENT : ""}${mark} ${option.label}${RESET}`, safeWidth));
			if (option.description) for (const part of wrapTextWithAnsi(option.description, Math.max(10, safeWidth - 5))) lines.push(fit(`     ${DIM}${part}${RESET}`, safeWidth));
		});
		const otherIndex = question.options.length;
		const other = this.row === otherIndex && this.input ? this.input : "Type something.";
		lines.push(fit(`${this.row === otherIndex ? "❯" : " "} ${question.options.length + 1}. ${this.row === otherIndex ? ACCENT : DIM}${other}${RESET}`, safeWidth));
		lines.push(`${DIM}${"─".repeat(Math.max(1, Math.min(safeWidth, 44)))}${RESET}`);
		lines.push(fit(`${this.row === otherIndex + 1 ? "❯" : " "} ${question.options.length + 2}. Chat about this`, safeWidth));
		lines.push("");
		lines.push(fit(`${DIM}${question.multiSelect ? "Space to toggle · " : ""}Enter to select · ${this.questions.length > 1 ? "Tab/Arrow keys" : "↑/↓"} to navigate · Esc to cancel${RESET}`, safeWidth));
		return lines;
	}

	handleInput(data: string): void {
		const pasted = /^\x1b\[200~([\s\S]*)\x1b\[201~$/.exec(data);
		if (pasted) {
			const question = this.questions[this.tab];
			if (!this.review && this.row === question.options.length) this.input += pasted[1].replace(/[\r\n]+/g, " ");
			this.repaint();
			return;
		}
		if (matchesKey(data, Key.escape)) { this.done({ kind: "cancelled" }); return; }
		if (this.review) { this.handleReview(data); return; }
		if (this.questions.length > 1 && (matchesKey(data, Key.tab) || matchesKey(data, Key.right))) { this.changeTab(1); return; }
		if (this.questions.length > 1 && matchesKey(data, Key.left)) { this.changeTab(-1); return; }
		const question = this.questions[this.tab];
		const maxRow = question.options.length + 1;
		if (matchesKey(data, Key.up)) { this.row = (this.row + maxRow) % (maxRow + 1); this.input = ""; this.repaint(); return; }
		if (matchesKey(data, Key.down)) { this.row = (this.row + 1) % (maxRow + 1); this.input = ""; this.repaint(); return; }
		if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) { if (this.row === question.options.length) this.input = this.input.slice(0, -1); this.repaint(); return; }
		if (question.multiSelect && matchesKey(data, Key.space) && this.row < question.options.length) { this.toggle(question.options[this.row].label); this.repaint(); return; }
		if (matchesKey(data, Key.enter)) { this.selectCurrent(); return; }
		if (this.row === question.options.length && /^\P{C}+$/u.test(data)) { this.input += data; this.repaint(); }
	}

	invalidate(): void {}

	private selectCurrent(): void {
		const question = this.questions[this.tab];
		if (this.row === question.options.length + 1) { this.done({ kind: "chat", questionIndex: this.tab }); return; }
		if (this.row === question.options.length) {
			if (!this.input.trim()) { this.done({ kind: "cancelled" }); return; }
			this.choices[this.tab] = [this.input.trim()];
			this.freeText.add(question.question);
		} else if (question.multiSelect) {
			if (this.choices[this.tab].length === 0) this.toggle(question.options[this.row].label);
		} else this.choices[this.tab] = [question.options[this.row].label];
		this.advance();
	}

	private toggle(label: string): void {
		const values = this.choices[this.tab];
		const index = values.indexOf(label);
		if (index >= 0) values.splice(index, 1); else values.push(label);
	}

	private advance(): void {
		this.input = "";
		const next = this.choices.findIndex((answers, index) => index > this.tab && answers.length === 0);
		if (next >= 0) { this.tab = next; this.row = 0; }
		else if (this.choices.every((answers) => answers.length > 0)) this.review = true;
		else { this.tab = this.choices.findIndex((answers) => answers.length === 0); this.row = 0; }
		this.repaint();
	}

	private changeTab(delta: number): void {
		const count = this.questions.length + 1;
		this.tab = (this.tab + delta + count) % count;
		this.input = "";
		if (this.tab === this.questions.length) this.review = true;
		this.row = 0;
		this.repaint();
	}

	private handleReview(data: string): void {
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) { this.reviewRow = 1 - this.reviewRow; this.repaint(); return; }
		if (this.questions.length > 1 && matchesKey(data, Key.left)) { this.review = false; this.tab = this.questions.length - 1; this.repaint(); return; }
		if (!matchesKey(data, Key.enter)) return;
		if (this.reviewRow === 1) { this.done({ kind: "cancelled" }); return; }
		const unanswered = this.choices.findIndex((answers) => answers.length === 0);
		if (unanswered >= 0) { this.review = false; this.tab = unanswered; this.row = 0; this.repaint(); return; }
		const answers: QuestionAnswers = {};
		this.questions.forEach((question, index) => { answers[question.question] = this.choices[index].join(", "); });
		this.done({ kind: "answered", answers, freeText: new Set(this.freeText) });
	}

	private renderReview(width: number): string[] {
		const lines = [`${BOLD}Review your answers${RESET}`];
		this.questions.forEach((question, index) => {
			lines.push(` ${DIM}●${RESET} ${question.question}`);
			lines.push(`   ${GREEN}→ ${this.choices[index].join(", ") || "Not answered"}${RESET}`);
		});
		lines.push("", `${BOLD}Ready to submit your answers?${RESET}`, `${this.reviewRow === 0 ? "❯" : " "} 1. Submit answers`, `${this.reviewRow === 1 ? "❯" : " "} 2. Cancel`);
		return lines.flatMap((line) => wrapTextWithAnsi(line, width));
	}

	private repaint(): void { this.tui.requestRender(); }
}
