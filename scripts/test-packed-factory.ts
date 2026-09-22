import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { trackedTempDir } from "./sandbox-home.ts";

const repo = resolve(import.meta.dir, "..");
const sandbox = trackedTempDir("claudify-packed-factory");
const consumer = join(sandbox, "consumer");
mkdirSync(consumer, { recursive: true });

function run(command: string, args: string[], cwd: string, env = process.env): string {
	const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}

try {
	run("npm", ["pack", "--silent", "--pack-destination", sandbox], repo);
	const tarball = readdirSync(sandbox).find((name) => name.endsWith(".tgz"));
	assert.ok(tarball, "npm pack produced a tarball");
	writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "claudify-packed-consumer", private: true }));
	run("npm", ["install", "--ignore-scripts", join(sandbox, tarball!), "@earendil-works/pi-coding-agent@0.86.1", "@earendil-works/pi-tui@0.86.1", "@sinclair/typebox"], consumer);
	const packagePath = join(consumer, "node_modules", "@owlburtoe", "pi-claudify");
	const manifest = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./extensions/index.ts"]);
	const output = run(process.execPath, [join(repo, "scripts", "test-native-execution-pty.ts")], repo, {
		...process.env,
		PI_TEST_BIN: join(consumer, "node_modules", ".bin", "pi"),
		PI_CLAUDIFY_PACKAGE: packagePath,
	});
	assert.match(output, /native execution ownership tests passed/);
	console.log("packed factory activation tests passed");
} finally {
	rmSync(sandbox, { recursive: true, force: true });
}
