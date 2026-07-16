# Grammar: the never-captured surfaces (Agent, Fetch, Web Search, images, truncation, compaction)

Status: ground truth
Date: 2026-07-15
Backs: CLFY-10

Method: a live **Claude Code v2.1.211** session (Opus 4.8, `⏵⏵ auto mode on`) driven
through each surface in a cmux workspace, the screen polled every ~0.35s through every
turn so in-flight and settled states are both captured from real frames. Not
reconstructed. Raw frames were diffed to extract the progressions below.

Scope: the six surfaces CLFY-10 names — Task/subagent rows, WebFetch, WebSearch, image
results, truncation / `ctrl+o` hints, and the compaction notice. Each surface records
Claude Code's grammar, then the divergence from this package's current rendering (pi
code cited by file:line). Divergences are inventoried and ranked at the end; each gets a
follow-up fix issue.

Pinned versions: **Claude Code v2.1.211**, model Opus 4.8 (1M context). pi side = this
package, working tree at commit `7a9864f`.

> Note on the two glyphs. Claude Code's bottom status line carries an **animated** glyph
> that cycles `· ✢ ✳ ✶ ✻ ✽` (~2/s) ahead of a whimsical verb and `(Ns · ↓ N tokens)`.
> The settled worked line is a **static** `✻ Worked for Ns`. See the spinner section.

---

## Agent (Task / subagent)

pi tool name `Agent`; Claude Code header label `Agent`.

### In-flight

The header appears immediately, then a `⎿ Initializing…` sub-row. While the subagent
runs, **its own nested tool calls stream into the parent's `⎿` region** with a live
`Running…` and a background hint:

```
⏺ Agent(Count lines with 'fox')
  ⎿  Initializing…
```

then, mid-run:

```
⏺ Agent(Count lines with 'fox')
  ⎿  Bash(grep -c fox /abs/path/bigfile.txt)
     Running…
     (ctrl+b to run in background)
```

Status line during the agent turn (glyph animates):

```
✽ Whispering to the Ents… (13s · ↓ 382 tokens)
```

### Settled

```
⏺ Agent(Count lines with 'fox')
  ⎿  Done (1 tool use · 38.2k tokens · 9s)

  ⎿  Allowed by auto mode classifier      ← auto-mode only; the permission note

⏺ 400 lines contain the word "fox" …       ← the model's prose

✻ Worked for 19s
```

- Header: `⏺ Agent(<description>)` — the Task's `description` param, unquoted.
- Settled result: `⎿  Done (<N> tool use · <X>k tokens · <N>s)` — tool-use count, token
  total, elapsed. This summary is the whole result row; there is no per-child row left.

### pi runtime payload investigation (CLFY-20)

The installed runtime is `@earendil-works/pi-coding-agent@0.80.7` with
`@tintinweb/pi-subagents@0.14.1`. pi does surface Agent progress updates: its interactive
mode forwards each `tool_execution_update`'s `partialResult` into
`ToolExecutionComponent.updateResult(..., true)` (`dist/modes/interactive/interactive-mode.js:2412–2416`),
and the component gives the result renderer only `{ content, details }` plus
`isPartial: true` (`dist/modes/interactive/components/tool-execution.js:130–134, 247–249`).

The Agent extension emits those updates about every 80 ms. Its partial `details` contain
aggregate fields — `toolUses`, `tokens`, `turnCount`, `maxTurns`, `durationMs`,
`status: "running"`, a preformatted `activity` string, and `spinnerFrame` — while
`content` is only `<N> tool uses...` (`pi-subagents/src/index.ts:1266–1289, 1316–1322`).
There is **no nested child call payload**. The child session's tool events are reduced to
`{ type, toolName }` before they leave the runner (`pi-subagents/src/agent-runner.ts:749–753`),
then the activity tracker uses the name plus start/end state to maintain its active set
(`pi-subagents/src/index.ts:94–105`). Arguments, tool-call IDs, child partial results, and
output are discarded. Even `bash` becomes only the preformatted activity `running command…`
(`pi-subagents/src/ui/agent-widget.ts:25–34, 197–210`).

Therefore pi exposes aggregate progress, but not the structured nested progress required
to reproduce `Bash(grep -c fox …)`. The capture-backed in-flight shape this package can
render is the static `⎿  Initializing…` row only. It must not invent a child call from the
lossy activity string, nor append Claude Code's nested-only `Running…` and
`(ctrl+b to run in background)` lines without that call.

