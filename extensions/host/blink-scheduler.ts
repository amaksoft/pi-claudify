import type { Theme } from "@earendil-works/pi-coding-agent";

export interface BlinkContext {
	state?: any;
	invalidate?: () => void;
}

interface BlinkEntry {
	key: any;
	order: number;
	invalidate: () => void;
}

/** One bounded timer drives every visible pending tool row. */
export class BlinkScheduler {
	private readonly contexts = new Map<any, BlinkEntry>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private order = 0;
	private phase = true;

	constructor(
		private readonly maxActive = 5,
		private readonly intervalMs = 500,
	) {}

	private key(ctx: BlinkContext): any { return ctx?.state ?? ctx; }
	private activeEntries(): BlinkEntry[] {
		return [...this.contexts.values()].sort((a, b) => b.order - a.order).slice(0, this.maxActive);
	}
	private updateActive(skip?: any): void {
		const active = new Set(this.activeEntries().map((entry) => entry.key));
		for (const entry of this.contexts.values()) {
			const enabled = active.has(entry.key);
			if (entry.key?._blinkActive === enabled) continue;
			entry.key._blinkActive = enabled;
			if (entry.key !== skip) { try { entry.invalidate(); } catch { /* host is leaving */ } }
		}
	}
	private schedule(): void {
		if (this.timer || this.contexts.size === 0) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.contexts.size === 0) { this.updateActive(); return; }
			this.phase = !this.phase;
			for (const entry of this.activeEntries()) { try { entry.invalidate(); } catch { /* host is leaving */ } }
			this.schedule();
		}, this.intervalMs);
		(this.timer as any).unref?.();
	}
	private stopIfEmpty(): void {
		if (this.timer && this.contexts.size === 0) { clearTimeout(this.timer); this.timer = undefined; }
	}

	start(ctx: BlinkContext): void {
		const key = this.key(ctx);
		if (!key) return;
		const invalidate = typeof ctx?.invalidate === "function" ? () => ctx.invalidate!() : () => {};
		const existing = this.contexts.get(key);
		if (existing) { existing.invalidate = invalidate; return; }
		this.contexts.set(key, { key, order: ++this.order, invalidate });
		key._blinkActive = false;
		this.updateActive(key);
		this.schedule();
	}

	stop(ctx: BlinkContext): void {
		const key = this.key(ctx);
		if (!key) return;
		this.contexts.delete(key);
		key._blinkActive = false;
		this.updateActive();
		this.stopIfEmpty();
		this.schedule();
	}

	isBright(ctx: BlinkContext): boolean {
		this.start(ctx);
		return this.key(ctx)?._blinkActive === true && this.phase;
	}

	clear(): void {
		for (const entry of this.contexts.values()) entry.key._blinkActive = false;
		this.contexts.clear();
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	trackedCount(): number { return this.contexts.size; }
}
