import { sanitizeToolContent, sanitizeToolText } from "../terminal-sanitize.ts";

export interface QuestionOption { label: string; description: string }
export interface UserQuestion { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }
export type QuestionAnswers = Record<string, string>;

export function normalizeQuestions(value: unknown): UserQuestion[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 4) throw new Error("AskUserQuestion requires between 1 and 4 questions.");
	return value.map((raw, index) => {
		if (!raw || typeof raw !== "object") throw new Error(`Question ${index + 1} is invalid.`);
		const record = raw as Record<string, unknown>;
		const question = typeof record.question === "string" ? sanitizeToolContent(record.question).trim() : "";
		const header = typeof record.header === "string" ? sanitizeToolText(record.header).trim() : "";
		if (!question || !header) throw new Error(`Question ${index + 1} requires question and header text.`);
		if (!Array.isArray(record.options) || record.options.length < 2 || record.options.length > 4) throw new Error(`Question ${index + 1} requires between 2 and 4 options.`);
		const options = record.options.map((option, optionIndex) => {
			if (!option || typeof option !== "object") throw new Error(`Question ${index + 1}, option ${optionIndex + 1} is invalid.`);
			const item = option as Record<string, unknown>;
			const label = typeof item.label === "string" ? sanitizeToolText(item.label).trim() : "";
			if (!label) throw new Error(`Question ${index + 1}, option ${optionIndex + 1} requires a label.`);
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
	return "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
}