### pi divergence

- **Header matches**: `humanizeToolName("Agent")` → `Agent` (index.ts:3510).
- **In-flight is partially aligned by CLFY-20**: `renderOpenAiToolResult` now renders
  `⎿ Initializing…` for an Agent partial (index.ts:4383–4387). The streamed nested child
  remains unavailable because the investigation above confirms that its data does not
  reach this package's renderer.
- **Settled result differs**: pi emits `Done` without stats (index.ts:4379). Claude Code
  emits `Done (<N> tool use · <X>k tokens · <N>s)`. CLFY-16 intentionally owns that
  settled path; CLFY-20 does not change it.

---

## Fetch (WebFetch)

pi tool name `webfetch`; Claude Code header label **`Fetch`**.

### Settled (WebFetch settles sub-second; no distinct in-flight frame was catchable)

```
⏺ Fetch(https://example.com)
  ⎿  Received 559 bytes (200 OK)
  ⎿  Allowed by auto mode classifier
```

- Header: `⏺ Fetch(<url>)`.
- Result: `⎿  Received <N> bytes (<HTTP status>)`.

### pi divergence

- **Header differs**: `humanizeToolName("webfetch")` → `Webfetch` (index.ts:3510), not
  `Fetch`. Needs a name override.
- **Result differs**: pi → `<N> lines returned (ctrl+o to expand)` (index.ts:4395–4397).
  Claude Code → `Received <N> bytes (<status>)`, no `(ctrl+o to expand)`.

---

## Web Search

pi tool name `web_search`; Claude Code header label `Web Search`.

### Settled

```
⏺ Web Search("Claude Code changelog 2026")
  ⎿  Did 1 search in 8s
  ⎿  Allowed by auto mode classifier
```

- Header: `⏺ Web Search("<query>")` — the query is **double-quoted**.
- Result: `⎿  Did <N> search in <N>s`.

### pi divergence

- **Header label matches**: `humanizeToolName("web_search")` → `Web Search`
  (index.ts:3510). But pi's arg summary is `summarizeText(query, 72)` with **no quotes**
  (index.ts:4174) → `Web Search(query)`. Claude Code quotes it → `Web Search("query")`.
- **Result differs**: pi → `<N> lines returned (ctrl+o to expand)`. Claude Code →
  `Did <N> search in <N>s`.

---

## Image results

A `Read` of an image renders **exactly like any other read** — there is no
image-specific tool-row chrome. The image bytes go to the model; the transcript row is
a plain aggregated read.

### In-flight

```
⏺ Reading 1 file…
  ⎿  pixel.png
```

### Settled

```
  Read 1 file
```

(The model then describes the image in prose. `ctrl+o` does not reveal an image
preview in the row.)

### Degenerate / unsupported image → an error notice (bonus capture)

A 1×1 PNG the API refused surfaced a distinct **error-notice** surface, worth recording:

```
⏺ API Error: an image in the conversation could not be processed and was removed.
  Double press esc to edit your message, or re-read the file if you still need it.
```

### pi divergence — CONFIRMED by live capture (2026-07-15, CLFY-18)

Live pi+claudify capture of `Read`-ing a 48×48 PNG (claudify loaded; confirmed via its
`Cooked` worked-verb). claudify renders a **bespoke image row**, not a plain read:

```
⏺ Read(/abs/path/pixel.png)
  ⎿  Image loaded [image/png] (ctrl+o to show)
```

That result line is claudify's own output, built in `renderCapturedOpenAiResult`/the image
branch at **index.ts:4353–4355**: `theme.fg("success", "Image loaded")` +
`theme.fg("muted", "[<mime>]")` + `theme.fg("muted", " (ctrl+o to show)")`. The
`patchReadImageExpansion` hook (index.ts:1102–1116, `toolName === "read" && hasImage`)
strips the expanded image child but leaves this summary row.

**Divergences from the captured Claude Code target (all three real — CLFY-18 is NOT a no-op):**
1. Claude Code shows an ordinary aggregated read (`Read 1 file`), no image-specific chrome;
   claudify shows bespoke `Image loaded [<mime>]`.
