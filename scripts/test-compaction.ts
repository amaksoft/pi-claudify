import assert from "node:assert/strict";

import { CompactionSummaryMessageComponent } from "@earendil-works/pi-coding-agent";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension from "../extensions/index.ts";

const CC_GUTTER_FG = "\x1b[38;2;153;153;153m";
const DEFAULT_FG = "\x1b[39m";
const CC_HINT_FG = "\x1b[38;2;140;140;140m";

class FakePi {
	tools = new Map<string, any>();
	commands = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();

	registerTool(definition: any): void {
		this.tools.set(definition.name, definition);
	}

	registerCommand(name: string, command: any): void {
		this.commands.set(name, command);
	}

	on(name: string, handler: (...args: any[]) => any): void {
		const handlers = this.events.get(name) ?? [];
		handlers.push(handler);
		this.events.set(name, handlers);
	}

	getThinkingLevel(): string {
		return "off";
	}

	getAllTools(): any[] {
		return [...this.tools.values()];
	}
}

function plainLines(component: CompactionSummaryMessageComponent, width = 100): string[] {
	const lines = component.render(width).map((line) =>
		line
			.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
			.replace(/\x1b\[[0-9;]*m/g, "")
			.replace(/\s+$/, ""),
	);
	while (lines[0] === "") lines.shift();
	while (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

initTheme("dark", false);
const pi = new FakePi();
extension(pi as any);

const firstPatch = (CompactionSummaryMessageComponent.prototype as any).updateDisplay;
extension(pi as any);
assert.equal(
	(CompactionSummaryMessageComponent.prototype as any).updateDisplay,
	firstPatch,
	"compaction patch is idempotent",
);

const component = new CompactionSummaryMessageComponent({
	role: "compactionSummary",
	summary: "## Goal\n\nKeep working from the compacted summary.",
	tokensBefore: 85_175,
	timestamp: Date.now(),
});

const settledRaw = component.render(100).join("\n");
assert.ok(
	settledRaw.includes(`${CC_GUTTER_FG}  ⎿  ${DEFAULT_FG}Compacted ${CC_HINT_FG}(ctrl+o to see full summary)`),
	"settled head keeps Claude's gutter, body, and dim hint color boundaries",
);
assert.doesNotMatch(settledRaw, /\x1b\[(?:4[0-9]|10[0-7]|48;)/, "settled head has no message background");

const settled = plainLines(component);
assert.deepEqual(settled, ["  ⎿  Compacted (ctrl+o to see full summary)"]);
assert.doesNotMatch(settled.join("\n"), /\[compaction\]|Compacted from|85,175 tokens|to expand/);
const mouseResult = component.handleMouse({ type: "click", button: "left", x: 2, y: 0, width: 100, height: settled.length } as any);
assert.equal(mouseResult?.handled, true, "Pi 0.86's native compaction MouseRegion remains attached");
assert.equal((component as any).expanded, true, "clicking the compacted row expands it");
component.setExpanded(false);

component.setExpanded(true);
const expanded = plainLines(component);
assert.equal(expanded[0], "  ⎿  Compacted (ctrl+o to see full summary)");
assert.match(expanded.join("\n"), /Keep working from the compacted summary\./);
assert.doesNotMatch(expanded.join("\n"), /\[compaction\]|Compacted from|85,175 tokens|to expand/);

console.log("compaction tests passed");
