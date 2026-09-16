import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const layer of ["domain", "render"] as const) {
	const directory = join(process.cwd(), "extensions", layer);
	for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".ts"))) {
		const source = readFileSync(join(directory, name), "utf8");
		assert.doesNotMatch(source, /from\s+["']@earendil-works\//, `${layer}/${name} must not import Pi host packages`);
		assert.doesNotMatch(source, /from\s+["']node:(?:fs|child_process|os)/, `${layer}/${name} must not perform host I/O`);
		assert.doesNotMatch(source, /from\s+["']\.\.\/host\//, `${layer}/${name} must not depend on host adapters`);
	}
}

console.log("architecture boundary tests passed");
