import { Text, type Component } from "@earendil-works/pi-tui";

export type DiffCardBuild = (width: number) => Promise<string>;
export type DiffCardTextRenderer = (text: string, width: number) => string[];

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
	private generation = 0;
	private preserveNextInvalidate = false;
	private readonly cache = new Map<number, string[]>();
	private readonly pending = new Set<number>();

	configure(
		key: string,
		placeholder: string,
		build: DiffCardBuild,
		onReady: () => void,
		textRenderer?: DiffCardTextRenderer,
		failureText?: string,
	): void {
		if (this.diffKey !== key) {
			this.diffKey = key;
			this.generation++;
			this.cache.clear();
			this.pending.clear();
		}
		this.placeholder = placeholder;
		this.build = build;
		this.onReady = onReady;
		if (textRenderer) this.textRenderer = textRenderer;
		this.failureText = failureText ?? placeholder;
	}

	private renderText(text: string, width: number): string[] {
		return this.textRenderer(text, width);
	}

	render(width: number): string[] {
		const normalizedWidth = Math.max(1, Math.floor(width));
		const cached = this.cache.get(normalizedWidth);
		if (cached) return cached;

		if (!this.pending.has(normalizedWidth)) {
			this.pending.add(normalizedWidth);
			const generation = this.generation;
			void this.build(normalizedWidth)
				.then((text) => {
					if (generation !== this.generation) return;
					this.pending.delete(normalizedWidth);
					this.cache.set(normalizedWidth, this.renderText(text, normalizedWidth));
					if (this.cache.size > 6) {
						const oldest = this.cache.keys().next().value;
						if (oldest !== undefined) this.cache.delete(oldest);
					}
					// ctx.invalidate() invalidates the whole ToolExecutionComponent and
					// therefore this child. Preserve the result that triggered that repaint;
					// unrelated later invalidations still clear normally.
					this.preserveNextInvalidate = true;
					this.onReady();
				})
				.catch((error) => {
					if (generation !== this.generation) return;
					this.pending.delete(normalizedWidth);
					this.cache.set(normalizedWidth, this.renderText(this.failureText, normalizedWidth));
					this.preserveNextInvalidate = true;
					this.onReady();
					if (process.env.PI_CLAUDIFY_DEBUG === "1") console.error("[claudify diff-card]", error);
				});
		}
		return this.renderText(this.placeholder, normalizedWidth);
	}

	invalidate(): void {
		if (this.preserveNextInvalidate) {
			this.preserveNextInvalidate = false;
			return;
		}
		this.generation++;
		this.cache.clear();
		this.pending.clear();
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
): DiffCardComponent {
	const component = lastComponent instanceof DiffCardComponent ? lastComponent : new DiffCardComponent();
	component.configure(key, placeholder, build, onReady, textRenderer, failureText);
	return component;
}
