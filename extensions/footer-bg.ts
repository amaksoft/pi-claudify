import type { FooterSegment, FooterSegmentFactory, FooterSegmentInput } from "./footer.ts";

/**
 * Background-jobs statusline segment (bg-shell track).
 *
 * Track-owned: the footer core never names background jobs. It registers
 * itself during activation (see index.ts) and reads only the stable engine
 * status-key contract below, so future tracks follow the same shape without
 * touching footer.ts.
 */

/** bg-shell engine status key (stable contract). */
export const BACKGROUND_BASH_STATUS_KEY = "backgroundBashTmuxCommands";

/** Flash lifetime for the `← N done` segment. */
export const BG_DONE_FLASH_TTL_MS = 6_000;

const parseBackgroundCount = (value: string | undefined): number | undefined => {
	const match = /^\s*(\d+)\s+background proc/.exec(value ?? "");
	if (!match) return undefined;
	const count = Number.parseInt(match[1], 10);
	return Number.isFinite(count) ? count : undefined;
};

class BackgroundJobsSegment implements FooterSegment {
	private lastBackgroundCount: number | null = null;
	private flashCount = 0;
	private flashUntil = 0;
	private flashTimer?: ReturnType<typeof setTimeout>;

	constructor(private readonly requestRender?: () => void) {}

	private updateFlash(count: number | undefined): void {
		const previous = this.lastBackgroundCount;
		// Absent key means zero live jobs (the engine clears it on last exit).
		const now = count ?? 0;
		this.lastBackgroundCount = now;
		if (previous === null || now >= previous) return;
		const done = previous - now;
		if (done <= 0) return;
		this.flashCount = done;
		this.flashUntil = Date.now() + BG_DONE_FLASH_TTL_MS;
		if (this.flashTimer) clearTimeout(this.flashTimer);
		if (this.requestRender) {
			this.flashTimer = setTimeout(() => this.requestRender?.(), BG_DONE_FLASH_TTL_MS + 250);
			this.flashTimer.unref?.();
		}
	}

	private freshFlash(): number | undefined {
		if (this.flashUntil === 0 || Date.now() > this.flashUntil) {
			this.flashUntil = 0;
			return undefined;
		}
		return this.flashCount;
	}

	private count(input: FooterSegmentInput): number | undefined {
		if (!input.settings.bgJobs) return undefined;
		return parseBackgroundCount(input.statuses.get(BACKGROUND_BASH_STATUS_KEY));
	}

	private reset(): void {
		this.flashUntil = 0;
		this.lastBackgroundCount = null;
		if (this.flashTimer) clearTimeout(this.flashTimer);
		this.flashTimer = undefined;
	}

	render(input: FooterSegmentInput): string | null {
		if (!input.settings.bgJobs) {
			this.reset();
			return null;
		}
		const count = this.count(input);
		this.updateFlash(count);
		const flash = this.freshFlash();
		if (typeof flash === "number") return input.paint(input.palette.usageLevels[0], `← ${flash} done`);
		if (typeof count === "number" && count > 0) return input.paint(input.palette.separator, `Bg: ${count}`);
		return null;
	}

	consumeStatus(key: string, value: string, input: FooterSegmentInput): boolean {
		return input.settings.bgJobs && key === BACKGROUND_BASH_STATUS_KEY && parseBackgroundCount(value) !== undefined;
	}

	dispose(): void {
		if (this.flashTimer) clearTimeout(this.flashTimer);
		this.flashTimer = undefined;
	}
}

export const backgroundJobsSegmentFactory: FooterSegmentFactory = {
	id: "background-jobs",
	create: (requestRender?: () => void) => new BackgroundJobsSegment(requestRender),
};
