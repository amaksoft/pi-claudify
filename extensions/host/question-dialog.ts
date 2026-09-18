import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type TUI,
} from "@earendil-works/pi-tui";

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
export interface QuestionDialogClarify { kind: "clarify"; answers: QuestionAnswers }
export interface QuestionDialogState {
	tab: number;
	row: number;
	review: boolean;
	reviewRow: number;
	editingOther: boolean;
	inputs: string[];
	choices: string[][];
	customSelected: boolean[];
	freeText: string[];
}
export interface QuestionDialogEdit { kind: "edit"; questionIndex: number; state: QuestionDialogState }
export type QuestionDialogResult = QuestionDialogAnswer | QuestionDialogCancelled | QuestionDialogClarify | QuestionDialogEdit;
export interface QuestionDialogOptions { canUseExpandedEditor?: boolean; initialState?: QuestionDialogState }

interface QuestionMouseEvent { type?: string; button?: unknown; x: number; y: number }
interface QuestionMouseResult { handled: true; focus?: boolean; render?: boolean }

interface HitRegion {
	rowStart: number;
	rowEnd: number;
	colStart?: number;
	colEnd?: number;
	action: "option" | "other" | "chat" | "tab" | "review-submit" | "review-cancel";
	index?: number;
}

function fit(line: string, width: number, ellipsis = ""): string {
	return visibleWidth(line) <= width ? line : truncateToWidth(line, Math.max(1, width), ellipsis);
}

function primaryClick(event: QuestionMouseEvent): boolean {
	const button = event.button as unknown;
	return event.type === "click" && (button === "left" || button === 0 || button === "primary" || button === undefined);
}

