# Claudify selected-setting descriptions

Date: 2026-07-16
Status: intentional Claudify-only design

## Divergence from Claude Code

Claude Code does not provide a description affordance to copy. The live `/config` capture in
`docs/plans/2026-07-15-cc-dialog-chrome.md` records an unboxed two-column list containing only
setting labels and values. Selecting a row replaces its leading spaces with `❯`; it does not add
supporting text.

Berto deliberately chose to diverge here because several Claudify settings are not clear from
their labels alone. Per-setting descriptions are therefore a Claudify-owned usability feature,
not an attempt to reproduce undocumented Claude Code behavior.

## Row grammar

Every setting row carries a short description grounded in the renderer that consumes the
setting. A Section renders the selected row's description only, dimmed on the next line and
indented to the selected row's label. Unselected rows remain the existing `label + value` form:

```text
  ❯ Tool background             outlines
    Keeps pi backgrounds, clears them, or outlines tool rows horizontally.
    MCP output                  preview
```

Moving selection removes the previous description and inserts the new selected row's
description. The dedicated Picker and verb-editor views keep their existing candidate/editor
grammar; descriptions belong to the Section row list.

The description contributes one body line at typical terminal widths. The framed panel's height
calculation remains unchanged: with terminal dimensions, the added body line consumes one line of
fill while the footer stays pinned above the closing rule; without terminal dimensions, the panel
renders at its natural height.
