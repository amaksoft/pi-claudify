import type { Theme } from "@earendil-works/pi-coding-agent";

import { extractApplyPatchFiles, getRawStringArg, getStringArg, getStringArrayArg, getTextContent } from "../domain/tool-arguments.ts";
import { humanizeToolName } from "../host/tool-discovery.ts";
import { sanitizeToolOutput, sanitizeToolText } from "../terminal-sanitize.ts";

export interface OpenAiToolRuntime {
	makeText(last: unknown, text: string): any;
	withBranch(content: string, theme: Theme): string;
	startBlink(ctx: any): void;
	stopBlink(ctx: any): void;
	setStatus(ctx: any, status: "pending" | "success" | "error"): void;
	buildPreview(lines: string[], expanded: boolean, theme: Theme, collapsedRows: number): string;
	previewRows(): number;
	summarize(text: string, max: number): string;
}

export function summarizeOpenAiToolCall(
	name: string,
	args: any,
	theme: Theme,
	shortPath: (path: string) => string,
	summarize: (text: string, max: number) => string,
): string {
	switch (name) {
		case "apply_patch": {
			const files = extractApplyPatchFiles(getRawStringArg(args, "patchText", "patch_text"));
			if (files.length === 0) return theme.fg("muted", "patch");
			return files.length === 1 ? shortPath(files[0]) : `${shortPath(files[0])} ${theme.fg("muted", `(+${files.length - 1} files)`)}`;
		}
		case "webfetch": return getStringArg(args, "url") || theme.fg("muted", "fetch page");
		case "fetch_content": {
			const url = getStringArg(args, "url");
			if (url) return url;
			const urls = getStringArrayArg(args, "urls");
			if (urls.length === 0) return theme.fg("muted", "fetch content");
			return urls.length === 1 ? urls[0] : `${urls[0]} ${theme.fg("muted", `(+${urls.length - 1} urls)`)}`;
		}
		case "get_search_content": return getStringArg(args, "responseId", "response_id") || theme.fg("muted", "load cached content");
		case "web_search": {
			const query = getStringArg(args, "query");
			if (query) return `"${summarize(query, 72)}"`;
			const queries = getStringArrayArg(args, "queries");
			if (queries.length === 0) return theme.fg("muted", "search web");
			return queries.length === 1 ? summarize(queries[0], 72) : `${summarize(queries[0], 48)} ${theme.fg("muted", `(+${queries.length - 1} queries)`)}`;
		}
		case "code_search": return summarize(getStringArg(args, "query") || "search code", 72);
		case "question": return summarize(getStringArg(args, "question") || "ask user", 72);
		case "questionnaire": return Array.isArray(args?.questions) && args.questions.length > 0 ? `${args.questions.length} questions` : theme.fg("muted", "questionnaire");
		case "context_tag": return getStringArg(args, "name") || theme.fg("muted", "save point");
		case "context_log": return theme.fg("muted", "history");
		case "context_checkout": return getStringArg(args, "target") || theme.fg("muted", "checkout context");
		case "annotate": return getStringArg(args, "url") || theme.fg("muted", "current tab");
		case "alpha_search": return summarize(getStringArg(args, "query") || "search papers", 72);
		case "alpha_get_paper": case "alpha_ask_paper": case "alpha_annotate_paper": return getStringArg(args, "paper") || theme.fg("muted", "paper");
		case "alpha_read_code": return getStringArg(args, "githubUrl", "github_url") || theme.fg("muted", "repository");
		case "Skill": return getStringArg(args, "name") || theme.fg("muted", "run skill");
		case "EnterPlanMode": return theme.fg("muted", "enable read-only planning");
		case "ExitPlanMode": return theme.fg("muted", "present plan");
		case "Agent": return summarize(getStringArg(args, "description", "prompt") || "launch agent", 72);
		case "get_subagent_result": return getStringArg(args, "agent_id") || theme.fg("muted", "agent result");
		case "steer_subagent": return getStringArg(args, "agent_id") || theme.fg("muted", "steer agent");
		case "TaskCreate": return summarize(getStringArg(args, "subject") || "create task", 72);
		case "TaskList": return theme.fg("muted", "task list");
		case "TaskGet": case "TaskUpdate": return getStringArg(args, "taskId", "task_id") || theme.fg("muted", "task");
		case "TaskOutput": case "TaskStop": return getStringArg(args, "task_id", "taskId") || theme.fg("muted", "background task");
		case "TaskExecute": {
			const ids = getStringArrayArg(args, "task_ids", "taskIds");
			if (ids.length === 0) return theme.fg("muted", "start tasks");
			return ids.length === 1 ? ids[0] : `${ids[0]} ${theme.fg("muted", `(+${ids.length - 1} tasks)`)}`;
		}
		default:
			return summarize(getStringArg(args, "path", "file_path", "url", "query", "name", "subject", "tool", "description", "prompt") || humanizeToolName(name), 72);
	}
}

