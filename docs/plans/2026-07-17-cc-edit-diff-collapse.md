# Capture: Claude Code's Edit/Update diff collapse height — CLFY-23

**Date:** 2026-07-17
**Issue:** CLFY-23 — "Collapsed diff lines" doesn't apply to edit/Update rows
**Claude Code version:** **2.1.212** (Opus 4.8, `--permission-mode acceptEdits`)
**Method:** drove Claude Code in a detached tmux session; created files of 50 and 130 lines,
forced a **single Edit call** rewriting every line (old_string = whole file), and captured the
rendered Update diff with `tmux capture-pane -e -p`.

---

## Result — Claude Code does NOT collapse Edit/Update diffs

Both edits rendered their **entire** diff in the transcript with **no truncation and no
collapse affordance**:

- The 50-line edit showed all changed lines (removals then additions), ending at
  `50 +value_50 = 5007`, immediately followed by the assistant summary and `✻ Sautéed for 25s`.
- The 130-line edit likewise rendered through `130 +row_130 = 130_x`, then `✻ Crunched for 34s`.
- **Zero** `… +N lines`, `ctrl+r to expand`, `(N/M)`, or `…` markers anywhere in the settled
  transcript or scrollback, at either size.

(An earlier `History 2/2` reading was a false lead — it was Claude Code's **input-history**
indicator triggered by my own Up-arrow keypresses, not a diff pager. It did not recur once I
stopped pressing Up.)

So there is **no fixed "collapsed Update height" in Claude Code to match.** For a realistic
edit (tested to 130 changed lines) CC shows the whole thing. This directly answers the
question CLFY-23 flagged as uncaptured ("does CC's Update row collapse to the same budget as
Write?"): **no — CC collapses neither; it renders full diffs.**

## What this means for the decision

claudify's diff *collapse* (`diffCollapsedLimit()`, default 10, applied to Write; a hardcoded
32 for single-edit at index.ts:3560; a computed budget for multi-edit at index.ts:3574) is a
**claudify-specific compaction feature**, not an emulation of a CC behavior. CC renders diffs
in full; claudify caps them and offers expand. That reframes CLFY-23:

- The blocker on **Option 1** ("honour `diffCollapsedLimit()` in edit/multi-edit — but first
  capture CC's Update collapse height, per capture-don't-guess") is **removed**: there is no
  CC Update height, so nothing about CC fidelity argues for keeping edit at 32. The choice is
  purely about claudify's own compaction knob.
- Because the setting row lives in the **Diffs** Section and is generically named
  ("Collapsed diff lines"), a user reasonably expects it to govern *all* diffs. Today it
  silently governs only Write — a soft breach of the live-reflection contract.

## Decision (2026-07-17, Berto): Option 2 — keep the larger edit budget, rename the row

Berto's directive was "which is most like CC? do that one." Because **CC renders diffs in
full**, the choice that shows *more* of the diff is the closer one — that is the **larger 32**
budget, not collapsing edits down to `diffCollapsedLimit()`'s default of 10. Option 1 would
have moved edit rows *away* from CC (fewer lines), so it is rejected here despite unifying the
control. For a typical edit (≤32 changed lines) the 32 budget shows the whole diff, matching CC.

Concretely:
- **Leave single-edit at its 32-line collapsed budget** and multi-edit at its computed budget —
  unchanged. No behaviour change to Update rows.
- **Rename the Diffs row** `"Collapsed diff lines"` → **`"Collapsed Write lines"`** so the
  generic "diff" name stops implying it governs Update rows. The description was already
  Write-scoped (CLFY-22); this aligns the label. The `diffCollapsedLines` key is unchanged, so
  existing settings keep working.

**Trade-off, stated plainly:** the setting still does not affect Update rows — but that is now
*honest* (the label says Write), and it is the CC-faithful outcome, since CC does not collapse
edit diffs and the un-collapsed 32-line edit view is closer to CC than honouring a 10-line cap
would be. A user who set the value low to compact Update rows cannot get that — but compacting
Update rows was never CC-like in the first place.

Option 1 (honour the setting in edit/multi-edit) remains a future possibility if claudify ever
decides to prioritise a unified compaction knob over CC fidelity; it is not what "most like CC"
selects.

## Caveats
- Captured on CC 2.1.212 at `acceptEdits`. Very large diffs (thousands of lines) were not
  tested; a cap may exist far above 130 but is irrelevant to the collapse-budget question.
- CC's Edit diff is "all removals, then all additions" with a per-hunk line-number gutter
  (already recorded in `docs/plans/2026-07-13-current-cc-grammar.md`); this capture only adds
  the **height/collapse** finding.
