import assert from "node:assert/strict";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { describeInspectionsActive, describeInspectionsDone } from "../extensions/inspection-summary.ts";
import extension, { mcpServerName } from "../extensions/index.ts";

import { useSandboxHome } from "./sandbox-home.ts";

// Assert default rendering, not the settings of whoever runs the suite.
useSandboxHome("cc-mcp");

// Every expectation here is transcribed from a live capture of Claude Code
// v2.1.x driven through cmux against four real MCP servers plus a purpose-built
// probe server. Grammar: docs/plans/2026-07-13-mcp-grammar.md

// ---------------------------------------------------------------------------
// Server extraction — the only thing the grammar needs from an MCP call.
// Generic across servers and across both naming conventions.
// ---------------------------------------------------------------------------

// pi's meta-tool: server explicit, or inferred from the qualified tool name.
assert.equal(mcpServerName("mcp", { tool: "plane_list_work_items", server: "plane" }), "plane");
assert.equal(mcpServerName("mcp", { tool: "plane_list_work_items" }), "plane");
assert.equal(mcpServerName("mcp", { tool: "xcodebuildmcp_boot_sim" }), "xcodebuildmcp");
assert.equal(mcpServerName("mcp", { describe: "openosint_search_dns" }), "openosint");
assert.equal(mcpServerName("mcp", { connect: "linear" }), "linear");
assert.equal(mcpServerName("mcp", { action: "auth-start", server: "linear" }), "linear");
assert.equal(mcpServerName("mcp", { server: "forgejo" }), "forgejo");
assert.equal(mcpServerName("mcp", {}), "");

// The proxy tool receives the tool name in *streamed* arguments. A half-emitted
// name must not be mistaken for a server, or the row renders "Calling forge…".
assert.equal(mcpServerName("mcp", { tool: "forge" }), "");
assert.equal(mcpServerName("mcp", { tool: "obs" }), "");
assert.equal(mcpServerName("mcp", { tool: "forgejo_" }), "forgejo");
assert.equal(mcpServerName("mcp", { tool: "forgejo_get_my" }), "forgejo");

// MCP tools exposed directly, Claude Code style.
assert.equal(mcpServerName("mcp__plane__list_work_items", {}), "plane");
assert.equal(mcpServerName("mcp__openosint__search_dns", {}), "openosint");
// A server whose own name contains an underscore still resolves.
assert.equal(mcpServerName("mcp__my_server__do_thing", {}), "my_server");

// ---------------------------------------------------------------------------
// Clause phrasing.
//
// Captured: "⏺ Calling probe…" / "Called probe"
//           "⏺ Calling openosint, forgejo, obsidian, plane 6 times…"
//           "Read 1 file, called probe, ran 1 shell command"
// ---------------------------------------------------------------------------

// One call: the server is named and the count is omitted entirely.
assert.equal(describeInspectionsActive(["mcp"], ["probe"]), "Calling probe…");
assert.equal(describeInspectionsDone(["mcp"], ["probe"]), "Called probe");

// Many calls: servers deduplicated in first-seen order, count = number of CALLS.
const sixCalls: ("mcp")[] = ["mcp", "mcp", "mcp", "mcp", "mcp", "mcp"];
const sixServers = ["openosint", "openosint", "openosint", "forgejo", "obsidian", "plane"];
assert.equal(describeInspectionsActive(sixCalls, sixServers), "Calling openosint, forgejo, obsidian, plane 6 times…");
assert.equal(describeInspectionsDone(sixCalls, sixServers), "Called openosint, forgejo, obsidian, plane 6 times");

// Mixed with built-ins — MCP sits after the file tools and before bash.
assert.equal(
	describeInspectionsActive(["read", "bash", "mcp"], ["probe"]),
	"Reading 1 file, calling probe, running 1 shell command…",
);
assert.equal(describeInspectionsDone(["read", "bash", "mcp"], ["probe"]), "Read 1 file, called probe, ran 1 shell command");
// The MCP clause always lands after the file-inspection clauses and immediately
// before bash. (The relative order of `reading` and `listing` is the package's
// pre-existing clause order and is not asserted here.)
assert.match(
	describeInspectionsActive(["grep", "read", "ls", "bash", "mcp"], ["probe"]),
	/^Searching for 1 pattern, .*, calling probe, running 1 shell command…$/,
);

// ---------------------------------------------------------------------------
// Rendered rows.
// ---------------------------------------------------------------------------

