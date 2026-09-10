# Persistent, width-aware edit and write diffs

Date: 2026-09-08
Status: implemented

## Problem

Two independent lifecycle assumptions made otherwise-correct highlighted diffs
fragile:

1. Edit previews were rendered asynchronously into strings held in `ctx.state`.
   Renderer state and component instances are ephemeral; `/reload`, restart, and
   session restoration reconstruct the transcript from persisted args/results.
2. Diff strings were built with `process.stdout.columns` rather than the width
   passed to `Component.render(width)`. Once built, a narrower terminal wrapped
   and padded those old-width rows as ordinary text, mangling gutters and
   backgrounds.

## Captured pi contracts

- Built-in `edit` persists both a display diff and a standard unified patch:
  `result.details = { diff, patch, firstChangedLine }`. The patch contains the
  old and new lines plus real hunk positions, so it is sufficient to rebuild the
  view after the file itself has already changed.
- Built-in `write` persists no old content. Claudify therefore snapshots the old
  file before execution and stores its serializable `ParsedDiff` in the returned
  result details. A restored write can render that model without reading disk.
- `renderCall` and `renderResult` receive no viewport width. The only reliable
  width is the argument to the returned component's `render(width)` method.
- `ctx.state` is component-local cache, not session data. It may speed a live
  render but must never be the only source for historical output.

## Design

- Live edit previews and settled edit/write output return a
  `DiffCardComponent`, not a pre-rendered `Text` string.
- The card owns a source/build closure and caches final rows by render width.
  Wide → narrow → wide rendering is stable and never reuses rows from another
  width.
- Async syntax/diff completion is generation-guarded. Its repaint invalidation
  preserves the just-completed cache once; unrelated invalidations still clear
  all width variants.
- Edit settlement renders from persisted `parsedDiff`/`parsedDiffs`, falling back
  to the built-in standard `details.patch` for older sessions. Filesystem
  reconstruction is used only for the live pre-execution preview.
- Write overwrite settlement renders from the persisted ParsedDiff stored by
  claudify's execute wrapper. Before reading, the old file is statted; files over
  1 MiB and combined old/new inputs over 2 MiB skip diff construction and persist
  an explicit `diffOmitted` reason. New-file listings retain source content in
  tool args, which pi persists.
- Diff body width is derived from `render(width)` minus the result gutter, not
  terminal globals. The existing adaptive unified/split renderer remains the
  single presentation implementation.

## Degradation

Historical write results created before claudify stored a ParsedDiff cannot
reconstruct an overwritten file's old side: the built-in write result has no
patch. Those rows degrade to the stable `Written` summary rather than inventing
a diff from the current file. Historical edit results can recover through
Pi's persisted standard patch.

## Tests

`scripts/test-diff-persistence.ts` executes the real overridden edit and write
tools, JSON-round-trips their results (the session boundary), reconstructs new
`ToolExecutionComponent` instances after the files contain their new content,
and asserts:

- live pre-execution edit preview reflow at wide and narrow widths;
- edit restoration from the built-in patch alone (custom ParsedDiff removed);
- write restoration from the persisted ParsedDiff;
- both old and new sides remain visible;
- the same component renders wide → narrow → wide;
- every narrow row obeys pi's visible-width contract;
- returning to the original width is byte-stable;
- oversized write sources omit the diff explicitly and remain stable on restore.
