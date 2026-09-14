import { Spacer, Text } from "@earendil-works/pi-tui";
import { patchMethodOnce } from "./patch-once.ts";

export function patchCustomMessageRenderer(
	ComponentClass: any,
	flag: symbol,
	normalizeLine: (line: string) => string,
): void {
	patchMethodOnce(ComponentClass?.prototype, flag, "render", (originalRender) =>
		function patchedCustomMessageRender(this: any, width: number) {
			const lines = originalRender.call(this, width);
			return Array.isArray(lines) ? lines.map(normalizeLine) : lines;
		},
	);
}

export function patchCompactionSummaryRenderer(
	ComponentClass: any,
	flag: symbol,
	headerText: () => string,
): void {
	patchMethodOnce(ComponentClass?.prototype, flag, "updateDisplay", (originalUpdateDisplay) =>
		function patchedCompactionSummaryDisplay(this: any) {
			originalUpdateDisplay.call(this);
			const summary = this.expanded && Array.isArray(this.children) ? this.children[this.children.length - 1] : undefined;
			if (summary && typeof summary.setText === "function") summary.setText(this.message.summary);
			this.paddingX = 0;
			this.paddingY = 0;
			this.setBgFn?.(undefined);
			this.clear();
			this.addChild(new Text(headerText(), 0, 0));
			if (summary) { this.addChild(new Spacer(1)); this.addChild(summary); }
		},
	);
}
