import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
	ToolExecutionComponent,
	createBashToolDefinition,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

import claudify, { ensureInspectionGroups } from "../../extensions/index.ts";

export default function mouseDispatchFixture(pi: ExtensionAPI): void {
	// Exercise the complete extension lifecycle, including its stable global
	// render shim and generation replacement, not only the group component.
	claudify(pi);
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const statePath = process.env.PI_CLAUDIFY_MOUSE_STATE;
		let generation = 1;
		if (statePath && existsSync(statePath)) {
			try {
				const previous = JSON.parse(readFileSync(statePath, "utf8"));
				if (typeof previous?.generation === "number") generation = previous.generation + 1;
			} catch { /* a torn test state restarts at generation one */ }
		}
		let setCalls = 0;
		let requestRender = (): void => {};
		let oneMembers: ToolExecutionComponent[] = [];
		let twoMembers: ToolExecutionComponent[] = [];
		const persist = (): void => {
			if (!statePath) return;
			writeFileSync(statePath, JSON.stringify({
				one: oneMembers.length > 0 && oneMembers.every((member) => (member as any).expanded === true),
				two: twoMembers.length > 0 && twoMembers.every((member) => (member as any).expanded === true),
				setCalls,
				generation,
			}));
		};
		const definition = createBashToolDefinition(ctx.cwd);
		const makeMembers = (group: "one" | "two", count: number): ToolExecutionComponent[] =>
			Array.from({ length: count }, (_, index) => {
				const command = `printf shell-${group}-${index + 1}`;
				const member = new ToolExecutionComponent(
					"bash",
					`${group}-${index + 1}`,
					{ command },
					{ showImages: false },
					definition,
					{ requestRender: () => requestRender(), previousLines: [] } as any,
					ctx.cwd,
				);
				member.markExecutionStarted();
				member.setArgsComplete();
				member.updateResult({
					content: [{ type: "text", text: `shell-${group}-${index + 1}` }],
					details: {},
					isError: false,
				} as any, false);
				const nativeSetExpanded = member.setExpanded.bind(member);
				member.setExpanded = (expanded: boolean): void => {
					nativeSetExpanded(expanded);
					setCalls += 1;
					persist();
					requestRender();
				};
				return member;
			});
		oneMembers = makeMembers("one", 3);
		twoMembers = makeMembers("two", 4);

		const root = new Container();
		root.addChild(new Text("MOUSE_DISPATCH_READY", 0, 0));
		for (const member of oneMembers) root.addChild(member);
		// A mutating/non-inspection component splits the two production groups.
		root.addChild(new Text("SHELL_GROUP_SEPARATOR", 0, 0));
		for (const member of twoMembers) root.addChild(member);
		root.addChild(new Text("MOUSE_DISPATCH_END", 0, 0));
		ensureInspectionGroups(root);
		ctx.ui.setWidget("claudify-mouse-dispatch-fixture", (tui) => {
			requestRender = () => tui.requestRender();
			return root;
		});
		persist();
	});
}
