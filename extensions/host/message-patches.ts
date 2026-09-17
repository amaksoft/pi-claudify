import { Spacer, Text } from "@earendil-works/pi-tui";
import { testedPiPatchBroker } from "../adapters/tested-pi/patch-broker.ts";
import { patchMethodOnce } from "./patch-once.ts";

const SURFACE = "message-renderers";
interface MessagePatchRuntime {
	normalizeLine?: (line: string) => string;
	headerText?: () => string;
	enabled?: () => boolean;
}
function runtime(owner: object): MessagePatchRuntime {
	let value = testedPiPatchBroker.owned<MessagePatchRuntime>(owner, SURFACE);
	if (!value) {
		value = {};
		testedPiPatchBroker.bind(owner, SURFACE, value);
	}
	return value;
}
function activeRuntime(): MessagePatchRuntime | undefined { return testedPiPatchBroker.active<MessagePatchRuntime>(SURFACE); }

export function patchCustomMessageRenderer(ComponentClass: any, flag: symbol, owner: object, normalizeLine: (line: string) => string): void {
	runtime(owner).normalizeLine = normalizeLine;
	patchMethodOnce(ComponentClass?.prototype, flag, "render", (originalRender) =>
		function patchedCustomMessageRender(this: any, width: number) {
			const lines = originalRender.call(this, width);
			const normalize = activeRuntime()?.normalizeLine;
			return Array.isArray(lines) && normalize ? lines.map(normalize) : lines;
		},
	);
}

export function patchCompactionSummaryRenderer(
	ComponentClass: any,
	flag: symbol,
	owner: object,
	headerText: () => string,
	enabled: () => boolean = () => true,
): void {
	runtime(owner).headerText = headerText;
	runtime(owner).enabled = enabled;
	patchMethodOnce(ComponentClass?.prototype, flag, "updateDisplay", (originalUpdateDisplay) =>
		function patchedCompactionSummaryDisplay(this: any) {
			originalUpdateDisplay.call(this);
			const active = activeRuntime();
			if (!active || active.enabled?.() === false) return;
			const summary = this.expanded && Array.isArray(this.children) ? this.children[this.children.length - 1] : undefined;
			if (summary && typeof summary.setText === "function") summary.setText(this.message.summary);
			this.paddingX = 0;
			this.paddingY = 0;
			this.setBgFn?.(undefined);
			this.clear();
			this.addChild(new Text(active.headerText?.() ?? "Compacted", 0, 0));
			if (summary) { this.addChild(new Spacer(1)); this.addChild(summary); }
		},
	);
}

export function releaseMessageRenderers(owner: object): void { testedPiPatchBroker.releaseSurface(owner, SURFACE); }
