const HANDOFF_GRACE_MS = 1_000;

/**
 * Keep the outgoing generation's stable host delegates alive briefly while
 * `/reload` evaluates the replacement extension. The release callback must be
 * owner-checked: once the new generation claims the registry, this delayed
 * release becomes a no-op. If no replacement arrives (package removal or
 * shutdown), the native pass-through is restored after the grace period.
 */
export function deferGenerationRelease(release: () => void, delayMs = HANDOFF_GRACE_MS): ReturnType<typeof setTimeout> {
	const timer = setTimeout(release, Math.max(0, delayMs));
	(timer as any).unref?.();
	return timer;
}
