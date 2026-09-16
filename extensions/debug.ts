import { sanitizeToolOutput, sanitizeToolText } from "./terminal-sanitize.ts";

const emittedDiagnostics = new Set<string>();

function describeError(error: unknown): string {
	if (error instanceof Error) return sanitizeToolOutput(error.stack || error.message);
	if (typeof error === "string") return sanitizeToolOutput(error);
	try { return sanitizeToolOutput(JSON.stringify(error)); } catch { return sanitizeToolOutput(String(error)); }
}

/** Opt-in, process-deduplicated diagnostics for fail-closed compatibility paths. */
export function debugDiagnostic(key: string, error: unknown, context?: string): void {
	if (process.env.PI_CLAUDIFY_DEBUG !== "1" || emittedDiagnostics.has(key)) return;
	emittedDiagnostics.add(key);
	const safeKey = sanitizeToolText(key);
	const safeContext = context ? sanitizeToolText(context) : "";
	const suffix = safeContext ? ` (${safeContext})` : "";
	console.error(`[claudify:${safeKey}]${suffix} ${describeError(error)}`);
}

export function clearDebugDiagnosticsForTest(): void {
	emittedDiagnostics.clear();
}
