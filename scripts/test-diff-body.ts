import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

// Isolate ambient config. At module-eval time extensions/index.ts seeds its shiki
// theme from $DIFF_THEME and reads its diff palette from $CWD/.pi/settings.json,
// falling back to $HOME/.pi/settings.json. The palette asserted below is the
// default (Monokai) one, so a developer with either of those set renders other
// token colors and the syntax-highlighting assertions go red. Pin both, then
// import — a static import would be hoisted above these lines.
const sandbox = mkdtempSync(join(tmpdir(), "cc-diff-"));
process.env.HOME = sandbox;
process.chdir(sandbox);
process.env.DIFF_THEME = "monokai";

const { parseDiff, renderFileListing, renderUnified } = await import("../extensions/index.ts");
const { clearSettingsCache } = await import("../extensions/settings.ts");

// Target grammar + palette captured from the raw Claude Code TTY stream:
// docs/plans/2026-07-13-current-cc-grammar.md
const CC_BG_DEL = "\x1b[48;2;95;0;0m";
const CC_BG_ADD = "\x1b[48;2;0;95;0m";
const CC_BG_DEL_WORD = "\x1b[48;2;135;0;0m";
const CC_BG_ADD_WORD = "\x1b[48;2;0;135;0m";
const CC_FG_DEL = "\x1b[38;2;215;95;95m";
const CC_FG_ADD = "\x1b[38;2;95;215;95m";

const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

initTheme("dark", false);

const old = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
const next = "const a = 1;\nconst b = 20;\nconst c = 30;\n";

const raw = await renderUnified(parseDiff(old, next), "typescript", 50, undefined, 80);
const plain = strip(raw);

// No box chrome: Claude Code has no ▌ bar, no │ divider, and no ─── rules.
assert.doesNotMatch(plain, /▌/);
assert.doesNotMatch(plain, /│/);
assert.doesNotMatch(plain, /─/);

// Unified hunk: removals carry old line numbers, additions carry new ones, and all
// removals precede all additions.
//   1  const a = 1;
//   2 -const b = 2;
//   3 -const c = 3;
//   2 +const b = 20;
//   3 +const c = 30;
assert.match(plain, /^ 1 {2}const a = 1;/m);
assert.match(plain, /^ 2 -const b = 2;/m);
assert.match(plain, /^ 3 -const c = 3;/m);
assert.match(plain, /^ 2 \+const b = 20;/m);
assert.match(plain, /^ 3 \+const c = 30;/m);

const lines = plain.split("\n").filter((line) => /^ \d+ [-+]/.test(line));
const firstAdd = lines.findIndex((line) => / \+/.test(line));
const lastDel = lines.map((line) => / -/.test(line)).lastIndexOf(true);
assert.ok(lastDel < firstAdd, "all removals must precede all additions");

// Exact palette, including the brighter background on the changed token.
assert.ok(raw.includes(CC_BG_DEL), "removed line background");
assert.ok(raw.includes(CC_BG_ADD), "added line background");
assert.ok(raw.includes(CC_FG_DEL), "removed gutter foreground");
assert.ok(raw.includes(CC_FG_ADD), "added gutter foreground");
assert.ok(!raw.includes(CC_BG_DEL_WORD), "Claude mode keeps one uniform background on removed rows");
assert.ok(raw.includes(CC_BG_ADD_WORD), "added changed-token background");

// Removed lines are NOT syntax-highlighted — their content is plain foreground,
// while added lines keep their Monokai tokens.
const delLine = raw.split("\n").find((line) => strip(line).startsWith(" 2 -")) ?? "";
const addLine = raw.split("\n").find((line) => strip(line).startsWith(" 2 +")) ?? "";
const MONOKAI_KEYWORD = "\x1b[38;2;102;217;239m";
assert.ok(!delLine.includes(MONOKAI_KEYWORD), "removed line must not be syntax-highlighted");
assert.ok(!delLine.includes("\x1b[1m"), "Claude delete gutter and content are not bold");
assert.ok(addLine.includes(MONOKAI_KEYWORD), "added line must keep syntax highlighting");
assert.ok(!addLine.includes("\x1b[1m"), "Claude add gutter and content are not bold");
assert.ok(!addLine.includes("\x1b[3m"), "Claude diff keywords use Monokai color without italic font style");
assert.ok(!addLine.includes("\x1b[38;2;249;38;114m"), "operators remain Claude's default foreground rather than Monokai pink");
assert.ok(addLine.includes("\x1b[38;2;255;255;255m="), "default diff foreground matches Claude xterm 231");

const jsonRaw = await renderUnified(
	parseDiff('{\n  "enabled": false,\n  "count": 1\n}\n', '{\n  "enabled": true,\n  "count": 42\n}\n'),
	"json",
	50,
	undefined,
	80,
);
assert.ok(jsonRaw.includes("\x1b[38;2;166;226;46m\"enabled\""), "JSON property names match Claude's green");
assert.ok(jsonRaw.includes("\x1b[38;2;249;38;114m\x1b[48;2;0;135;0mtrue"), "JSON booleans match Claude's pink on changed-add green");

const pythonRaw = await renderUnified(
	parseDiff('greeting = "old"\nretries = 1\nprint(greeting, retries)\n', 'greeting = "new"\nretries = 3\nprint(greeting, retries)\n'),
	"python",
	50,
	undefined,
	80,
);
assert.ok(pythonRaw.includes("\x1b[38;2;166;226;46mprint"), "Python built-ins match Claude's green");

// A write renders as a plain numbered listing: no sign column, no green background.
const listing = await renderFileListing("const a = 1;\nconst b = 2;\n", "typescript", 50, 80);
const listingPlain = strip(listing);
assert.match(listingPlain, /^ 1 const a = 1;/m);
assert.match(listingPlain, /^ 2 const b = 2;/m);
assert.doesNotMatch(listingPlain, /^\s*\d+ \+/m);
assert.ok(!listing.includes(CC_BG_ADD), "write listing must not paint an added-line background");

mkdirSync(join(sandbox, ".pi"), { recursive: true });
writeFileSync(join(sandbox, ".pi", "settings.json"), JSON.stringify({ diffSyntaxHighlighting: false }));
clearSettingsCache();
const unhighlighted = await renderUnified(parseDiff(old, next), "typescript", 50, undefined, 80);
const unhighlightedAdd = unhighlighted.split("\n").find((line) => strip(line).startsWith(" 2 +")) ?? "";
assert.ok(!unhighlightedAdd.includes(MONOKAI_KEYWORD), "syntax toggle removes Shiki token colors");
assert.ok(unhighlightedAdd.includes(CC_BG_ADD), "syntax toggle preserves added-line background semantics");
const unhighlightedListing = await renderFileListing("const a = 1;\n", "typescript", 50, 80);
assert.ok(!unhighlightedListing.includes(MONOKAI_KEYWORD), "syntax toggle also applies to Write listings");

console.log("diff body tests passed");
