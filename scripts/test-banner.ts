import { trackedTempDir } from "./sandbox-home.ts";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
	BannerComponent,
	discoverExtensions,
	discoverSkills,
	extensionDisplayName,
	registerBanner,
	sanitizeBannerMetadata,
	tildeHome,
	truncatePath,
} from "../extensions/banner.ts";
import { clearSettingsCache } from "../extensions/settings.ts";

const identityTheme = {
	name: "dark",
	getColorMode: () => "truecolor",
	fg: (_key: string, text: string) => text,
	bold: (text: string) => text,
} as any;

let visible = true;
let framed = true;
const banner = new BannerComponent({
	model: () => "Muse Spark 1.3",
	cwd: "~/exper/pi.dev.extensions/pi-claudify",
	resumed: undefined,
	title: () => undefined,
	welcome: "Welcome back!",
	skills: ["review", "brain", "visualize"],
	extensions: ["pi-subagents", "pi-claudify"],
	visible: () => visible,
	full: () => framed,
});

const boxed = banner.render(100, identityTheme);
assert.ok(boxed.some((line) => line.includes("╭")), "framed mode renders the responsive welcome box");
assert.ok(boxed.some((line) => line.includes("████")), "banner always uses the Pi mark");
assert.ok(boxed.every((line) => visibleWidth(line) <= 100));

framed = false;
const condensed = banner.render(100, identityTheme);
assert.ok(condensed.some((line) => line.includes("████")), "borderless mode retains Pi branding");
assert.ok(condensed.every((line) => !/[╭╮╰╯]/.test(line)), "frame toggle removes box chrome live");
assert.notDeepEqual(condensed, boxed, "frame setting participates in the render cache key");

visible = false;
assert.deepEqual(banner.render(100, identityTheme), [], "banner mode off hides the component live");
visible = true;
framed = true;
for (const width of [8, 13, 20, 39, 40, 75, 76, 120]) {
	const rows = banner.render(width, identityTheme);
	for (const line of rows) assert.ok(visibleWidth(line) <= width, `banner row fits width ${width}: ${JSON.stringify(line)}`);
}
assert.equal(truncatePath("/Users/example/a/very/long/path/project", 16), "/…/project");
assert.equal(truncatePath("C:\\Users\\example\\very\\long\\project", 20), "C:\\…\\project");
assert.equal(truncatePath("\\\\server\\share\\very\\long\\project", 24), "\\\\server\\share\\…\\project");
assert.equal(extensionDisplayName("C:\\tools\\my-extension\\dist\\index.ts"), "my-extension");
const pathHome = process.env.HOME;
process.env.HOME = "C:\\Users\\Example";
assert.equal(tildeHome("c:\\users\\example\\project"), "~\\project", "Windows home abbreviation is case-insensitive");
if (pathHome === undefined) delete process.env.HOME; else process.env.HOME = pathHome;

// Every external metadata leaf must be harmless before it reaches the theme,
// cache, width helpers, truncation, or name packing.
const hostile = (label: string): string =>
	`${label}\x1b]2;OSC-PWN\x07\x1b[31m\x1bPqDCS-PWN\x1b\\\x1b_APC-PWN\x1b\\\x07\r\n\u202e\ud800-tail`;
