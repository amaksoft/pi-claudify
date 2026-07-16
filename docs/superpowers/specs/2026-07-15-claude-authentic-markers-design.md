# Design — "Claude-authentic" markers on fidelity rows

Date: 2026-07-15
Status: Approved (design), pending implementation plan

## Problem

The `/claudify` screen exists to make pi's transcript render faithfully to Claude
Code. But several enum rows — most visibly in the **Tool output** section — offer
options whose names give no hint about *which value actually reproduces what Claude
Code does*:

- `toolBackground`: `default | transparent | outlines`
- `mcpOutputMode`: `hidden | summary | preview`
- `bashOutputMode`: `opencode | summary | preview`
- `messageSpacing`: `compact | comfortable`

A user changing one of these can't tell "this keeps it faithful to Claude Code"
from "this is a deviation." Worse, some defaults are *not* the Claude-faithful
value: `bashOutputMode` defaults to `opencode`, a mode literally named after and
modeled on another agent CLI (see `docs/plans/2026-06-08-bash-tool-stacking-design.md`),
not Claude Code.

## Goal

On the rows whose value determines fidelity to Claude Code, mark **which option
value reproduces genuine Claude Code rendering**, and — when the user has drifted
off it — name the faithful value so they can get back.

Explicitly *not* a goal: relabeling opaque option names, gating options on
"claude mode," or marking preference rows that have no Claude reference.

## Behavior

For an enum row that carries a captured Claude-authentic value:

- current value **is** the authentic one → append `  ✓ Claude` (themed, dim/success)
- current value **deviates** → append `  (Claude: <value>)`, naming the faithful
  value (themed dim)

Rendered example (Tool output):

```
Tool output

❯ Tool background   transparent   ✓ Claude
  MCP output       preview       ✓ Claude
  Bash output      summary       (Claude: preview)

↑/↓ move · ←/→ change · Esc back
```

Wording is the short form **"Claude"** (not "Claude Code") — narrower on rows that
are already busy, and unambiguous in this settings context.

## Scope — the honest boundary

**"Capture, do not guess" governs which rows are marked.** An authentic value is
asserted only where a `docs/plans/` live capture establishes what Claude Code
actually renders. Rows fall into three buckets:

1. **Self-evident (no marker).** `diffPalette`, `toolChrome`, and `messageStyle`
   already have an option literally named `claude`. A `✓ Claude` next to a value
   reading `claude` is redundant noise — the value name already says it. These get
   **no** marker.

2. **Non-obvious fidelity rows (marker, once a capture pins the value).** These are
   exactly the confusing rows: `toolBackground`, `mcpOutputMode`, `messageSpacing`,
   and — conditionally — `bashOutputMode`. Each gets a marker **only after** a
   capture confirms which value matches Claude Code.

   > **`bashOutputMode` is the live risk.** Its default `opencode` is explicitly
   > *not* Claude's style. Unless a capture shows that `summary` or `preview`
   > matches Claude Code's bash rendering, `bashOutputMode` stays **unmarked**
   > rather than asserting a value we haven't captured. Leaving it unmarked is the
   > correct, honest outcome if no capture supports a value.

3. **Preference rows (never marked).** Collapsed-line counts, spinner colors,
   verbs, group limits, and similar have no single "Claude" answer — they are
   personalization. Never marked.

## Mechanism

- A static map in `extensions/claudify-screen.ts`:

  ```ts
  const CLAUDE_AUTHENTIC: Partial<Record<EditableSettingsKey, string>> = {
    // each entry commented with the docs/plans capture that backs it
  };
  ```

  The map starts populated only from evidence the implementation plan gathers
  (see below). An unbacked key is simply absent.

- Thread an optional `claudeValue?: string` onto `EnumRowDefinition` (consumed by
  `immediateRows`) and onto the inline enum rows built in `messageRows`
  (`messageStyle`, `messageSpacing`) so both construction paths can carry it.

- In `renderSection`, for enum rows only: if the row's key resolves an authentic
  value, append the badge (`✓ Claude`) or the get-back hint (`(Claude: <value>)`)
  to the value display. Route color through the existing `themedText` helper using
  `success`/`dim` — both are common keys already in use (`renderPicker` uses
  `success`), so no `themedByKey` guard is needed here.

- **The badge chrome is claudify's own UI, not a reproduction of Claude Code.**
  Only the *values it points at* are capture-bound; the glyph/wording/placement are
  our design and are not themselves capture-gated.

## Live-reflection contract

Not applicable in the usual sense — this is a read-only annotation of existing
rows. It does not add a persisted setting and does not need `onSettingChange` /
`onSettingPreview` wiring. It only reads the already-resolved row value and the
static authentic map at render time.

## Testing

Extend an existing assembled-render suite (the `test-claudify-hub` / section
render tests) to assert:

1. A row whose current value equals its authentic value renders `✓ Claude`.
2. A row whose current value differs renders `(Claude: <authentic value>)`.
3. A self-evident `claude`-valued row (e.g. `diffPalette`) renders **no** marker.
4. A preference row (e.g. `diffCollapsedLines`) renders **no** marker.

## Out of scope

- Converting enum rows into list subviews / pickers.
- Marking pickers, number rows, or boolean rows.
- Any change to `normalizeAliases` or persisted settings shape.
- Relabeling or re-describing opaque option names.

## Open items for the implementation plan

**Step 1 of the plan is capture research**, before any code:

- For each of `toolBackground`, `mcpOutputMode`, `messageSpacing`, `bashOutputMode`:
  find the `docs/plans/` capture that establishes Claude Code's rendering and read
  off the matching value. Where no capture exists, take a fresh live capture from a
  Claude Code session (per the project's capture discipline) — or, if the mode has
  no Claude analogue, record that and leave the row unmarked.
- Populate `CLAUDE_AUTHENTIC` only from what the captures support, each entry citing
  its capture doc.