interface TaskLine { id: string; status: string; subject: string }
function parseTask(line: string): TaskLine | null {
	const match = line.match(/^#(\d+) \[([^\]]+)\] (.+)$/);
	return match ? { id: match[1], status: match[2], subject: match[3] } : null;
}
function taskStatus(status: string, theme: Theme): string {
	if (status === "completed") return theme.fg("success", status);
	if (status === "in_progress") return theme.fg("warning", status);
	return theme.fg("muted", status);
}
function successLine(name: string, line: string, theme: Theme): string {
	const text = line.trim();
	if (!text) return theme.fg("success", "Done");
	if (name === "TaskCreate") {
		const match = text.match(/^Task #(\d+) created successfully: (.+)$/);
		if (match) return `${theme.fg("success", "Created task")} ${theme.fg("accent", `#${match[1]}`)} ${theme.fg("muted", match[2])}`;
	}
	if (name === "TaskUpdate") {
		const match = text.match(/^Updated task #(\d+) (.+)$/);
		if (match) return `${theme.fg("success", "Updated task")} ${theme.fg("accent", `#${match[1]}`)} ${theme.fg("muted", match[2])}`;
	}
	if (name === "TaskExecute") return `${theme.fg("success", "Started")} ${theme.fg("muted", text)}`;
	if (name === "context_tag") {
		const match = text.match(/^Created tag '([^']+)' at (.+)$/);
		if (match) return `${theme.fg("success", "Created tag")} ${theme.fg("accent", match[1])} ${theme.fg("muted", match[2])}`;
	}
	if (name === "context_checkout") return `${theme.fg("success", "Checked out")} ${theme.fg("muted", text.replace(/^Checked out\s*/i, ""))}`;
	if (name === "TaskStop") return `${theme.fg("success", "Stopped")} ${theme.fg("muted", text)}`;
	return theme.fg("muted", text);
}
function renderTaskList(runtime: OpenAiToolRuntime, lines: string[], expanded: boolean, theme: Theme, ctx: any): any {
	const tasks = lines.map(parseTask).filter((task): task is TaskLine => task !== null);
	if (tasks.length === 0) {
		const text = lines.length === 0 ? theme.fg("muted", "no tasks") : runtime.buildPreview(lines.map((line) => theme.fg("dim", line)), expanded, theme, runtime.previewRows());
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(text, theme));
	}
	const pending = tasks.filter((task) => task.status === "pending").length;
	const inProgress = tasks.filter((task) => task.status === "in_progress").length;
	const completed = tasks.filter((task) => task.status === "completed").length;
	let summary = theme.fg("muted", `${tasks.length} tasks`);
	const parts: string[] = [];
	if (inProgress) parts.push(`${theme.fg("warning", String(inProgress))} in progress`);
	if (pending) parts.push(`${theme.fg("muted", String(pending))} pending`);
	if (completed) parts.push(`${theme.fg("success", String(completed))} completed`);
	if (parts.length) summary += ` ${theme.fg("muted", "•")} ${parts.join(` ${theme.fg("muted", "•")} `)}`;
	if (!expanded) return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${summary}${theme.fg("muted", " (ctrl+o to expand)")}`, theme));
	const shown = tasks.slice(0, runtime.previewRows());
	const preview = shown.map((task) => `${theme.fg("accent", `#${task.id}`)} ${taskStatus(task.status, theme)} ${theme.fg("dim", task.subject)}`);
	if (tasks.length > shown.length) preview.push(theme.fg("muted", `… ${tasks.length - shown.length} more tasks`));
	return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${summary}\n${preview.join("\n")}`, theme));
}

function capturedResult(name: string, result: any, theme: Theme, ctx: any): string | undefined {
	if (ctx.isError) return undefined;
	if (name === "webfetch") return theme.fg("muted", `Received ${Buffer.byteLength(getTextContent(result), "utf8")} bytes`);
	if (name === "web_search") {
		const count = getStringArg(ctx.args, "query") ? 1 : getStringArrayArg(ctx.args, "queries").length;
		return count > 0 ? theme.fg("muted", `Did ${count} search${count === 1 ? "" : "es"}`) : theme.fg("success", "Done");
	}
	if (name === "Agent") return theme.fg("success", "Done");
	return undefined;
}

export function renderOpenAiToolResult(runtime: OpenAiToolRuntime, name: string, result: any, expanded: boolean, isPartial: boolean, theme: Theme, ctx: any): any {
	if (isPartial) {
		if (name === "Agent") return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("dim", "Initializing…"), theme));
		runtime.startBlink(ctx);
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("dim", `${humanizeToolName(name)}...`), theme));
	}
	runtime.stopBlink(ctx);
	runtime.setStatus(ctx, ctx.isError ? "error" : "success");
	const raw = sanitizeToolOutput(getTextContent(result)).trim();
	const lines = raw ? raw.split("\n") : [];
	const patchFiles = Array.isArray(ctx.state?._openAiPatchFiles) ? ctx.state._openAiPatchFiles : [];
	const captured = capturedResult(name, result, theme, ctx);
	if (captured !== undefined) return runtime.makeText(ctx.lastComponent, runtime.withBranch(captured, theme));
	if (lines.length === 0) {
		if (patchFiles.length > 0) {
			const suffix = patchFiles.length === 1 ? sanitizeToolText(patchFiles[0]) : `${patchFiles.length} files`;
			return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${theme.fg(ctx.isError ? "error" : "success", ctx.isError ? "Failed" : "Applied")} ${theme.fg("muted", suffix)}`, theme));
		}
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg(ctx.isError ? "error" : "success", ctx.isError ? "Failed" : "Done"), theme));
	}
	if (!ctx.isError && name === "TaskList") return renderTaskList(runtime, lines, expanded, theme, ctx);
	const status = ctx.isError ? theme.fg("error", lines[0]) : theme.fg("muted", `${lines.length} line${lines.length === 1 ? "" : "s"} returned`);
	if (!expanded) return runtime.makeText(ctx.lastComponent, runtime.withBranch(status, theme));
	if (!ctx.isError && lines.length === 1) return runtime.makeText(ctx.lastComponent, runtime.withBranch(successLine(name, lines[0], theme), theme));
	const preview = lines.length === 1 ? theme.fg(ctx.isError ? "error" : "dim", lines[0]) : runtime.buildPreview(lines.map((line) => theme.fg(ctx.isError ? "error" : "dim", line || " ")), true, theme, runtime.previewRows());
	return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${status}\n${preview}`, theme));
}
