import assert from "node:assert/strict";

import {
	createBashToolPresentation,
	registerBashTool,
	type BashToolPresentationRuntime,
	type BashToolRuntime,
} from "../extensions/tools/bash-tool.ts";

const cwd = process.cwd();
const presentation = createBashToolPresentation({ cwd } as unknown as BashToolPresentationRuntime);
assert.deepEqual(
	Object.keys(presentation).sort(),
	["name", "overrideSelfShell", "renderCall", "renderResult"],
	"the presentation factory returns presentation concerns only",
);
assert.equal(presentation.name, "bash");
assert.equal(presentation.overrideSelfShell, true);
assert.equal(typeof presentation.renderCall, "function");
assert.equal(typeof presentation.renderResult, "function");
assert.equal("execute" in presentation, false, "presentation does not own execution");
assert.equal("parameters" in presentation, false, "presentation does not own native parameters");
assert.equal("schema" in presentation, false, "presentation does not own a schema");

let registered: any;
const runtime = {
	cwd,
	register(definition: any) { registered = definition; },
	registerExecution: true,
	registerPresentation() {},
	forwardContract() { return { promptSnippet: "forwarded" }; },
	hostSettings() { return {}; },
} as unknown as BashToolRuntime;
registerBashTool(runtime);
assert.equal(registered.name, "bash");
assert.equal(registered.promptSnippet, "forwarded", "native contract fields remain composed into registration");
assert.ok(registered.parameters, "native schema remains on the registered execution definition");
assert.equal(typeof registered.execute, "function", "native execution remains on the registered definition");
assert.equal(typeof registered.renderCall, "function");
assert.equal(typeof registered.renderResult, "function");

const result = await registered.execute(
	"bash-presentation-composition",
	{ command: "printf presentation" },
	undefined,
	undefined,
	{
		cwd,
		model: undefined,
		thinkingLevel: "off",
		sessionManager: { getSessionId: () => "bash-presentation-test", getSessionFile: () => undefined },
	},
);
assert.equal(result.content[0]?.text, "presentation", "composed registration still executes the native Bash tool");
assert.equal(result.details?._claudifyPrefixApplied, false);

console.log("bash tool presentation tests passed");
