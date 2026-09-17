import type { Disposable, DisposeCallback } from "./contracts.ts";

export type RuntimeState = "loading" | "active" | "retiring" | "disposed";

const RUNTIME_SEQUENCE_KEY = Symbol.for("pi-claudify:runtime-sequence");

function nextRuntimeSequence(): number {
	const root = globalThis as Record<PropertyKey, unknown>;
	const current = typeof root[RUNTIME_SEQUENCE_KEY] === "number" ? root[RUNTIME_SEQUENCE_KEY] as number : 0;
	const next = current + 1;
	root[RUNTIME_SEQUENCE_KEY] = next;
	return next;
}

function toDisposable(value: Disposable | DisposeCallback): Disposable {
	return typeof value === "function" ? { dispose: value } : value;
}

/**
 * Generation-scoped authority for every resource installed by one extension
 * factory invocation. The opaque owner token is safe to use as the key in
 * process-global host adapters; the string id is diagnostic only.
 */
export class RuntimeHandle {
	readonly generationId: string;
	readonly owner: object = Object.freeze({});
	readonly signal: AbortSignal;

	private readonly abortController = new AbortController();
	private readonly disposables: Disposable[] = [];
	private currentState: RuntimeState = "loading";
	private disposal?: Promise<void>;

	constructor(prefix = "claudify") {
		this.generationId = `${prefix}-${nextRuntimeSequence()}`;
		this.signal = this.abortController.signal;
	}

	get state(): RuntimeState {
		return this.currentState;
	}

	isCurrent(): boolean {
		return this.currentState === "loading" || this.currentState === "active";
	}

	activate(): boolean {
		if (this.currentState !== "loading") return false;
		this.currentState = "active";
		return true;
	}

	add(value: Disposable | DisposeCallback): void {
		const disposable = toDisposable(value);
		if (this.currentState === "disposed") {
			void Promise.resolve(disposable.dispose()).catch(() => {});
			return;
		}
		this.disposables.push(disposable);
	}

	beginRetirement(reason?: unknown): boolean {
		if (this.currentState === "retiring" || this.currentState === "disposed") return false;
		this.currentState = "retiring";
		this.abortController.abort(reason);
		return true;
	}

	dispose(onError?: (error: unknown) => void): Promise<void> {
		if (this.disposal) return this.disposal;
		this.beginRetirement("runtime disposed");
		this.currentState = "disposed";
		const pending = this.disposables.splice(0).reverse();
		this.disposal = (async () => {
			for (const disposable of pending) {
				try {
					await disposable.dispose();
				} catch (error) {
					onError?.(error);
				}
			}
		})();
		return this.disposal;
	}
}