2. claudify appends `(ctrl+o to show)` — Claude Code never puts a `ctrl+o` affordance on a
   tool row (same pi-ism as divergence #7).
3. Header is `Read(<full abs path>)`; Claude Code uses the basename / aggregate form.

Open design question for the fix: pi has no line-count for an image, so the exact
replacement for Claude Code's `Read 1 file` must be decided (mirror the read aggregate, or
a minimal `Read 1 file`-style line) rather than blindly copied.

---

## Truncation ( `… +N lines` )

Claude Code truncates a long tool preview to the first 10 lines and appends a dim
`… +N lines` marker — **with no `(ctrl+o to expand)` suffix**. Captured on a `Write`:

```
⏺ Write(notes.md)
  ⎿  Wrote 60 lines to notes.md
       1 1. item one about foxes
       2 2. item two about foxes
       …
      10 10. item ten about foxes
     … +50 lines
```

Long **read/bash** output never shows a truncation marker at all: it collapses into the
read/bash aggregate (`Read 1 file`, `Ran 1 shell command`) and the body is hidden
entirely. So the only `+N lines` marker in the transcript is on mutation previews.

### Where `ctrl+o` actually appears

`ctrl+o` is **never** on a tool result row in Claude Code v2.1.211. Across every captured
surface (read, bash, grep, glob, Fetch, Web Search, Agent, Write) not one row carried
`(ctrl+o to expand)`. The only `ctrl+o` affordance in the transcript is on the
**compaction summary** (below). pi, by contrast, appends `(ctrl+o to expand)` to
OpenAI-style tool results (index.ts:4397) and to read-only result rows — a pi-ism with
no Claude Code counterpart (already noted for read-only tools in the 2026-07-14 audit,
gap #5; it extends to Fetch/Web Search/Agent).

### pi divergence

- **Write truncation matches** in form (numbered lines then `… +N lines`), per the
  2026-07-14 audit ("Write … numbered listing … match"). No new issue for Write.
- **`(ctrl+o to expand)` suffix on OpenAI-style tools** is a divergence — see the Fetch /
  Web Search / Agent sections; tracked once as a shared cleanup.

---

## Compaction notice

### In-flight

A `·`-led (animated) status line plus a Unicode progress bar that counts up:

```
· Compacting conversation…
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 4%
```

```
✽ Compacting conversation… (40s)
  ██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░ 36%
```

### Settled

```
❯ /compact
  ⎿  Compacted (ctrl+o to see full summary)
  ⎿  Read notes.md (61 lines)
  ⎿  Referenced file bigfile.txt
  ⎿  Read ~/.claude/rules/common-agents.md (51 lines)
  ⎿  Read ~/.claude/rules/context7.md (17 lines)
  ⎿  Read ~/.claude/rules/common-testing.md (30 lines)
```

- Settled head row: `⎿  Compacted (ctrl+o to see full summary)` — the sole `ctrl+o`
  affordance in the whole transcript.
- Then context **re-hydration** rows: `⎿  Read <path> (<N> lines)` and
  `⎿  Referenced file <name>` — the files pulled back into the fresh context.
- Context indicator resets to `Ctx: 0%`.

### pi native rendering — CONFIRMED by live capture (2026-07-15, CLFY-19)

Live pi+claudify capture of `/compact` on an ~85k-token session. **claudify has zero
compaction handling** (source grep for `compact` finds only the unrelated
`messageSpacing` enum and a `compactList` string util) — so this is pi's *native*
rendering passing straight through, unstyled:

```
 [compaction]

 Compacted from 85,175 tokens (ctrl+o to expand)
```

- `[compaction]` marker: **bold**, RGB `149,117,205` (violet).
- Settled line: RGB `212,212,212` text, with `ctrl+o` in dim RGB `102,102,102`.
- **No progress bar** — polling at 0.3 s intervals caught no `██░░`/`%` frame; pi goes
  straight from the working state to the settled line (Claude Code's animated
  `· Compacting conversation…` bar has no pi counterpart).
- **No re-hydration rows** — pi does not list the files pulled back into fresh context.
- **No branch chrome** — plain ` [compaction]` marker, no `❯ /compact` echo, no `⎿`.
- Context indicator resets to `—% / 372k`.
- Bonus (failure path): too-small session → a plain notice
  ` Error: Compaction failed: Nothing to compact (session too small)` (no `⏺` glyph).

**Divergences from the captured Claude Code target (4 axes — CLFY-19 is from-scratch work):**
1. In-flight: no `· Compacting conversation…` + progress bar.
2. Settled wording: `Compacted from N tokens (ctrl+o to expand)` vs
   `Compacted (ctrl+o to see full summary)`.
3. No re-hydration `⎿ Read <path> (<N> lines)` rows.
4. No `⎿`/`❯` branch chrome. claudify must patch pi's compaction component from zero.

---

## Spinner glyph — corrects the 2026-07-14 audit gap #6 (and bears on CLFY-8)

The 2026-07-14 audit gap #6 read "Live spinner glyph is `·` in Claude Code, `✻` in pi,"
and CLFY-8 / PR #22 acted on it by replacing pi's animated frame set with a **static**
`LIVE_SPINNER_FRAMES = ["·"]`.

Frame-by-frame capture of the bottom status line contradicts the "static `·`" reading.
The leading glyph **animates**, cycling `· ✢ ✳ ✶ ✻ ✽` at ~2 Hz. Consecutive frames of a
single Web Search turn:

```
✽ Riding for Gondor… (2s · ↓ 52 tokens · thinking with high effort)
✳ Riding for Gondor… (2s · ↓ 71 tokens · thinking with high effort)
· Riding for Gondor… (3s · ↓ 78 tokens · thinking with high effort)
✢ Riding for Gondor… (3s · ↓ 83 tokens · thinking with high effort)
✽ Riding for Gondor… (3s · ↓ 84 tokens · thinking with high effort)
✻ Riding for Gondor… (4s · ↓ 99 tokens · thought for 1s)
✳ Riding for Gondor… (4s · ↓ 105 tokens)
· Riding for Gondor… (5s · ↓ 111 tokens)
…
```

`·` is **one frame of six**, not the whole glyph. This cycle is exactly the set pi's
pre-CLFY-8 spinner already animated. **Finding: CLFY-8 / PR #22 (unmerged) is a
regression** — it freezes a six-frame animation to a single dot and thereby diverges
from Claude Code, which the original pi behavior matched. The audit's `·` was one
aliased frame of the animation, not a static glyph.

The settled worked line (`✻ Worked for Ns`) is static `✻` and already matches pi — that
part of gap #6 stands.

---

## Divergence inventory, ranked

| # | Surface | Claude Code | pi (current) | pi code |
|---|---------|-------------|--------------|---------|
| 1 | **Spinner glyph** (CLFY-8 regression) | animates `· ✢ ✳ ✶ ✻ ✽` | PR #22 freezes to static `·` | spinner.ts `LIVE_SPINNER_FRAMES` |
| 2 | Fetch header | `Fetch(url)` | `Webfetch(url)` | index.ts:3510 |
| 3 | Fetch result | `Received N bytes (200 OK)` | `N lines returned (ctrl+o to expand)` | index.ts:4395 |
| 4 | Web Search result | `Did N search in Ns` | `N lines returned (ctrl+o to expand)` | index.ts:4395 |
| 5 | Agent result | `Done (N tool use · Xk tokens · Ns)` | `Done` / `N lines returned …` | index.ts:4386,4395 |
| 6 | Agent in-flight | `⎿ Initializing…` → streamed child tool + `Running… / (ctrl+b to run in background)` | `⎿ Initializing…`; nested child unavailable upstream | index.ts:4383–4387 |
| 7 | `(ctrl+o to expand)` suffix on OpenAI-style results | absent everywhere on tool rows | appended | index.ts:4397 |
| 8 | Web Search query quoting | `Web Search("query")` | `Web Search(query)` | index.ts:4174 |
| 9 | Compaction notice | `· Compacting…` + bar; `Compacted (ctrl+o to see full summary)` + re-hydration rows | pi-native `[compaction]` + `Compacted from N tokens (ctrl+o to expand)`, no bar/re-hydration/chrome; claudify unstyled | index.ts (none) |
| 10 | Image read | plain aggregated read row (`Read 1 file`) | `⎿ Image loaded [mime] (ctrl+o to show)` (bespoke) | index.ts:4353–4355 |

Not divergences: Agent header (`Agent` matches), Web Search header label (`Web Search`
matches), Write truncation form (`… +N lines`, matches per 2026-07-14 audit), settled
`✻ Worked for Ns` line.
