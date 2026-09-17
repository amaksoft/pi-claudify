import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Point HOME at an empty directory for the rest of the process.
 *
 * Settings are user-scope (~/.pi/settings.json, ADR 0004), and the assembled-
 * render suites assert default rendering — so without this they assert against
 * whatever the person running them happens to have configured. A contributor
 * who turns off a grouping setting would see unrelated suites fail, and CI
 * would disagree with a laptop for reasons no diff explains.
 *
 * Call before the first render. Returns the sandbox home so a test can write
 * settings into it deliberately.
 */
const sandboxRoots = new Set<string>();
let cleanupInstalled = false;

export function trackedTempDir(label = "cc-suite"): string {
	const root = mkdtempSync(join(tmpdir(), `${label}-`));
	sandboxRoots.add(root);
	if (!cleanupInstalled) {
		cleanupInstalled = true;
		process.once("exit", () => {
			for (const path of sandboxRoots) {
				try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
			}
		});
	}
	return root;
}

export function useSandboxHome(label = "cc-suite"): string {
	const root = trackedTempDir(label);
	const home = join(root, "home");
	mkdirSync(join(home, ".pi"), { recursive: true });
	process.env.HOME = home;
	return home;
}