function decodeKittyPrintable(data: string): string | undefined {
	const match = /^\x1b\[(\d+)(?::\d+)?(?:;(\d+)(?::\d+)*)?u$/.exec(data);
	if (!match || (match[2] !== undefined && Number(match[2]) !== 1)) return undefined;
	const codePoint = Number(match[1]);
	if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return undefined;
	const value = String.fromCodePoint(codePoint);
	return /^\P{C}$/u.test(value) ? value : undefined;
}

export class QuestionDialog {
	focused = true;
	private tab = 0;
	private row = 0;
	private review = false;
	private reviewRow = 0;
	private editingOther = false;
	private readonly inputs: string[];
	private readonly choices: string[][];
	private readonly customSelected: boolean[];
	private readonly freeText = new Set<string>();
	private hitRegions: HitRegion[] = [];
	private completed = false;

	constructor(
		private readonly tui: TUI,
		private readonly _theme: Theme,
		private readonly questions: readonly UserQuestion[],
		private readonly done: (result: QuestionDialogResult) => void,
		private readonly options: QuestionDialogOptions = {},
	) {
		const initial = options.initialState;
		this.tab = Math.max(0, Math.min(questions.length - 1, initial?.tab ?? 0));
		this.row = Math.max(0, initial?.row ?? 0);
		this.review = initial?.review === true;
		this.reviewRow = initial?.reviewRow === 1 ? 1 : 0;
		this.editingOther = initial?.editingOther === true;
		this.choices = questions.map((_question, index) => [...(initial?.choices[index] ?? [])]);
		this.inputs = questions.map((_question, index) => initial?.inputs[index] ?? "");
		this.customSelected = questions.map((_question, index) => initial?.customSelected[index] === true);
		for (const question of initial?.freeText ?? []) this.freeText.add(question);
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		this.hitRegions = [];
		if (this.review) return this.renderReview(safeWidth);
		const question = this.questions[this.tab];
		const lines: string[] = [];
		const push = (line: string, hit?: Omit<HitRegion, "rowStart" | "rowEnd">): void => {
			const row = lines.length;
			lines.push(fit(line, safeWidth));
			if (hit) this.hitRegions.push({ ...hit, rowStart: row, rowEnd: row + 1 });
		};
		if (this.questions.length === 1) push(fit(`${PILL} ☐ ${question.header} ${RESET}`, safeWidth, "…"));
		else {
			const tabs = this.questions.map((item, index) => `${this.hasAnswer(index) ? "☒" : "☐"} ${item.header}`);
			tabs.push("✔ Submit");
			let rendered = "←  ";
			let plainColumn = 3;
			tabs.forEach((label, index) => {
				const segment = index === this.tab ? `${PILL} ${label} ${RESET}` : `${DIM}${label}${RESET}`;
				const start = plainColumn;
				rendered += segment;
				plainColumn += visibleWidth(segment);
				this.hitRegions.push({ rowStart: 0, rowEnd: 1, colStart: start, colEnd: plainColumn, action: "tab", index });
				if (index < tabs.length - 1) { rendered += "  "; plainColumn += 2; }
			});
			rendered += "  →";
			lines.push(fit(rendered, safeWidth, "…"));
		}
		push("");
		const wrappedQuestion = wrapTextWithAnsi(question.question, safeWidth);
		for (const part of wrappedQuestion) push(`${BOLD}${part}${RESET}`);
		push("");
		question.options.forEach((option, index) => {
			const active = this.row === index;
			const mark = question.multiSelect ? (this.choices[this.tab].includes(option.label) ? "[✔]" : "[ ]") : `${index + 1}.`;
			const number = question.multiSelect ? mark : `${DIM}${mark}${RESET}`;
			const start = lines.length;
			push(`${active ? `${ACCENT}❯${RESET}` : " "} ${number} ${active ? ACCENT : ""}${option.label}${RESET}`);
			if (option.description) for (const part of wrapTextWithAnsi(option.description, Math.max(1, safeWidth - 5))) push(`     ${DIM}${part}${RESET}`);
			this.hitRegions.push({ rowStart: start, rowEnd: lines.length, action: "option", index });
		});
		const otherIndex = question.options.length;
		const input = this.inputs[this.tab];
		const activeOther = this.row === otherIndex;
		const otherStart = lines.length;
		if (question.multiSelect) {
			const mark = this.customSelected[this.tab] ? "[✔]" : "[ ]";
			push(`${activeOther ? `${ACCENT}❯${RESET}` : " "} ${otherIndex + 1}. ${mark} ${activeOther ? ACCENT : DIM}${input || "Type something"}${RESET}`);
		} else {
			const other = activeOther && this.editingOther ? input || " " : input || "Type something.";
			push(`${activeOther ? `${ACCENT}❯${RESET}` : " "} ${DIM}${otherIndex + 1}.${RESET} ${activeOther ? ACCENT : DIM}${other}${RESET}`);
		}
		this.hitRegions.push({ rowStart: otherStart, rowEnd: lines.length, action: "other" });
		push(`${DIM}${"─".repeat(Math.max(1, Math.min(safeWidth, 44)))}${RESET}`);
		push(`${this.row === otherIndex + 1 ? "❯" : " "} ${otherIndex + 2}. Chat about this`, { action: "chat" });
		push("");
		const hints = ["Enter to select"];
		if (this.questions.length > 1 || question.multiSelect) hints.push("Tab/Arrow keys to navigate");
		else hints.push("↑/↓ to navigate");
		if (activeOther && this.editingOther && this.options.canUseExpandedEditor) hints.push("ctrl+g to edit");
		hints.push("Esc to cancel");
		for (const part of wrapTextWithAnsi(hints.join(" · "), safeWidth)) push(`${DIM}${part}${RESET}`);
		return lines;
	}

	handleInput(data: string): void {
		const pasted = /^\x1b\[200~([\s\S]*)\x1b\[201~$/.exec(data);
		if (pasted) {
			const question = this.questions[this.tab];
			if (!this.review && this.row === question.options.length && this.editingOther) this.inputs[this.tab] += pasted[1].replace(/[\r\n]+/g, " ");
			this.repaint();
			return;
		}
		if (matchesKey(data, Key.escape)) { this.finish({ kind: "cancelled" }); return; }
		if (this.review) { this.handleReview(data); return; }
		const question = this.questions[this.tab];
		if (matchesKey(data, "ctrl+g") && this.row === question.options.length && this.editingOther && this.options.canUseExpandedEditor) {
			this.finish({ kind: "edit", questionIndex: this.tab, state: this.snapshotState() });
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			if (this.questions.length > 1) this.changeTab(1);
			else if (question.multiSelect && this.hasAnswer(0)) { this.review = true; this.reviewRow = 0; this.repaint(); }
			return;
		}
		if (this.questions.length > 1 && matchesKey(data, Key.left)) { this.changeTab(-1); return; }
		const maxRow = question.options.length + 1;
		if (matchesKey(data, Key.up)) { this.row = (this.row + maxRow) % (maxRow + 1); this.editingOther = false; this.repaint(); return; }
		if (matchesKey(data, Key.down)) { this.row = (this.row + 1) % (maxRow + 1); this.editingOther = false; this.repaint(); return; }
		if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
			if (this.row === question.options.length && this.editingOther) {
				this.inputs[this.tab] = this.inputs[this.tab].slice(0, -1);
				if (!this.inputs[this.tab]) { this.customSelected[this.tab] = false; this.freeText.delete(question.question); }
			}
			this.repaint();
			return;
		}
		if (question.multiSelect && matchesKey(data, Key.space)) {
			if (this.row < question.options.length) this.toggle(question.options[this.row].label);
			else if (this.row === question.options.length && this.editingOther) this.inputs[this.tab] += " ";
			else if (this.row === question.options.length && this.inputs[this.tab]) this.toggleCustom();
			this.repaint();
			return;
		}
		if (matchesKey(data, Key.enter)) { this.selectCurrent(); return; }
		if (this.row === question.options.length && this.editingOther) {
			const printable = decodeKittyPrintable(data) ?? (/^\P{C}+$/u.test(data) ? data : undefined);
			if (printable !== undefined) { this.inputs[this.tab] += printable; this.repaint(); }
		}
	}

	handleMouse(event: QuestionMouseEvent): QuestionMouseResult | undefined {
		if (!primaryClick(event)) return undefined;
		const hit = this.hitRegions.find((candidate) =>
			event.y >= candidate.rowStart && event.y < candidate.rowEnd
			&& (candidate.colStart === undefined || (event.x >= candidate.colStart && event.x < (candidate.colEnd ?? Number.POSITIVE_INFINITY))));
		if (!hit) return undefined;
		if (hit.action === "tab" && typeof hit.index === "number") {
			if (hit.index === this.questions.length) { this.review = true; this.reviewRow = 0; }
			else { this.review = false; this.tab = hit.index; this.row = 0; this.editingOther = false; }
		} else if (hit.action === "option" && typeof hit.index === "number") {
			const question = this.questions[this.tab];
			if (question.multiSelect) this.toggle(question.options[hit.index].label);
			else { this.row = hit.index; this.selectCurrent(); }
		} else if (hit.action === "other") {
			this.row = this.questions[this.tab].options.length;
			const question = this.questions[this.tab];
			if (question.multiSelect && this.inputs[this.tab] && !this.customSelected[this.tab]) this.toggleCustom();
			else this.editingOther = true;
		} else if (hit.action === "chat") {
			this.finish({ kind: "clarify", answers: this.answersSnapshot() });
		} else if (hit.action === "review-submit") this.submitOrFocusUnanswered();
		else if (hit.action === "review-cancel") this.finish({ kind: "cancelled" });
		this.repaint();
		return { handled: true, focus: true, render: true };
	}

	invalidate(): void { this.hitRegions = []; }
	cancel(): void { this.finish({ kind: "cancelled" }); }

	private hasAnswer(index: number): boolean {
		return this.choices[index].length > 0 || (this.customSelected[index] && !!this.inputs[index].trim());
	}

	private valuesFor(index: number): string[] {
		const selected = this.questions[index].options.filter((option) => this.choices[index].includes(option.label)).map((option) => option.label);
		return [...selected, ...(this.customSelected[index] && this.inputs[index].trim() ? [this.inputs[index].trim()] : [])];
	}

	private answersSnapshot(): QuestionAnswers {
		const answers: QuestionAnswers = {};
		this.questions.forEach((question, index) => { if (this.hasAnswer(index)) answers[question.question] = this.valuesFor(index).join(", "); });
		return answers;
	}

	private selectCurrent(): void {
		const question = this.questions[this.tab];
		if (this.row === question.options.length + 1) { this.finish({ kind: "clarify", answers: this.answersSnapshot() }); return; }
		if (this.row === question.options.length) {
			if (!this.editingOther) {
				this.editingOther = true;
				this.repaint();
				return;
			}
			if (!this.inputs[this.tab].trim()) {
				this.customSelected[this.tab] = false;
				this.freeText.delete(question.question);
				this.repaint();
				return;
			}
			this.freeText.add(question.question);
			if (question.multiSelect) {
				this.customSelected[this.tab] = true;
				this.freeText.add(question.question);
				this.editingOther = false;
				this.repaint();
				return;
			}
			this.choices[this.tab] = [];
			this.customSelected[this.tab] = true;
		} else if (question.multiSelect) {
			this.toggle(question.options[this.row].label);
			this.repaint();
			return;
		} else {
			this.choices[this.tab] = [question.options[this.row].label];
			this.customSelected[this.tab] = false;
			this.freeText.delete(question.question);
		}
		this.advance();
	}

	private toggleCustom(): void {
		this.customSelected[this.tab] = !this.customSelected[this.tab];
		const question = this.questions[this.tab];
		if (this.customSelected[this.tab]) this.freeText.add(question.question);
		else this.freeText.delete(question.question);
	}

	private toggle(label: string): void {
		const values = this.choices[this.tab];
		const index = values.indexOf(label);
		if (index >= 0) values.splice(index, 1); else values.push(label);
	}

	private advance(): void {
		this.editingOther = false;
		if (this.questions.length === 1 && this.hasAnswer(0)) { this.submitAnswers(); return; }
		const next = this.choices.findIndex((_answers, index) => index > this.tab && !this.hasAnswer(index));
		if (next >= 0) { this.tab = next; this.row = 0; }
		else if (this.questions.every((_answers, index) => this.hasAnswer(index))) this.review = true;
		else { this.tab = this.questions.findIndex((_question, index) => !this.hasAnswer(index)); this.row = 0; }
		this.repaint();
	}

	private changeTab(delta: number): void {
		const count = this.questions.length + 1;
		this.tab = (this.tab + delta + count) % count;
		this.editingOther = false;
		if (this.tab === this.questions.length) { this.review = true; this.reviewRow = 0; }
		else this.review = false;
		this.row = 0;
		this.repaint();
	}

	private handleReview(data: string): void {
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) { this.reviewRow = 1 - this.reviewRow; this.repaint(); return; }
		if (this.questions.length > 1 && matchesKey(data, Key.left)) { this.review = false; this.tab = this.questions.length - 1; this.repaint(); return; }
		if (!matchesKey(data, Key.enter)) return;
		if (this.reviewRow === 1) { this.finish({ kind: "cancelled" }); return; }
		this.submitOrFocusUnanswered();
	}

	private submitOrFocusUnanswered(): void {
		const unanswered = this.questions.findIndex((_question, index) => !this.hasAnswer(index));
		if (unanswered >= 0) {
			this.review = false;
			this.tab = unanswered;
			this.row = 0;
			this.repaint();
			return;
		}
		this.submitAnswers();
	}

	private submitAnswers(): void {
		this.finish({ kind: "answered", answers: this.answersSnapshot(), freeText: new Set(this.freeText) });
	}

	private renderReview(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const lines: string[] = [];
		const pushWrapped = (line: string): void => { for (const part of wrapTextWithAnsi(line, safeWidth)) lines.push(fit(part, safeWidth)); };
		pushWrapped(`${BOLD}Review your answers${RESET}`);
		this.questions.forEach((question, index) => {
			pushWrapped(` ${DIM}●${RESET} ${question.question}`);
			pushWrapped(`   ${GREEN}→ ${this.valuesFor(index).join(", ") || "Not answered"}${RESET}`);
		});
		lines.push("");
		pushWrapped(`${BOLD}Ready to submit your answers?${RESET}`);
		const submitStart = lines.length;
		pushWrapped(`${this.reviewRow === 0 ? "❯" : " "} 1. Submit answers`);
		this.hitRegions.push({ rowStart: submitStart, rowEnd: lines.length, action: "review-submit" });
		const cancelStart = lines.length;
		pushWrapped(`${this.reviewRow === 1 ? "❯" : " "} 2. Cancel`);
		this.hitRegions.push({ rowStart: cancelStart, rowEnd: lines.length, action: "review-cancel" });
		return lines;
	}

	private snapshotState(): QuestionDialogState {
		return {
			tab: this.tab,
			row: this.row,
			review: this.review,
			reviewRow: this.reviewRow,
			editingOther: this.editingOther,
			inputs: [...this.inputs],
			choices: this.choices.map((values) => [...values]),
			customSelected: [...this.customSelected],
			freeText: [...this.freeText],
		};
	}

	private finish(result: QuestionDialogResult): void {
		if (this.completed) return;
		this.completed = true;
		this.done(result);
	}

	private repaint(): void { if (!this.completed) this.tui.requestRender(); }
}
