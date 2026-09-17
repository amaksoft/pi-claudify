import assert from "node:assert/strict";
import { ToolExecutionComponent, createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { snapshotToolExecution } from "../extensions/transcript/tool-record.ts";

initTheme("dark", false);
const definition = createReadToolDefinition(process.cwd());
const component = new ToolExecutionComponent(
	"read", "semantic-record", { path: "sample.ts" }, { showImages: false }, definition,
	{ requestRender() {}, previousLines: [] } as any, process.cwd(),
);
let record = snapshotToolExecution(component)!;
assert.equal(record.name, "read");
assert.equal(record.id, "semantic-record");
assert.equal(record.phase, "pending");
assert.equal(record.expanded, false);
assert.ok(Object.isFrozen(record));
assert.ok(Object.isFrozen(record.args));
(component as any).args.path = "changed.ts";
assert.equal(record.args.path, "sample.ts", "snapshot arguments are detached from later host mutation");
component.markExecutionStarted(); component.setArgsComplete();
component.updateResult({ content: [{ type: "text", text: "partial" }], details: {}, isError: false } as any, true);
record = snapshotToolExecution(component)!;
assert.equal(record.phase, "streaming");
component.updateResult({ content: [{ type: "text", text: "done" }], details: {}, isError: false } as any, false);
component.setExpanded(true);
record = snapshotToolExecution(component)!;
assert.equal(record.phase, "settled");
assert.equal(record.expanded, true);
assert.equal(snapshotToolExecution({}), null);

console.log("semantic tool record tests passed");
