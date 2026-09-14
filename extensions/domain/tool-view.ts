import { sanitizeToolText } from "../terminal-sanitize.ts";

export type SearchToolName = "grep" | "find" | "ls";

export interface SearchCallView {
	kind: SearchToolName;
	label: "Grep" | "Find" | "List";
	summary: string;
	pendingLabel: "Searching..." | "Finding..." | "Listing...";
	emptyLabel: "no matches" | "no files found" | "empty directory";
	itemNoun: "matches" | "files" | "entries";
}

export interface TextResultView {
	items: string[];
	raw: string;
}

function summarize(value: unknown, max: number): string {
	const oneLine = sanitizeToolText(value).replace(/\n/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

export function buildSearchCallView(
	kind: SearchToolName,
	args: Record<string, unknown> | undefined,
	shortPath: (path: string) => string,
): SearchCallView {
	if (kind === "grep" || kind === "find") {
		let summary = `"${summarize(args?.pattern, 40)}"`;
		if (args?.path) summary += ` in ${shortPath(String(args.path))}`;
		return kind === "grep"
			? { kind, label: "Grep", summary, pendingLabel: "Searching...", emptyLabel: "no matches", itemNoun: "matches" }
			: { kind, label: "Find", summary, pendingLabel: "Finding...", emptyLabel: "no files found", itemNoun: "files" };
	}
	return {
		kind,
		label: "List",
		summary: shortPath(typeof args?.path === "string" ? args.path : "."),
		pendingLabel: "Listing...",
		emptyLabel: "empty directory",
		itemNoun: "entries",
	};
}

export function buildTextResultView(result: unknown): TextResultView {
	const candidate = result as { content?: Array<{ type?: unknown; text?: unknown }> } | undefined;
	const text = candidate?.content?.find((block) => block?.type === "text" && typeof block.text === "string")?.text;
	const items = typeof text === "string" ? text.split("\n").filter((line) => line.trim().length > 0) : [];
	return { items, raw: items.join("\n") };
}
