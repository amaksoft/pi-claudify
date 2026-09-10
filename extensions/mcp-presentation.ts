import { sanitizeToolText } from "./terminal-sanitize.ts";

/** Keys that address an MCP call rather than parameterise it. */
const MCP_ROUTING_KEYS = new Set(["tool", "args", "server", "connect", "search", "action", "describe"]);

function renderParameterValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return "";
		// Proxy mode sends "{}" for a no-parameter call: an empty envelope, not a
		// parameter worth a slot in the header.
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
		} catch {
			// Malformed JSON is still evidence of what the model sent; show it.
		}
		return trimmed;
	}
	try {
		const json = JSON.stringify(value);
		return !json || json === "{}" || json === "[]" ? "" : json;
	} catch {
		return "";
	}
}

/**
 * Effective MCP parameters as one terminal-safe line.
 *
 * Proxy mode carries parameters as a JSON string in args.args. Direct mode
 * passes the argument object itself. Routing keys never appear as parameters.
 */
export function mcpCallArgsText(name: string, args: unknown): string {
	const record = (args ?? {}) as Record<string, unknown>;
	let text: string;
	if (name === "mcp") {
		text = renderParameterValue(record.args);
		if (!text) {
			const parameters: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(record)) {
				if (!MCP_ROUTING_KEYS.has(key)) parameters[key] = value;
			}
			text = renderParameterValue(parameters);
		}
	} else {
		text = renderParameterValue(record);
	}
	// sanitizeToolText folds actual row-breaking controls but preserves ordinary
	// spaces inside JSON string values. Those spaces may be executable input.
	return sanitizeToolText(text);
}
