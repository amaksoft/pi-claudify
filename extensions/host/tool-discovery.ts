import { testedPiPatchBroker } from "../adapters/tested-pi/patch-broker.ts";
import { isTaskToolName } from "../domain/task-view.ts";
import { sanitizeToolText } from "../terminal-sanitize.ts";

const SURFACE = "tool-discovery";
const DEFAULT_OWNER = {};
const EMPTY_STATE: ToolDiscoveryState = { mcpNames: new Set(["mcp"]), mcpServers: new Map(), mcpOriginals: new Map() };
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
function createState(): ToolDiscoveryState {
	return { mcpNames: new Set(["mcp"]), mcpServers: new Map(), mcpOriginals: new Map() };
}
function state(owner: object = DEFAULT_OWNER): ToolDiscoveryState {
	let current = testedPiPatchBroker.owned<ToolDiscoveryState>(owner, SURFACE);
	if (!current) {
		current = createState();
		testedPiPatchBroker.bind(owner, SURFACE, current);
	}
	return current;
}
function activeState(): ToolDiscoveryState {
	return testedPiPatchBroker.active<ToolDiscoveryState>(SURFACE) ?? EMPTY_STATE;
}

export function resetToolDiscovery(owner?: object): void {
	if (owner === undefined) testedPiPatchBroker.clearSurface(SURFACE);
	const current = state(owner);
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

export function noteMcpTool(tool: unknown, owner?: object): void {
	const record = tool as Record<string, unknown> | undefined;
	const name = typeof record?.name === "string" ? record.name : "";
	if (!name) return;
	const current = state(owner);
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
		&& (name === "mcp" || /^mcp__/.test(name) || activeState().mcpNames.has(name));
}

export function mcpToolServer(name: string): string | undefined { return activeState().mcpServers.get(name); }
export function mcpOriginalName(name: string): string | undefined { return activeState().mcpOriginals.get(name); }
export function releaseToolDiscovery(owner?: object): void {
	if (owner === undefined) testedPiPatchBroker.clearSurface(SURFACE);
	else testedPiPatchBroker.releaseSurface(owner, SURFACE);
}

export function isOpenAiToolCandidate(tool: unknown): boolean {
	const record = tool as Record<string, unknown> | undefined;
	const name = typeof record?.name === "string" ? record.name : "";
	return !!name && !CORE_TOOL_OVERRIDES.has(name) && !isMcpToolCandidate(tool) && (isTaskToolName(name) || OPENAI_STYLE_TOOL_NAMES.has(name));
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
