import { sanitizeToolContent } from "../terminal-sanitize.ts";

export const TASK_TOOL_NAMES = ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate"] as const;
export type TaskToolName = (typeof TASK_TOOL_NAMES)[number];
const TASK_TOOL_NAME_MAP = new Map(TASK_TOOL_NAMES.map((name) => [name.toLowerCase(), name] as const));

export type TaskStatus = "pending" | "in_progress" | "completed";
export interface TaskViewRecord {
	id: string;
	subject: string;
	description: string;
	activeForm: string;
	status: TaskStatus;
	owner?: string;
	blocks: string[];
	blockedBy: string[];
	active?: boolean;
}

export function normalizeTaskToolName(value: unknown): TaskToolName | undefined {
	return typeof value === "string" ? TASK_TOOL_NAME_MAP.get(value.toLowerCase()) : undefined;
}

export function isTaskToolName(value: unknown): value is TaskToolName {
	return normalizeTaskToolName(value) !== undefined;
}

export function taskPresentationEnvironmentEnabled(value: unknown): boolean {
	return value !== "0";
}

function parseTaskStatus(value: unknown): TaskStatus | undefined {
	return value === "pending" || value === "completed" || value === "in_progress" ? value : undefined;
}
export function normalizeTaskStatus(value: unknown): TaskStatus {
	return parseTaskStatus(value) ?? "pending";
}

export function parseTaskListText(text: string): TaskViewRecord[] {
	const tasks: TaskViewRecord[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = sanitizeToolContent(raw).trim();
		if (!line) continue;
		const match = line.match(/^#([^\s]+)\s+\[([^\]]+)\]\s+(.+?)(?:\s+\(([A-Za-z0-9_.-]+)\))?(?:\s+\[blocked by\s+([^\]]+)\])?$/i);
		if (!match || !parseTaskStatus(match[2])) return [];
		const blockers = match[5]?.match(/#([^,\s]+)/g)?.map((value) => value.slice(1)) ?? [];
		tasks.push({
			id: match[1],
			status: parseTaskStatus(match[2])!,
			subject: match[3].trim(),
			description: "",
			activeForm: match[3].trim(),
			owner: match[4]?.trim() || undefined,
			blocks: [],
			blockedBy: blockers,
		});
	}
	return tasks;
}

