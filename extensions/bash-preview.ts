import { sanitizeToolText } from "./terminal-sanitize.ts";

/** Full audit text when expanded; clipped one-line summary when collapsed. */
export function bashHeaderCommand(command: unknown, expanded: boolean, maxCollapsed = 72): string {
	const safe = sanitizeToolText(command);
	// Expanded is an audit view: even leading/trailing spaces can be meaningful
	// (`foo\\ ` differs from `foo\\`). Collapsed keeps the historical trim.
	if (expanded) return safe;
	const collapsed = safe.trim();
	if (collapsed.length <= maxCollapsed) return collapsed;
	return `${collapsed.slice(0, Math.max(0, maxCollapsed - 3))}...`;
}
