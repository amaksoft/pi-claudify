import { writeFileSync } from "node:fs";

const STATE_KEY = Symbol.for("pi-claudify:test-tool-registration-generations");
const root = globalThis as Record<PropertyKey, unknown>;
const generations = (root[STATE_KEY] ??= []) as any[];

export default function (pi: any): void {
	const generation = generations.length + 1;
	pi.on("resources_discover", async (_event: any, ctx: any) => {
		let tools: any[] = [];
		try { tools = pi.getAllTools?.() ?? []; } catch (error) { tools = [{ name: `ERROR:${String(error)}` }]; }
		const snapshot = {
			generation,
			mode: ctx?.mode,
			active: pi.getActiveTools?.() ?? [],
			tools: tools.map((tool) => ({ name: tool?.name, sourceInfo: tool?.sourceInfo })),
		};
		const index = generations.findIndex((entry) => entry.generation === generation);
		if (index >= 0) generations[index] = snapshot; else generations.push(snapshot);
		writeFileSync(process.env.PI_CLAUDIFY_TOOL_REGISTRY_STATE!, JSON.stringify(generations, null, 2));
		return {};
	});
}
