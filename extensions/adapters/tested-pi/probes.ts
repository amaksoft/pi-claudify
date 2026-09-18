import type { CapabilityId } from "../../runtime/contracts.ts";

export interface TestedPiProbeInput {
	extensionApi?: Record<string, unknown>;
	assumeTuiContext?: boolean;
	ToolExecutionComponent?: { prototype?: object };
	Container?: { prototype?: object };
	AssistantMessageComponent?: { prototype?: object };
	UserMessageComponent?: { prototype?: object };
	CustomMessageComponent?: { prototype?: object };
	CompactionSummaryMessageComponent?: { prototype?: object };
	Loader?: { prototype?: object };
	InteractiveMode?: { prototype?: object };
}

export interface TestedPiProbeResult {
	readonly capabilities: ReadonlySet<CapabilityId>;
	readonly failures: readonly string[];
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
	if (!value || typeof value !== "object") return false;
	return methods.every((method) => typeof (value as Record<string, unknown>)[method] === "function");
}

/** Non-mutating structural probes for every private surface used by Tier 2. */
export function probeTestedPiCapabilities(input: TestedPiProbeInput): TestedPiProbeResult {
	const capabilities = new Set<CapabilityId>();
	const failures: string[] = [];
	if (typeof input.extensionApi?.registerCommand === "function") capabilities.add("public:commands"); else failures.push("public-commands");
	if (typeof input.extensionApi?.on === "function") capabilities.add("public:events"); else failures.push("public-events");
	if (typeof input.extensionApi?.registerTool === "function" && typeof input.extensionApi?.getAllTools === "function") capabilities.add("public:tools"); else failures.push("public-tools");
	if (typeof input.extensionApi?.sendUserMessage === "function") capabilities.add("public:send-user-message"); else failures.push("public-send-user-message");
	if (input.assumeTuiContext !== false) capabilities.add("public:tui"); else failures.push("public-tui");
	if (hasMethods(input.ToolExecutionComponent?.prototype, ["hasRendererDefinition", "getCallRenderer", "getResultRenderer", "updateDisplay"])) {
		capabilities.add("tested:component-renderers");
	} else failures.push("tool-component-renderers");
	if (hasMethods(input.Container?.prototype, ["render"])) capabilities.add("tested:container-composition");
	else failures.push("container-render");
	if (
		hasMethods(input.AssistantMessageComponent?.prototype, ["updateContent"])
		&& hasMethods(input.UserMessageComponent?.prototype, ["render"])
		&& hasMethods(input.CustomMessageComponent?.prototype, ["render"])
		&& hasMethods(input.CompactionSummaryMessageComponent?.prototype, ["updateDisplay"])
	) capabilities.add("tested:message-renderers");
	else failures.push("message-renderers");
	if (hasMethods(input.ToolExecutionComponent?.prototype, ["setExpanded"])) capabilities.add("tested:mouse-layout");
	else failures.push("tool-expansion");
	if (hasMethods(input.Loader?.prototype, ["updateDisplay", "start", "stop"])) capabilities.add("tested:spinner-loader");
	else failures.push("spinner-loader");
	if (hasMethods(input.InteractiveMode?.prototype, ["setExtensionWidget", "renderWidgetContainer"])) capabilities.add("tested:task-widget");
	else failures.push("task-widget");
	return Object.freeze({ capabilities, failures: Object.freeze(failures) });
}
