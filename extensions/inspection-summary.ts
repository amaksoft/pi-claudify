/**
 * Phrasing for grouped read-only tool calls.
 *
 * Claude Code aggregates read-only tools under one gerund header while they run
 * ("⏺ Searching for 1 pattern, reading 2 files, running 1 shell command…") and
 * collapses the block to a past-tense summary once the turn ends
 * ("Read 1 file, ran 1 shell command").
 *
 * Grammar captured in docs/plans/2026-07-13-current-cc-grammar.md.
 */

export type InspectionKind = "grep" | "find" | "ls" | "read" | "bash" | "mcp";

interface ClauseForms {
	/** While running: "searching for 2 patterns". */
	active: (count: number) => string;
	/** After the turn: "searched for 2 patterns". */
	done: (count: number) => string;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Clause order is fixed, not call order — Claude Code always reads
 * "Searching for 1 pattern, reading 2 files, running 1 shell command…".
 */
// Captured: "Searching for 1 pattern, reading 1 file, listing 1 directory, calling
// probe, running 1 shell command…" — MCP sits after the file tools, before bash.
const CLAUSE_ORDER: InspectionKind[] = ["grep", "find", "read", "ls", "mcp", "bash"];

const CLAUSES: Record<InspectionKind, ClauseForms> = {
	grep: {
		active: (n) => `searching for ${plural(n, "pattern")}`,
		done: (n) => `searched for ${plural(n, "pattern")}`,
	},
	find: {
		active: (n) => `finding ${plural(n, "file")}`,
		done: (n) => `found ${plural(n, "file")}`,
	},
	ls: {
		active: (n) => `listing ${plural(n, "directory", "directories")}`,
		done: (n) => `listed ${plural(n, "directory", "directories")}`,
	},
	read: {
		active: (n) => `reading ${plural(n, "file")}`,
		done: (n) => `read ${plural(n, "file")}`,
	},
	bash: {
		active: (n) => `running ${plural(n, "shell command")}`,
		done: (n) => `ran ${plural(n, "shell command")}`,
	},
	// Placeholder: the MCP clause names the servers it called, so it is built from
	// mcpServers rather than from a bare count. See mcpClause().
	mcp: {
		active: () => "",
		done: () => "",
	},
};

// Named bash variant: single calls name the work ("ran pytest auth"),
// multiples keep the count, dedupe identical runs ("sleep 30s ×10"), and
// mark partial lists ("ran 3 shell commands: a, b, …"). The active form
// skips its own ellipsis — describeInspectionsActive ends every header
// with one.
const BASH_NAMED_CLAUSES: Record<"active" | "done", (n: number, labels: string[]) => string> = {
	active: (n, labels) =>
		n === 1 && labels.length === 1 ? `running ${labels[0]}` : `running ${plural(n, "shell command")}: ${namedList(n, labels, false)}`,
	done: (n, labels) =>
		n === 1 && labels.length === 1 ? `ran ${labels[0]}` : `ran ${plural(n, "shell command")}: ${namedList(n, labels, true)}`,
};

function namedList(n: number, labels: string[], terminalEllipsis: boolean): string {
	const unique = [...new Set(labels)];
	if (unique.length === 1) return `${unique[0]} ×${n}`;
	const shown = unique.slice(0, 2).join(", ");
	const partial = unique.length > 2 || n > unique.length;
	return partial && terminalEllipsis ? `${shown}, …` : shown;
}

/**
 * `calling openosint, forgejo, obsidian, plane 6 times` — servers deduplicated in
 * first-seen order, the count being the number of *calls*, omitted when it is 1.
 * Grammar: docs/plans/2026-07-13-mcp-grammar.md
 */
function mcpClause(verb: string, count: number, servers: string[]): string {
	const named = [...new Set(servers.filter((server) => server.length > 0))];
	const subject = named.length > 0 ? named.join(", ") : plural(count, "MCP tool");
	return count > 1 ? `${verb} ${subject} ${count} times` : `${verb} ${subject}`;
}

function capitalize(text: string): string {
	return text.length === 0 ? text : `${text[0].toUpperCase()}${text.slice(1)}`;
}

function countByKind(kinds: InspectionKind[]): Map<InspectionKind, number> {
	const counts = new Map<InspectionKind, number>();
	for (const kind of kinds) {
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	return counts;
}

/** A track-owned source of group labels. Tracks register providers during
 * activation instead of editing the render call sites: the settled/active
 * renderers compose every provider, so a new label family never touches
 * inspection-render.ts. Each non-empty provider list renders as one clause. */
export interface InspectionLabelProvider {
	readonly id: string;
	labelsFor(group: unknown[]): string[];
}

const inspectionLabelProviders: InspectionLabelProvider[] = [];

export function registerInspectionLabelProvider(provider: InspectionLabelProvider): void {
	const at = inspectionLabelProviders.findIndex((entry) => entry.id === provider.id);
	if (at >= 0) inspectionLabelProviders[at] = provider;
	else inspectionLabelProviders.push(provider);
}

export function inspectionExtraLabels(group: unknown[]): string[] {
	const labels: string[] = [];
	for (const provider of inspectionLabelProviders) {
		try {
			labels.push(...provider.labelsFor(group));
		} catch {
			// A failing provider must never blank the group header.
		}
	}
	return labels;
}

function joinClauses(
	kinds: InspectionKind[],
	form: keyof ClauseForms,
	mcpServers: string[],
	extraLabels: string[] = [],
): string {
	const counts = countByKind(kinds);
	const clauses = CLAUSE_ORDER.filter((kind) => counts.has(kind)).map((kind) => {
		const count = counts.get(kind) as number;
		if (kind === "mcp") return mcpClause(form === "active" ? "calling" : "called", count, mcpServers);
		if (kind === "bash" && extraLabels.length > 0) return BASH_NAMED_CLAUSES[form](count, extraLabels);
		return CLAUSES[kind][form](count);
	});
	return capitalize(clauses.join(", "));
}

/** Header shown while the grouped tools are still running. Ends in an ellipsis.
 * extraLabels carries provider-composed labels (see inspectionExtraLabels).
 * Tracks add label families by registering a provider, never by widening
 * this signature. */
export function describeInspectionsActive(
	kinds: InspectionKind[],
	mcpServers: string[] = [],
	extraLabels: string[] = [],
): string {
	if (kinds.length === 0) return "";
	return `${joinClauses(kinds, "active", mcpServers, extraLabels)}…`;
}

/** Collapsed summary shown once the turn ends. No ellipsis, no bullet.
 * extraLabels: see describeInspectionsActive. */
export function describeInspectionsDone(
	kinds: InspectionKind[],
	mcpServers: string[] = [],
	extraLabels: string[] = [],
): string {
	if (kinds.length === 0) return "";
	return joinClauses(kinds, "done", mcpServers, extraLabels);
}
