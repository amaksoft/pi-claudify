/**
 * Single verdict grammar for settled bash results (Phase 4 chrome split).
 *
 * Canonical decisions live here exactly once: what the verdict line says,
 * how lines are counted, when the collapsed hint shows, and how detached
 * launches are recognized. Callers map tones through their own theme —
 * formatting stays local, decisions stay here.
 *
 * Mirrors `@amaksoft/pi-bg-shell:src/engine/grammar.ts` for completion
 * blocks; that module is canonical for engine-owned messages, this one for
 * fork-owned tool rows. Keep the two in sync by porting, not importing
 * (separate published packages).
 */

export type VerdictTone = "success" | "error" | "muted" | "dim" | "warning";

export type VerdictSegment = {
	text: string;
	tone: VerdictTone;
};

export type DetachedBashOutcome = "detached-background" | "timed-out-background";

export type DetachedBashInfo = {
	outcome: DetachedBashOutcome | undefined;
	jobId?: string;
	logPath?: string;
};

/** Content lines (blank lines carry no content — matches engine counting). */
export function nonBlankLines(output: string): string[] {
	return output.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * Settled verdict segments. Read-kind keeps its semantic verb; errors name
 * the code when known; anything else is `Done (N lines)`.
 */
export function settledVerdict(input: {
	isError: boolean;
	exitCode: number | null;
	lineCount: number;
	kind?: string;
}): VerdictSegment[] {
	if (input.isError) {
		return [{ text: input.exitCode !== null ? `Exit ${input.exitCode}` : "Failed", tone: "error" }];
	}
	if (input.kind === "read") {
		return [
			{ text: "Read", tone: "success" },
			{ text: ` ${input.lineCount} line${input.lineCount === 1 ? "" : "s"}`, tone: "muted" },
		];
	}
	return [
		{ text: "Done", tone: "success" },
		{ text: ` (${input.lineCount} lines)`, tone: "muted" },
	];
}

/** Collapsed hint: muted, keyboard-only, no click text. Empty when suppressed. */
export function collapsedHint(suppress: boolean): VerdictSegment[] {
	return suppress ? [] : [{ text: " (ctrl+o to expand)", tone: "muted" }];
}

const JOB_ID_PATTERN = /^job_id: ([0-9a-f]{6})$/m;
const LOG_PATH_PATTERN = /^log_path: (\S+)$/m;

/**
 * Single detached-launch parser (was: outcome check + background-params gate
 * + identity regexes spread across call sites). A launch counts as detached
 * when the tool result carries a detached outcome, or when the tool itself
 * is background-capable and the output echoes the stable `job_id:` marker.
 * Identity requires the `log_path:` sibling — a bare job_id mention in prose
 * never detaches.
 */
export function parseDetached(
	details: unknown,
	rawOutput: string,
	toolHasBackgroundParams = false,
): DetachedBashInfo | undefined {
	const outcome = (details as { outcome?: unknown } | undefined)?.outcome;
	if (outcome === "detached-background" || outcome === "timed-out-background") {
		return { outcome, ...parseDetachedIdentity(rawOutput) };
	}
	if (!toolHasBackgroundParams) return undefined;
	const identity = parseDetachedIdentity(rawOutput);
	if (identity.logPath) {
		return { outcome: undefined, ...identity };
	}
	return undefined;
}

/**
 * Stable `job_id:`/`log_path:` identity markers from launch result text.
 * Both markers are required: our own result text always carries the pair,
 * while stray command output mentioning one marker must not detach the row.
 */
export function parseDetachedIdentity(rawOutput: string): { jobId?: string; logPath?: string } {
	const logPath = LOG_PATH_PATTERN.exec(rawOutput)?.[1];
	if (!logPath) return {};
	return { jobId: JOB_ID_PATTERN.exec(rawOutput)?.[1], logPath };
}
