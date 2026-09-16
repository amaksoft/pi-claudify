import { Spacer, Text } from "@earendil-works/pi-tui";
import { patchMethodOnce } from "./patch-once.ts";
import { sharedState } from "./shared-state.ts";

const STATE_KEY = Symbol.for("pi-claudify:message-patch-state");
interface MessagePatchState {
	normalizeLine?: (line: string) => string;
	headerText?: () => string;
	enabled?: () => boolean;
}
function state(): MessagePatchState { return sharedState(STATE_KEY, () => ({})); }

export function patchCustomMessageRenderer(
	ComponentClass: any,
	flag: symbol,
	normalizeLine: (line: string) => string,
): void {
	state().normalizeLine = normalizeLine;
	patchMethodOnce(ComponentClass?.prototype, flag, "render", (originalRender) =>
		function patchedCustomMessageRender(this: any, width: number) {
			const lines = originalRender.call(this, width);
			const normalize = state().normalizeLine;
			return Array.isArray(lines) && normalize ? lines.map(normalize) : lines;
		},
	);
}

export function patchCompactionSummaryRenderer(
	ComponentClass: any,
	flag: symbol,
	headerText: () => string,
	/**
	 * `compactionSummary: false` pass-through. Checked live (fresh `state()`
	 * read) every `updateDisplay` call, not just at install time, so a later
	 * generation that disables the feature actually reverts to pi's native
	 * layout — the prototype patch below is installed at most once per
	 * process and is never uninstalled.
	 */
	enabled: () => boolean = () => true,
): void {
	state().headerText = headerText;
	state().enabled = enabled;
	patchMethodOnce(ComponentClass?.prototype, flag, "updateDisplay", (originalUpdateDisplay) =>
		function patchedCompactionSummaryDisplay(this: any) {
			originalUpdateDisplay.call(this);
			if (state().enabled?.() === false) return;
			const summary = this.expanded && Array.isArray(this.children) ? this.children[this.children.length - 1] : undefined;
			if (summary && typeof summary.setText === "function") summary.setText(this.message.summary);
			this.paddingX = 0;
			this.paddingY = 0;
			this.setBgFn?.(undefined);
			this.clear();
			this.addChild(new Text(state().headerText?.() ?? "Compacted", 0, 0));
			if (summary) { this.addChild(new Spacer(1)); this.addChild(summary); }
		},
	);
}
