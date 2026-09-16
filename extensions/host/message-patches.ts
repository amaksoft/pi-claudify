import { Spacer, Text } from "@earendil-works/pi-tui";
import { patchMethodOnce } from "./patch-once.ts";
import { sharedState } from "./shared-state.ts";

const STATE_KEY = Symbol.for("pi-claudify:message-patch-state");
interface MessagePatchRuntime {
	normalizeLine?: (line: string) => string;
	headerText?: () => string;
	enabled?: () => boolean;
}
interface MessagePatchState { owners?: Map<object, MessagePatchRuntime> }
function state(): MessagePatchState { return sharedState(STATE_KEY, () => ({})); }
function runtime(owner: object): MessagePatchRuntime {
	const owners = (state().owners ??= new Map());
	let value = owners.get(owner);
	if (!value) { value = {}; owners.set(owner, value); }
	return value;
}
function activeRuntime(): MessagePatchRuntime | undefined { return state().owners?.values().next().value; }

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
			if (activeRuntime()?.enabled?.() === false) return;
			const summary = this.expanded && Array.isArray(this.children) ? this.children[this.children.length - 1] : undefined;
			if (summary && typeof summary.setText === "function") summary.setText(this.message.summary);
			this.paddingX = 0;
			this.paddingY = 0;
			this.setBgFn?.(undefined);
			this.clear();
			this.addChild(new Text(activeRuntime()?.headerText?.() ?? "Compacted", 0, 0));
			if (summary) { this.addChild(new Spacer(1)); this.addChild(summary); }
		},
	);
}

export function releaseMessageRenderers(owner: object): void { state().owners?.delete(owner); }