const hostileInputs = {
	model: hostile("MODEL"),
	title: hostile("TITLE"),
	welcome: hostile("WELCOME"),
	cwd: hostile("/CWD"),
	extension: hostile("EXTENSION"),
	skill: hostile("SKILL"),
};
const styledInputs: string[] = [];
const observingTheme = {
	...identityTheme,
	fg: (_key: string, text: string) => {
		styledInputs.push(text);
		return text;
	},
	bold: (text: string) => {
		styledInputs.push(text);
		return text;
	},
} as any;
const hostileBanner = new BannerComponent({
	model: () => hostileInputs.model,
	cwd: hostileInputs.cwd,
	resumed: hostile("SESSION"),
	title: () => hostileInputs.title,
	welcome: hostileInputs.welcome,
	extensions: [hostileInputs.extension],
	skills: [hostileInputs.skill],
	full: true,
});
const forbiddenMetadata = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\uD800-\uDFFF]/u;
const forbiddenOutput = /\x1b(?:\]|P|_|\[31m)|\x07|[\r\n\u0085\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\uD800-\uDFFF]/u;
for (const width of [8, 20, 39, 40, 75, 76, 120]) {
	const rows = hostileBanner.render(width, observingTheme);
	for (const line of rows) {
		// truncateToWidth may append its own SGR reset, so allow generated SGR
		// while rejecting every hostile envelope/control supplied above.
		assert.ok(!forbiddenOutput.test(line), `hostile metadata is sanitized at width ${width}: ${JSON.stringify(line)}`);
		assert.ok(!line.includes("OSC-PWN") && !line.includes("DCS-PWN") && !line.includes("APC-PWN"));
		assert.ok(visibleWidth(line) <= width, `sanitized row fits width ${width}: ${JSON.stringify(line)}`);
	}
}
for (const text of styledInputs) {
	const withoutGeneratedSgr = text.replace(/\x1b\[[0-9;]*m/g, "");
	assert.ok(!forbiddenMetadata.test(withoutGeneratedSgr), `theme receives sanitized metadata: ${JSON.stringify(text)}`);
}
assert.equal(sanitizeBannerMetadata("ok\ud800"), "ok�", "lone surrogates become replacement characters");

const changingExtensions = ["first"];
const cacheBanner = new BannerComponent({
	model: () => "model",
	cwd: "/cwd",
	resumed: undefined,
	title: () => undefined,
	extensions: changingExtensions,
	full: true,
});
const firstRender = cacheBanner.render(100, identityTheme);
changingExtensions[0] = "second";
const secondRender = cacheBanner.render(100, identityTheme);
assert.notDeepEqual(secondRender, firstRender, "sanitized extension leaves participate in the cache key");
assert.ok(secondRender.some((line) => line.includes("second")));

// Resource discovery keeps global/user sources, honors the configurable agent
// root, and admits project settings (including exclusions) and skills only on
// an affirmative trust decision.
const sandbox = trackedTempDir("pi-claudify-banner");
const oldHome = process.env.HOME;
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
try {
	const home = join(sandbox, "home");
	const agentDir = join(sandbox, "custom-agent");
	const project = join(sandbox, "project");
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = agentDir;

	const skill = (root: string, name: string): void => {
		mkdirSync(join(root, name), { recursive: true });
		writeFileSync(join(root, name, "SKILL.md"), `# ${name}\n`);
	};
	skill(join(agentDir, "skills"), "agent-skill");
	skill(join(home, ".agents", "skills"), "user-skill");
	skill(join(home, ".pi", "agent", "skills"), "wrong-default-skill");
	skill(join(project, ".pi", "skills"), "project-skill");
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	writeFileSync(join(agentDir, "extensions", "drop-in.ts"), "export default () => {};\n");
	mkdirSync(join(home, ".pi"), { recursive: true });
	writeFileSync(join(home, ".pi", "settings.json"), JSON.stringify({
		extensions: ["npm:global-ext", "npm:remove-me"],
	}));
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:agent-ext"] }));
	mkdirSync(join(project, ".pi"), { recursive: true });
	writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({
		extensions: ["-global-ext", "!remove-me", "npm:project-ext"],
	}));

	assert.deepEqual(discoverSkills(project, false), ["agent-skill", "user-skill"]);
	assert.deepEqual(discoverSkills(project, true), ["agent-skill", "project-skill", "user-skill"]);
	assert.deepEqual(discoverExtensions(project, false), ["agent-ext", "drop-in", "global-ext", "remove-me"]);
	assert.deepEqual(discoverExtensions(project, true), ["agent-ext", "drop-in", "project-ext"]);
} finally {
	if (oldHome === undefined) delete process.env.HOME;
	else process.env.HOME = oldHome;
	if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
	rmSync(sandbox, { recursive: true, force: true });
}

