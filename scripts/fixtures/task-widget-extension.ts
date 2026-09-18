import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI): void {
	for (const name of ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate"] as const) {
		pi.registerTool({
			name,
			label: name,
			description: `External ${name} fixture`,
			parameters: Type.Object({}),
			async execute() { return { content: [{ type: "text", text: name === "TaskList" ? "#1 [completed] Completed sample\n#2 [in_progress] Active sample\n#3 [pending] Pending sample" : "ok" }], details: {} }; },
		});
	}
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		ctx.ui.setWidget("tasks", [
			"● 3 tasks (1 done, 1 in progress, 1 open)",
			"✔ #1 Completed sample",
			"✸ #2 Sampling active task color… (11m 50s · ↑ 9.8k ↓ 790)",
			"◻ #3 Pending sample › blocked by #2",
		]);
	});
}
