import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

import { BannerComponent, truncatePath } from "../extensions/banner.ts";

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

console.log("banner rendering tests passed");