class FakePi {
	tools = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void {
		this.tools.set(definition.name, definition);
	}
	registerCommand(): void {}
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
	async fire(name: string): Promise<void> {
		for (const handler of this.events.get(name) ?? []) await handler({}, { hasUI: false });
	}
}

function tool(pi: FakePi, name: string, id: string, args: any, text: string, isError = false, settled = true): ToolExecutionComponent {
	const definition = pi.tools.get(name);
	assert.ok(definition, `${name} tool registered`);
	const component = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		definition,
		{ requestRender() {}, previousLines: [] } as any,
		process.cwd(),
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	if (settled) component.updateResult({ content: [{ type: "text", text }], details: {}, isError } as any, false);
	return component;
}

function plain(lines: string[]): string {
	return lines
		.map((line) =>
			line
				.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
				.replace(/\x1b\[[0-9;]*m/g, "")
				.replace(/\s+$/, ""),
		)
		.join("\n");
}

initTheme("dark", false);
const pi = new FakePi();
// pi-mcp-adapter exposes MCP two ways, and both must render the same.
//   proxy mode:  one `mcp` tool, the real tool passed in its arguments
//   direct mode: one pi tool per MCP tool, named `<server>_<tool>` — or bare
//                `<tool>` when the server prefix is off — labelled `MCP: <tool>`
pi.registerTool({ name: "mcp", label: "MCP", description: "Call an MCP tool", execute: async () => ({}) });
pi.registerTool({ name: "plane_get_me", label: "MCP: get_me", description: "Get the current user.", execute: async () => ({}) });
pi.registerTool({ name: "tag_list", label: "MCP: tag_list", description: "List tags.", execute: async () => ({}) });
pi.registerTool({ name: "read", label: "Read", description: "Read a file", execute: async () => ({}) });
pi.registerTool({ name: "bash", label: "Bash", description: "Run a command", execute: async () => ({}) });
extension(pi as any);
await pi.fire("session_start");

// A single MCP call collapses to `Called <server>` — no bullet, no count, no ⎿ row,
// no arguments, no result. It never gets a tool row of its own.
const solo = new Container();
solo.addChild(tool(pi, "mcp", "s1", { tool: "probe_read_thing", args: '{"id":"alpha"}' }, "a long payload\nline two\nline three"));
const soloRendered = plain(solo.render(120));
assert.match(soloRendered, /^ {2}Called probe$/m);
assert.doesNotMatch(soloRendered, /⎿/);
assert.doesNotMatch(soloRendered, /⏺/);
assert.doesNotMatch(soloRendered, /alpha|payload|line two/);
assert.doesNotMatch(soloRendered, /1 time/);

// Still in flight: the active header, with the ⏺ bullet and a trailing ellipsis.
const flight = new Container();
flight.addChild(tool(pi, "mcp", "f1", { tool: "probe_read_thing", args: "{}" }, "", false, false));
assert.match(plain(flight.render(120)), /^⏺ Calling probe…$/m);

// A mutating MCP call renders exactly like a read-only one. Claude Code makes no
// distinction — verified against a tool declaring readOnlyHint:false.
const mutating = new Container();
mutating.addChild(tool(pi, "mcp", "m1", { tool: "probe_write_thing", args: '{"name":"beta"}' }, "wrote beta"));
const mutatingRendered = plain(mutating.render(120));
assert.match(mutatingRendered, /^ {2}Called probe$/m);
assert.doesNotMatch(mutatingRendered, /beta|wrote/);

// A failing MCP call also collapses to the plain line; the error never surfaces.
const failing = new Container();
failing.addChild(tool(pi, "mcp", "e1", { tool: "probe_fail_thing", args: "{}" }, "probe error: the thing exploded", true));
const failingRendered = plain(failing.render(120));
assert.match(failingRendered, /^ {2}Called probe$/m);
assert.doesNotMatch(failingRendered, /exploded|error/i);

// Many calls across many servers: deduplicated, first-seen order, counted by call.
const many = new Container();
many.addChild(tool(pi, "mcp", "n1", { tool: "openosint_search_dns", args: '{"domain":"wikipedia.org"}' }, "{}"));
many.addChild(tool(pi, "mcp", "n2", { tool: "openosint_search_dns", args: '{"domain":"github.com"}' }, "{}"));
many.addChild(tool(pi, "mcp", "n3", { tool: "openosint_search_dns", args: '{"domain":"kernel.org"}' }, "{}"));
many.addChild(tool(pi, "mcp", "n4", { tool: "forgejo_get_my_user_info", args: "{}" }, "{}"));
many.addChild(tool(pi, "mcp", "n5", { tool: "obsidian_tag_list", args: "{}" }, "{}"));
many.addChild(tool(pi, "mcp", "n6", { tool: "plane_get_me", args: "{}" }, "{}"));
assert.match(plain(many.render(140)), /^ {2}Called openosint, forgejo, obsidian, plane 6 times$/m);

// --- Direct mode: MCP tools registered under their own names. -----------------
// `plane_get_me` carries its server in the pi name; `tag_list` carries nothing at
// all, so its server is only knowable from the result the adapter stamps.
const direct = new Container();
direct.addChild(tool(pi, "plane_get_me", "d1", {}, '{"email":"x@y.z"}'));
const directRendered = plain(direct.render(120));
assert.match(directRendered, /^ {2}Called plane$/m);
assert.doesNotMatch(directRendered, /⎿|⏺|get_me|email/);

// A bare direct tool name is unrecognisable on its own — the server comes from
// `details.server`, which pi-mcp-adapter stamps on every MCP result.
const bare = new ToolExecutionComponent(
	"tag_list",
	"d2",
	{},
	{ showImages: false },
	pi.tools.get("tag_list"),
	{ requestRender() {}, previousLines: [] } as any,
	process.cwd(),
);
bare.markExecutionStarted();
bare.setArgsComplete();
bare.updateResult({ content: [{ type: "text", text: "#a\n#b" }], details: { server: "obsidian" }, isError: false } as any, false);
const bareContainer = new Container();
bareContainer.addChild(bare);
assert.match(plain(bareContainer.render(120)), /^ {2}Called obsidian$/m);

// Direct and proxy calls aggregate together, and alongside built-ins.
const both = new Container();
both.addChild(tool(pi, "read", "x1", { path: "sample.txt" }, "hello"));
both.addChild(tool(pi, "plane_get_me", "x2", {}, "{}"));
both.addChild(tool(pi, "mcp", "x3", { tool: "forgejo_get_my_user_info", args: "{}" }, "{}"));
both.addChild(tool(pi, "bash", "x4", { command: "echo hi" }, "hi"));
assert.match(plain(both.render(140)), /^ {2}Read 1 file, called plane, forgejo 2 times, ran 1 shell command$/m);

// --- An aggregated MCP call must be recoverable in full. ---------------------

// Collapsed, an MCP call is hidden behind a bare server name, and the expanded
// header showed only `server:tool`. So a mutating call's parameters — what it
// actually did — were unreadable in every state. Claude Code shows MCP
// parameters in the row; the collapsed line is unchanged.
const MUTATING_ARGS = JSON.stringify({
	project_id: "8f3c1d22-7a44-4e1b-9c02-abcdef012345",
	state: "cancelled",
	comment: "Closing every open item in the sprint as obsolete",
});

function mcpRow(id: string, args: any, expand: boolean, name = "mcp"): string {
	const component = tool(pi, name, id, args, "updated 41 items");
	if (expand) component.setExpanded(true);
	const box = new Container();
	box.addChild(component);
	return plain(box.render(120));
}
const squash = (text: string) => text.replace(/\s+/g, "");

// Collapsed: still just the server name, with no trace of the parameters.
const hiddenCall = mcpRow("rec-1", { tool: "plane_bulk_update_work_items", args: MUTATING_ARGS }, false);
assert.match(hiddenCall, /^ {2}Called plane$/m);
assert.doesNotMatch(hiddenCall, /cancelled|project_id/);

// Expanded (proxy mode): the parameters, in full.
const openedCall = mcpRow("rec-2", { tool: "plane_bulk_update_work_items", args: MUTATING_ARGS }, true);
assert.match(openedCall, /⏺ MCP\(plane:bulk_update_work_items/);
assert.ok(squash(openedCall).includes(squash(MUTATING_ARGS)), "expanding reveals the MCP parameters");
const SPACED_ARGS = '{"command":"printf a  b","note":"x  y"}';
const spacedCall = mcpRow("rec-space", { tool: "plane_run", args: SPACED_ARGS }, true);
assert.ok(spacedCall.includes(SPACED_ARGS), "expanded MCP parameters preserve spaces inside string values");

// Expanded (direct mode): the argument object *is* the parameters.
const openedDirect = mcpRow("rec-3", { work_item_id: "cafe-1234", state: "cancelled" }, true, "plane_get_me");
assert.match(openedDirect, /cancelled/, "direct-mode parameters are revealed too");

// A call with no parameters must not grow an empty `{}` or a stray separator.
const noArgs = mcpRow("rec-4", { tool: "forgejo_get_my_user_info", args: "{}" }, true);
assert.match(noArgs, /⏺ MCP\(forgejo:get_my_user_info\)$/m);

// Routing keys address the call; they are not parameters of it. Leaving them in
// undoes the empty-envelope suppression and decorates the most common MCP row
// there is — a call that takes no parameters at all.
const routed = mcpRow("rec-9", { tool: "forgejo_get_my_user_info", server: "forgejo", args: "{}" }, true);
assert.match(routed, /⏺ MCP\(forgejo:get_my_user_info\)$/m, "the server routing key is not a parameter");
const routedMore = mcpRow("rec-10", { tool: "plane_list", server: "plane", connect: "x", args: "{}" }, true);
assert.match(routedMore, /⏺ MCP\(plane:list\)$/m, "connect/search/action are routing keys too");
// A real parameter alongside a routing key still shows.
const routedReal = mcpRow("rec-11", { tool: "plane_list", server: "plane", args: '{"state":"open"}' }, true);
assert.match(routedReal, /\{"state":"open"\}/, "real parameters survive routing-key filtering");
assert.doesNotMatch(routedReal, /"server"/, "…without the routing key riding along");

// Malformed JSON is shown verbatim: whatever the model sent is what ran.
const malformed = mcpRow("rec-5", { tool: "plane_do_thing", args: '{"state": "cancel' }, true);
assert.match(malformed, /\{"state": "cancel/, "unparseable parameters are still shown");

// Parameters are model output, so escapes must never reach the row.
const HOSTILE_PARAMS = 'x \u001b(0 \u001b[31m \u0000 y';
const hostileComponent = tool(pi, "mcp", "rec-6", { tool: "plane_do_thing", args: HOSTILE_PARAMS }, "ok");
hostileComponent.setExpanded(true);
const hostileBox = new Container();
hostileBox.addChild(hostileComponent);
const hostileRaw = hostileBox.render(120).join("\n");
assert.doesNotMatch(hostileRaw, /\u001b\(0/, "charset shift stripped from parameters");
assert.doesNotMatch(hostileRaw, /\u0000/, "NUL stripped from parameters");
// Escapes leave nothing behind — not even the charset designator's final byte,
// which an ESC-plus-intermediate strip would strand as a literal "0".
assert.match(
	plain(hostileBox.render(120)),
	/MCP\(plane:do_thing x {4}y\)/,
	"readable parameter text and its ordinary spacing survive; escapes leave no residue",
);

// Server/routing labels can arrive in streamed model arguments too; sanitize
// them before aggregate and expanded headers.
const HOSTILE_SERVER = "plane\u001b(0\nFORGED";
assert.equal(mcpServerName("mcp", { server: HOSTILE_SERVER }), "plane FORGED");
const hostileServerArgs = { tool: "plane_list", server: HOSTILE_SERVER, args: "{}" };
const hostileServerCollapsed = mcpRow("rec-server-collapsed", hostileServerArgs, false);
assert.doesNotMatch(hostileServerCollapsed, /\u001b\(0|\nFORGED/, "aggregate server labels cannot inject terminal state or rows");
assert.match(hostileServerCollapsed, /Called plane FORGED/, "aggregate preserves the readable server label");
const hostileServerRow = mcpRow("rec-server", hostileServerArgs, true);
assert.doesNotMatch(hostileServerRow, /\u001b\(0|\nFORGED/, "expanded server labels cannot inject terminal state or rows");
assert.match(hostileServerRow, /plane FORGED:plane_list/, "readable server and tool labels survive sanitization");

// Collapsing again returns to the aggregate rather than stranding parameters.
const reCollapsed = tool(pi, "mcp", "rec-8", { tool: "plane_bulk_update_work_items", args: MUTATING_ARGS }, "done");
const reBox = new Container();
reBox.addChild(reCollapsed);
plain(reBox.render(120));
reCollapsed.setExpanded(true);
assert.ok(squash(plain(reBox.render(120))).includes(squash(MUTATING_ARGS)), "a collapsed render must not pin the summary");
reCollapsed.setExpanded(false);
assert.match(plain(reBox.render(120)), /^ {2}Called plane$/m, "re-collapsing restores the aggregate");

console.log("mcp-display: all assertions passed");
