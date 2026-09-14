import { sanitizeToolText } from "../terminal-sanitize.ts";
import { sharedState } from "./shared-state.ts";

const TOOL_DISCOVERY_STATE_KEY = Symbol.for("pi-claudify:tool-discovery-state");
const CORE_TOOL_OVERRIDES = new Set(["read", "bash", "grep", "find", "ls", "write", "edit"]);
const OPENAI_STYLE_TOOL_NAMES = new Set([
	"apply_patch", "webfetch", "question", "questionnaire", "context_tag", "context_log", "context_checkout", "annotate",
	"web_search", "code_search", "fetch_content", "get_search_content", "alpha_search", "alpha_get_paper", "alpha_ask_paper",
	"alpha_annotate_paper", "alpha_list_annotations", "alpha_read_code", "Skill", "EnterPlanMode", "ExitPlanMode", "Agent",
	"get_subagent_result", "steer_subagent", "TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "TaskOutput", "TaskStop", "TaskExecute",
]);

interface ToolDiscoveryState {
	mcpNames: Set<string>;
	mcpServers: Map<string, string>;
	mcpOriginals: Map<string, string>;
}
function state(): ToolDiscoveryState {
	return sharedState(TOOL_DISCOVERY_STATE_KEY, () => ({
		mcpNames: new Set(["mcp"]),
		mcpServers: new Map(),
		mcpOriginals: new Map(),
	}));
}

export function resetToolDiscovery(): void {
	const current = state();
	current.mcpNames.clear();
	current.mcpNames.add("mcp");
	current.mcpServers.clear();
	current.mcpOriginals.clear();
}

export function isMcpToolCandidate(tool: unknown): boolean {
	const record = tool as Record<string, unknown> | undefined;
	const name = typeof record?.name === "string" ? record.name : "";
	const label = typeof record?.label === "string" ? record.label : "";
	return name === "mcp" || /^mcp__/.test(name) || /^mcp\b/i.test(label);
}

export function noteMcpTool(tool: unknown): void {
	const record = tool as Record<string, unknown> | undefined;
	const name = typeof record?.name === "string" ? record.name : "";
	if (!name) return;
	const current = state();
	current.mcpNames.add(name);
	const label = typeof record?.label === "string" ? record.label : "";
	const original = /^mcp:\s*(.+)$/i.exec(label)?.[1]?.trim();
	if (!original) return;
	current.mcpOriginals.set(name, original);
	const suffix = `_${original}`;
	if (name.endsWith(suffix) && name.length > suffix.length) current.mcpServers.set(name, name.slice(0, -suffix.length));
}

export function isMcpToolName(name: unknown): boolean {
	return typeof name === "string" && name.length > 0
		&& (name === "mcp" || /^mcp__/.test(name) || state().mcpNames.has(name));
}

export function mcpToolServer(name: string): string | undefined { return state().mcpServers.get(name); }
export function mcpOriginalName(name: string): string | undefined { return state().mcpOriginals.get(name); }

export function isOpenAiToolCandidate(tool: unknown): boolean {
	const record = tool as Record<string, unknown> | undefined;
	const name = typeof record?.name === "string" ? record.name : "";
	return !!name && !CORE_TOOL_OVERRIDES.has(name) && !isMcpToolCandidate(tool) && OPENAI_STYLE_TOOL_NAMES.has(name);
}

export function shouldUseGenericToolRenderer(name: unknown): boolean {
	return typeof name === "string" && name.length > 0 && !CORE_TOOL_OVERRIDES.has(name);
}

export function humanizeToolName(name: string): string {
	if (name === "webfetch") return "Fetch";
	return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function genericToolLabel(name: string): string {
	return sanitizeToolText(isMcpToolName(name) ? "MCP" : humanizeToolName(name));
}
