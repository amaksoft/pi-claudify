import { Text, type Component } from "@earendil-works/pi-tui";

import { debugDiagnostic } from "./debug.ts";

export type DiffCardBuild = (width: number) => Promise<string>;
export type DiffCardTextRenderer = (text: string, width: number) => string[];
export type DiffCardPresentationEpoch = () => unknown;

let globalPresentationEpoch = 0;
export function getDiffPresentationEpoch(): number {
	return globalPresentationEpoch;
}
export function bumpDiffPresentationEpoch(): void {
	globalPresentationEpoch += 1;
}

type DiffCardIdentity = {
	generation: number;
	width: number;
	epoch: unknown;
};

type DiffCardRequest = {
	identity: DiffCardIdentity;
	build: DiffCardBuild;
	failureText: string;
	textRenderer: DiffCardTextRenderer;
	key: string;
};

type DiffCardCacheEntry = {
	epoch: unknown;
	rows: string[];
};

/**
 * Width-aware async text component for syntax-highlighted diff bodies.
 *
 * renderResult has no viewport width, so pre-rendering into ctx.state permanently
 * bakes in process.stdout.columns. This component retains source/build inputs and
 * recomputes for each width passed by pi. Async completions are generation-guarded
 * and request a host repaint without discarding already-built width variants.
 */
export class DiffCardComponent implements Component {
	diffKey = "";
	private build: DiffCardBuild = async () => "";
	private placeholder = "";
	private onReady: () => void = () => {};
	private textRenderer: DiffCardTextRenderer = (text, width) => new Text(text, 0, 0).render(width);
	private failureText = "";
	private presentationEpoch: DiffCardPresentationEpoch = getDiffPresentationEpoch;
	private generation = 0;
	private preserveNextInvalidate = false;
	private readonly cache = new Map<number, DiffCardCacheEntry>();
	private staleRows: { width: number; rows: string[] } | undefined;
	private active: DiffCardRequest | undefined;
	private queued: DiffCardRequest | undefined;
	private latest: DiffCardIdentity | undefined;

	configure(
		key: string,
		placeholder: string,
		build: DiffCardBuild,
		onReady: () => void,
		textRenderer?: DiffCardTextRenderer,
		failureText?: string,
		presentationEpoch?: DiffCardPresentationEpoch,
	): void {
		if (this.diffKey !== key) {
			const previousIdentity = this.latest;
			const previous = previousIdentity ? this.cachedRows(previousIdentity) : undefined;
			if (previous && previousIdentity) this.staleRows = { width: previousIdentity.width, rows: previous };
			this.diffKey = key;
			this.generation++;
			this.cache.clear();
			this.queued = undefined;
			this.latest = undefined;
			this.preserveNextInvalidate = false;
		}
		this.placeholder = placeholder;
		this.build = build;
		this.onReady = onReady;
		if (textRenderer) this.textRenderer = textRenderer;
		this.failureText = failureText ?? placeholder;
		this.presentationEpoch = presentationEpoch ?? getDiffPresentationEpoch;
	}

	private sameIdentity(left: DiffCardIdentity | undefined, right: DiffCardIdentity | undefined): boolean {
		return !!left
			&& !!right
			&& left.generation === right.generation
			&& left.width === right.width
			&& Object.is(left.epoch, right.epoch);
	}

	private cachedRows(identity: DiffCardIdentity): string[] | undefined {
		const cached = this.cache.get(identity.width);
		return cached && Object.is(cached.epoch, identity.epoch) ? cached.rows : undefined;
	}

