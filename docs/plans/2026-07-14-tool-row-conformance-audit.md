# Tool-row conformance audit: pi vs Claude Code

Status: ground truth
Date: 2026-07-14
Method: Claude Code v2.1.x and pi (this package, working tree) driven through an
**identical 10-turn script** in two cmux workspaces, frames polled at 0.6s through
every turn so in-flight and settled states are both captured. Not reconstructed.

Script: write a file · edit it · read a file · read a 120-line file · read a missing
file · `echo hello` · `bash -c "exit 3"` · grep a pattern · glob `src/*.ts` · list a
directory.

Scope: tool rows and transcript only. Prompt box, footer, and banner are out of scope.
pi-only surfaces (task lists, MCP panel) keep pi's own styling and are not audited.

## The single root cause

**Claude Code aggregates read-only tools even when there is only one of them.** Every
read-only call — one or many — joins a gerund header, contributes a `⎿` target row, and
collapses to a dim past-tense line when the turn settles. There is no per-tool row for
a read-only tool at any count.

This package's group renderer only engages for a **run of two or more** consecutive
read-only tools (`hasConsecutiveReadOnlyInspectionToolChildren`), so the common
single-tool case falls through to an individual `⏺ Tool(args)` row with a count
summary. That one gate accounts for nearly every divergence below.

Mutating tools (`Write`, `Update`) already match exactly.

## Side by side

### Read — one file

```
CLAUDE CODE                        PI (current)
⏺ Reading 1 file…                  ⏺ Read(src/alpha.ts)
  ⎿  src/alpha.ts                    ⎿  4 lines loaded (ctrl+o to expand)
  Read 1 file          (settled)
```

### Read — missing file

Claude Code renders it exactly like any other read; the failure is left to the model's
prose. pi reports a **failed** read as a success, and ungrammatically:

```
CLAUDE CODE                        PI (current)
  ⎿  src/does-not-exist.ts           ⏺ Read(src/does-not-exist.ts)
  Read 1 file                        ⎿  1 lines loaded (ctrl+o to expand)
```

### Bash

```
CLAUDE CODE                        PI (current)
⏺ Running 1 shell command…         ⏺ Bash(echo hello)
  ⎿  $ echo hello                    ⎿  Done (1 lines) (ctrl+o to expand)
  Ran 1 shell command  (settled)

                                   ⏺ Bash(bash -c "exit 3")
                                     ⎿  Exit 3 (ctrl+o to expand)
```

### Grep

The `⎿` target is the bare quoted pattern — Claude Code does **not** append the search
path, and the result row is not a match count.

```
CLAUDE CODE                        PI (current)
⏺ Searching for 1 pattern…         ⏺ Grep("needle" in src)
  ⎿  "needle"                        ⎿  4 matches (ctrl+o to expand)
  Searched for 1 pattern (settled)
```

### Glob

```
CLAUDE CODE                        PI (current)
  ⎿  "src/*.ts"                     ⏺ Find("src/*.ts")
                                      ⎿  3 files (ctrl+o to expand)
```

### List a directory

Claude Code routed this through **Bash** (`ls -la`) yet still rendered it under a
`Listing…` clause — semantic bash display, which this package has but maps differently.
The `⎿` target is the raw command, with an absolute path.

```
CLAUDE CODE                        PI (current)
⏺ Listing 1 directory…             ⏺ List(src)
  ⎿  $ ls -la /abs/path/to/src        ⎿  4 entries (ctrl+o to expand)
  Listed 1 directory   (settled)
```

## Gap inventory, ranked

| # | Gap | Evidence |
|---|-----|----------|
| 1 | **A single read-only tool must aggregate and collapse**, not render its own `⏺ Tool(args)` row. Root cause of #2–#5. Requires relaxing the 2+ gate and rewriting `test-tool-chrome.ts`, which currently asserts the wrong behavior (`⏺ Read(src/a.ts)`). | every read-only turn |
| 2 | **A failed read renders as a success** — `⎿ 1 lines loaded` for a file that does not exist. Genuine bug, independent of grouping. | missing-file turn |
| 3 | `1 lines loaded` — ungrammatical; the individual-row path does not use the existing `plural()` helper. | missing-file turn |
| 4 | Grep's `⎿` target is `"needle"`, not `"needle" in src`. | grep turn |
| 5 | Result rows for read-only tools (`4 matches`, `3 files`, `4 entries`, `Done (1 lines)`, `Exit 3`) do not exist in Claude Code at all — the aggregate supplies the summary. | all read-only turns |
| 6 | ~~Live spinner glyph is `·` in Claude Code~~ **Corrected (CLFY-8):** the live glyph is *not* static. Claude Code rotates through the glyph set (`· ✢ ✳ ✶ ✻ ✽`) at **2 Hz** — one frame every 500 ms. The `·`-only reading was a polling artifact: frames sampled at 0.6s (see Method) aliased a moving spinner onto its `·` frame. `✻` appears both mid-rotation and as the settled *worked* glyph. pi already animated the same set, but at the inherited 250 ms (4 Hz); the fix corrects the cadence to 2 Hz. Verified live by the maintainer. | every turn |
| 7 | Clause order: Claude renders `reading` before `listing`; this package's `CLAUSE_ORDER` puts `ls` before `read`. | earlier MCP capture |

## Expanding the collapsed line

Claude Code's collapsed line (`Read 1 file`, `Ran 1 shell command`) is **clickable** and
expands to reveal the full file, command, or pattern. No keybinding does it — `ctrl+o`
and `ctrl+r` were both tested against a live session and neither expands the group.

So collapsing must *hide* the tool rows, never discard them. In this package, expanding a
tool (`expanded === true`) drops it out of the group via
`isReadOnlyInspectionToolExecution`, which restores its full `⏺ Read(path)` row — pi's
equivalent of Claude's click.

**Mouse click cannot be implemented from an extension.** pi-tui never enables mouse
tracking (there is no `?1000h`/`?1006h` sequence anywhere in it), so pi never receives
click events at all, and pi-tui exposes no mouse API on components — no `onMouse`, no
hit regions; the only occurrence of "mouse" is a comment about buffering escape
sequences. Making the collapsed line clickable requires an upstream pi-tui change.
`ctrl+o` is the available affordance and it works (confirmed in the pi TUI).

## Glob folds into grep

Claude Code gives Glob no clause of its own. A glob for `src/*.ts` renders under grep's
clause, with the quoted pattern as its target:

```
⏺ Searching for 1 pattern…
  ⎿  "src/*.ts"
  Searched for 1 pattern
```

A grep and a glob in the same turn therefore read as `Searched for 2 patterns`.

## Not divergences

- `Write` / `Update` headers, sentences, numbered listing, and diff gutters all match.
- The `✻ Baked for 8s` worked line matches (verb set differs by config, not grammar).
- `⎿ Loaded ~/.claude/rules/*.md` rows are Claude-Code-specific (rules loading) and have
  no pi equivalent — out of scope, nothing to mirror.
