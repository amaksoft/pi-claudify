# Shell command rows: click targets, running preview, hit-test anchoring

Date: 2026-09-08
Status: implemented on `feat/clickable-inspection-groups`

## Captured reference (Claude Code v2.1.261, live tmux session)

A 20-tick `for` loop, observed in all three states:

- **Running:** no output dump. A status line plus the command with live
  elapsed/count — `⎿ $ for i in …; sleep 1; done (6s · 7 lines)` — and a
  `(ctrl+b ctrl+b (twice) to run in background)` hint. pi has no background
  action, so the hint has no equivalent here.
- **Collapsed:** `Ran 1 shell command`, no output, no command text.
- **Expanded:** full untruncated command plus the complete output (all 20
  lines, not a capped preview).
- **Click targets (synthetic SGR left-clicks):** clicking the collapsed
  `Ran 1 shell command` line expands inline to the full command + full output;
  clicking the expanded `⏺ Bash(…)` header collapses back. Both the header row
  and the result row toggle. Verified: click summary → expanded; click header
  at its true pane row → collapsed again.

## Contract this extension implements

1. **Collapsed:** `Ran 1 shell command` (or the aggregate form), command and
   output hidden. Matches Claude.
2. **Expanded:** full command (wrapped, never clipped past the header width)
   plus output. Matches Claude, which also shows everything.
3. **Running:** header keeps the total count (`Running... (N lines)`), which
   already proves liveness. Below it, a preview capped at `bashCollapsedLines`
   (default 10): the head by default, or the tail when `bashRunningPreview` is
   `"tail"`. The marker states only what is hidden (`… +N more lines` / `… +N
   earlier lines`) — it never says `ctrl+o to expand`, because `ctrl+o` is a
   global toggle whose next action may be collapse. The same cap applies after
   a click/ctrl+o dissolves the aggregate into a native running Bash row:
   expansion changes interaction ownership, not streaming-output volume. No
   elapsed timer (pi gives the extension no per-tick clock in this path).
4. **Settled expanded output:** uses the separate
   `expandedPreviewMaxLines` ceiling (default 4000). A 100-line command is
   intentionally complete under the default; set Expanded preview max lines in
   `/claudify` for a shorter expanded transcript.
5. **Click targets:** every row the user perceives as the block is interactive.
   Settled aggregate summary → native rows; active aggregate header **and** its
   `$ command` target rows → native running row; native Bash header and result
   rows toggle core's own expansion state. Framing belongs to the block, so a
   click on its spacer/border cannot shift the target into a neighbour.

## Hit-test anchoring rule

pi hit-tests clicks from `mouseLayout`, which core writes for the *unframed*
lines. Any render path that paints different lines than its children produced
must re-anchor first/last child heights to what it actually painted:

- trimmed leading blanks belonged to the first child's top; trailing blanks to
  the last child's bottom;
- framing lines (spacer, borders) belong to the block: top framing goes to the
  first child, the bottom border to the last, so the whole row stays clickable.

Without this, every painted line below a tool row routes off by the framing
height — observably: header clicks miss while result clicks still toggle. The
pure math lives in `anchorFramedHeights` (unit-tested); the install itself in
the tool branch of `patchedContainerRender` via `installMouseLayout`, which
no-ops on hosts without the field. Never invent regions for lines no child
painted, and never let a mapping go negative — clamp.
