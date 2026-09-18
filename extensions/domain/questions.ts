import { sanitizeToolContent, sanitizeToolText } from "../terminal-sanitize.ts";

export interface QuestionOption { label: string; description: string }
export interface UserQuestion { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }
export type QuestionAnswers = Record<string, string>;

export function normalizeQuestions(value: unknown): UserQuestion[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 4) throw new Error("AskUserQuestion requires between 1 and 4 questions.");
	const seenQuestions = new Set<string>();
	return value.map((raw, index) => {
		if (!raw || typeof raw !== "object") throw new Error(`Question ${index + 1} is invalid.`);
		const record = raw as Record<string, unknown>;
		const question = typeof record.question === "string" ? sanitizeToolContent(record.question).trim() : "";
		const header = typeof record.header === "string" ? sanitizeToolText(record.header).trim() : "";
		if (!question || !header) throw new Error(`Question ${index + 1} requires question and header text.`);
		if (seenQuestions.has(question)) throw new Error(`Question ${index + 1} duplicates an earlier question.`);
		seenQuestions.add(question);
		if (!Array.isArray(record.options) || record.options.length < 2 || record.options.length > 4) throw new Error(`Question ${index + 1} requires between 2 and 4 options.`);
		const seenLabels = new Set<string>();
		const options = record.options.map((option, optionIndex) => {
			if (!option || typeof option !== "object") throw new Error(`Question ${index + 1}, option ${optionIndex + 1} is invalid.`);
			const item = option as Record<string, unknown>;
			const label = typeof item.label === "string" ? sanitizeToolText(item.label).trim() : "";
			if (!label) throw new Error(`Question ${index + 1}, option ${optionIndex + 1} requires a label.`);
			if (seenLabels.has(label)) throw new Error(`Question ${index + 1} has duplicate option label ${JSON.stringify(label)}.`);
			seenLabels.add(label);
			return { label, description: typeof item.description === "string" ? sanitizeToolContent(item.description).trim() : "" };
		});
		return { question, header, multiSelect: record.multiSelect === true, options };
	});
}

export function formatAnsweredResult(questions: readonly UserQuestion[], answers: QuestionAnswers, freeText: ReadonlySet<string>): string {
	const pairs = questions.map((question) => `"${question.question}"="${answers[question.question] ?? ""}"`).join(", ");
	return freeText.size > 0
		? `The user answered: ${pairs}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`
		: `Your questions have been answered: ${pairs}. You can now continue with these answers in mind.`;
}

export function declinedResult(): string {
	return "The user declined this question request. Do not infer answers; continue only when the user provides direction.";
}

export function clarificationResult(questions: readonly UserQuestion[], answers: QuestionAnswers): string {
	const asked = questions.map((question) => {
		const answer = answers[question.question];
		return `- "${question.question}"\n  ${answer ? `Current answer: "${answer}"` : "(No answer provided)"}`;
	}).join("\n");
	return `The user wants to clarify these questions before answering. Consider any context they add, reformulate the questions when helpful, and start by asking what they would like to clarify.\n\nQuestions asked:\n${asked}`;
}

export class AskUserQuestionRejection extends Error {
	constructor(
		message: string,
		readonly reason: "declined" | "clarify",
		readonly questions: readonly UserQuestion[],
		readonly answers: QuestionAnswers = {},
	) {
		super(message);
		this.name = "AskUserQuestionRejection";
	}
}