	private cacheRows(identity: DiffCardIdentity, rows: string[]): void {
		// Reinsert replacement entries so eviction remains insertion ordered.
		this.cache.delete(identity.width);
		this.cache.set(identity.width, { epoch: identity.epoch, rows });
		if (this.cache.size > 6) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) this.cache.delete(oldest);
		}
	}

	private diagnose(error: unknown, key: string): void {
		try {
			debugDiagnostic("diff-card", error, key);
		} catch {
			// Diagnostics must never break rendering or leave the scheduler occupied.
		}
	}

	private notifyReady(key: string): void {
		// ctx.invalidate() normally synchronously calls invalidate() on this card.
		// If the notifier itself throws before doing so, do not let its preservation
		// token swallow a later, unrelated invalidation.
		this.preserveNextInvalidate = true;
		try {
			this.onReady();
		} catch (error) {
			if (this.preserveNextInvalidate) this.preserveNextInvalidate = false;
			this.diagnose(error, key);
		}
	}

	private finishRequest(request: DiffCardRequest, succeeded: boolean, value: unknown): void {
		if (this.active !== request) return;
		try {
			const relevant = request.identity.generation === this.generation
				&& this.sameIdentity(request.identity, this.latest);
			if (relevant) {
				if (!succeeded) this.diagnose(value, request.key);
				const text = succeeded ? value as string : request.failureText;
				const rows = request.textRenderer(text, request.identity.width);
				this.cacheRows(request.identity, rows);
				this.staleRows = undefined;
				this.notifyReady(request.key);
			}
		} catch (error) {
			this.diagnose(error, request.key);
		} finally {
			if (this.active === request) this.active = undefined;
			const next = this.queued;
			this.queued = undefined;
			if (
				next
				&& next.identity.generation === this.generation
				&& this.sameIdentity(next.identity, this.latest)
				&& !this.cachedRows(next.identity)
			) {
				this.startRequest(next);
			}
		}
	}

	private startRequest(request: DiffCardRequest): void {
		this.active = request;
		// Starting through a resolved promise also turns a synchronous throw from a
		// nominally async builder into a handled build failure.
		void Promise.resolve()
			.then(() => request.build(request.identity.width))
			.then(
				(text) => this.finishRequest(request, true, text),
				(error) => this.finishRequest(request, false, error),
			)
			.catch((error) => {
				// finishRequest is defensive, but keep the terminal promise handled even
				// if an unexpected host/runtime getter throws.
				this.diagnose(error, request.key);
				if (this.active === request) this.active = undefined;
			});
	}

	render(width: number): string[] {
		const normalizedWidth = Math.max(1, Math.floor(width));
		const identity: DiffCardIdentity = {
			generation: this.generation,
			width: normalizedWidth,
			epoch: this.presentationEpoch(),
		};
		this.latest = identity;

		const cached = this.cachedRows(identity);
		if (cached) {
			// A cached identity is already ready and is now the latest presentation;
			// any queued work for an intervening render is obsolete.
			this.queued = undefined;
			return cached;
		}

		const request: DiffCardRequest = {
			identity,
			build: this.build,
			failureText: this.failureText,
			textRenderer: this.textRenderer,
			key: this.diffKey,
		};
		if (!this.active) {
			this.startRequest(request);
		} else if (this.sameIdentity(this.active.identity, identity)) {
			// The active request became latest again; discard an intervening queue.
			this.queued = undefined;
		} else {
			// Latest wins. There can be only one active build and one queued identity.
			this.queued = request;
		}
		// Expansion/collapse changes the async build key. Keep the last complete
		// geometry until the replacement is ready instead of flashing a one-line
		// "rendering diff" placeholder that makes the viewport jump twice.
		return this.staleRows?.width === normalizedWidth
			? this.staleRows.rows
			: this.textRenderer(this.placeholder, normalizedWidth);
	}

	invalidate(): void {
		if (this.preserveNextInvalidate) {
			this.preserveNextInvalidate = false;
			return;
		}
		this.generation++;
		this.cache.clear();
		this.staleRows = undefined;
		this.queued = undefined;
		this.latest = undefined;
	}
}

export function diffCard(
	lastComponent: unknown,
	key: string,
	placeholder: string,
	build: DiffCardBuild,
	onReady: () => void,
	textRenderer?: DiffCardTextRenderer,
	failureText?: string,
	presentationEpoch?: DiffCardPresentationEpoch,
): DiffCardComponent {
	const component = lastComponent instanceof DiffCardComponent ? lastComponent : new DiffCardComponent();
	component.configure(key, placeholder, build, onReady, textRenderer, failureText, presentationEpoch);
	return component;
}
