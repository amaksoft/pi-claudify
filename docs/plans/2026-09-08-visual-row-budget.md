# Visual-row budgeting and Unicode-safe diff wrapping

Date: 2026-09-08
Status: implemented for Bash, Read, Grep, Find, List, and diff rows

## Problem

A logical-line budget is not a terminal-row budget. Pi can return a 50 KiB
minified line; selecting the first ten logical lines still hands the entire line
to the TUI, which wraps it into hundreds of rows. The same code-unit-based
wrapping split emoji surrogate pairs and ZWJ sequences in narrow diff views.

The reference implementation records the corresponding Claude terminal design:
pre-limit input to `rows * wrapWidth * 4`, hard-wrap by display columns, and
count the post-wrap visual rows. Streaming tail mode keeps the newest visual
rows rather than the newest logical lines.

## Design

- `visual-preview.ts` sanitizes multiline tool output while preserving real line
  boundaries, bounds the source before grapheme segmentation, and returns a
  head/tail visual-row window plus an estimated hidden-row count.
- Width-sensitive preview output is owned by `WidthAwareTextComponent`, whose
  cache key includes source/settings state and whose render cache is keyed by
  `render(width)`.
- Bash running preview preserves the configured `head`/`tail` policy. Settled
  preview/expanded modes retain their existing wording and configured limits.
- Diff wrapping tokenizes ANSI SGR sequences as zero-width cells and visible
  text as `Intl.Segmenter` grapheme clusters measured with pi's `visibleWidth`.
  SGR foreground/background/bold/dim/italic state is replayed across wraps.
- The change is geometry/safety only: captured unified diff grammar, colors,
  gutters, truncation symbols and setting names remain unchanged.

## Tests

- 50 KiB one-line Bash streaming output remains within the visual-row budget at
  width 100, for both head and tail modes.
- Every rendered row satisfies pi's visible-width contract.
- Multi-edit restore/resize uses CJK, emoji, flags/ZWJ families and asserts no
  lone surrogate is introduced.
- Existing exact grammar and head/tail tests remain unchanged.

Find/List preserve their item identity while budgeting wrapped rows, so icons,
directory styling, continuation indentation, and hidden-item counts remain
meaningful rather than flattening every path into anonymous text chunks.
