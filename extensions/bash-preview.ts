import { encodeCommandAuditText, sanitizeToolText } from "./terminal-sanitize.ts";

/** Full audit text when expanded; clipped one-line summary when collapsed. */
export function bashHeaderCommand(command: unknown, expanded: boolean, maxCollapsed = 72): string {
	// Expanded is a non-destructive audit view: even printable bytes inside a
	// terminal control envelope and leading/trailing spaces can be executable.
	if (expanded) return encodeCommandAuditText(command);
	const safe = sanitizeToolText(command);
	// Collapsed keeps the historical trim and one-line terminal-safe summary.
	const collapsed = safe.trim();
	if (collapsed.length <= maxCollapsed) return collapsed;
	return `${collapsed.slice(0, Math.max(0, maxCollapsed - 3))}...`;
}