type Handler = (event: any, ctx: any) => unknown;
function bannerHarness(disposesReplacedHeaders: boolean, initialHeader?: any) {
	const handlers = new Map<string, Handler[]>();
	let header: any = initialHeader;
	let setHeaderCalls = 0;
	const ui = {
		setHeader(factory: any) {
			setHeaderCalls++;
			if (disposesReplacedHeaders) header?.dispose?.();
			header = factory ? factory({}, identityTheme) : undefined;
		},
	};
	const ctx = {
		mode: "tui",
		cwd: "/tmp/project",
		model: { id: "model" },
		isProjectTrusted: () => false,
		sessionManager: {
			getSessionId: () => "1234567890",
			getSessionName: () => "session",
		},
		ui,
	};
	const pi = {
		on(name: string, handler: Handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	};
	registerBanner(pi as any);
	return {
		ctx,
		ui,
		get header() { return header; },
		get setHeaderCalls() { return setHeaderCalls; },
		async fire(name: string, event: any = {}) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

const oldMode = process.env.PI_CLAUDIFY_BANNER_MODE;
const ownershipHome = process.env.HOME;
try {
	const legacyInstallHome = join(trackedTempDir("pi-claudify-banner-upgrade"), "home");
	mkdirSync(join(legacyInstallHome, ".pi"), { recursive: true });
	writeFileSync(join(legacyInstallHome, ".pi", "settings.json"), JSON.stringify({ theme: "dark", quietStartup: true }));
	process.env.HOME = legacyInstallHome;
	clearSettingsCache();
	delete process.env.PI_CLAUDIFY_BANNER_MODE;
	const sentinelHeader = { disposed: false, render: () => ["sentinel"], invalidate() {}, dispose() { this.disposed = true; } };
	const defaultOwnership = bannerHarness(true, sentinelHeader);
	await defaultOwnership.fire("session_start", { reason: "startup" });
	assert.equal(defaultOwnership.setHeaderCalls, 0, "default banner mode does not replace an existing custom header");
	assert.equal(defaultOwnership.header, sentinelHeader);
	assert.equal(sentinelHeader.disposed, false);
	await defaultOwnership.fire("session_shutdown");

	process.env.PI_CLAUDIFY_BANNER_MODE = "off";
	const ownership = bannerHarness(true);
	await ownership.fire("session_start", { reason: "startup" });
	assert.equal(ownership.setHeaderCalls, 0, "off mode does not install a replacement header");

	process.env.PI_CLAUDIFY_BANNER_MODE = "always";
	await ownership.fire("turn_start");
	assert.equal(ownership.setHeaderCalls, 2, "off to on installs after probing disposal ownership");
	assert.ok(ownership.header);

	process.env.PI_CLAUDIFY_BANNER_MODE = "off";
	await ownership.fire("turn_start");
	assert.equal(ownership.setHeaderCalls, 3, "on to off restores the built-in header when still owner");
	assert.equal(ownership.header, undefined);

	process.env.PI_CLAUDIFY_BANNER_MODE = "always";
	await ownership.fire("turn_start");
	const laterOwner = { render: () => ["later"], invalidate() {} };
	ownership.ui.setHeader(() => laterOwner);
	const callsAfterLaterOwner = ownership.setHeaderCalls;
	process.env.PI_CLAUDIFY_BANNER_MODE = "off";
	await ownership.fire("turn_start");
	assert.equal(ownership.setHeaderCalls, callsAfterLaterOwner, "disposal proves displacement, so off does not clear a later owner");
	assert.equal(ownership.header, laterOwner);
	await ownership.fire("session_shutdown");

	// A host that accepts dispose-capable components but never invokes dispose
	// cannot prove ownership. Fail closed: never clear what may be another owner.
	process.env.PI_CLAUDIFY_BANNER_MODE = "always";
	const legacy = bannerHarness(false);
	await legacy.fire("session_start", { reason: "startup" });
	const legacyLaterOwner = { render: () => ["legacy later"], invalidate() {} };
	legacy.ui.setHeader(() => legacyLaterOwner);
	const legacyCalls = legacy.setHeaderCalls;
	process.env.PI_CLAUDIFY_BANNER_MODE = "off";
	await legacy.fire("turn_start");
	assert.equal(legacy.setHeaderCalls, legacyCalls, "older hosts fail closed without disposal evidence");
	assert.equal(legacy.header, legacyLaterOwner);
	await legacy.fire("session_shutdown");
} finally {
	if (oldMode === undefined) delete process.env.PI_CLAUDIFY_BANNER_MODE;
	else process.env.PI_CLAUDIFY_BANNER_MODE = oldMode;
	if (ownershipHome === undefined) delete process.env.HOME;
	else process.env.HOME = ownershipHome;
	clearSettingsCache();
}

console.log("banner rendering, trust, sanitization, and ownership tests passed");
