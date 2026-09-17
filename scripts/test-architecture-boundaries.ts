import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const layer of ["domain", "render", "runtime"] as const) {
	const directory = join(process.cwd(), "extensions", layer);
	for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".ts"))) {
		const source = readFileSync(join(directory, name), "utf8");
		assert.doesNotMatch(source, /from\s+["']@earendil-works\//, `${layer}/${name} must not import Pi host packages`);
		assert.doesNotMatch(source, /from\s+["']node:(?:fs|child_process|os)/, `${layer}/${name} must not perform host I/O`);
		assert.doesNotMatch(source, /from\s+["']\.\.\/host\//, `${layer}/${name} must not depend on host adapters`);
	}
}

const publicAdapter = readFileSync(join(process.cwd(), "extensions", "adapters", "public-pi.ts"), "utf8");
assert.doesNotMatch(publicAdapter, /from\s+["'][^"']*tested-pi\//, "portable adapter must not depend on tested-Pi compatibility hooks");
assert.doesNotMatch(publicAdapter, /from\s+["']\.\.\/host\//, "portable adapter must not depend on legacy host patches");

const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
assert.deepEqual(manifest.pi?.extensions, ["./extensions/index.ts"], "package has one explicit composition entry point");

console.log("architecture boundary tests passed");
