# Claude Code user-message gray box — capture & design

Date: 2026-07-16
Status: captured, driving the `userMessageBox` setting

## What changed

`docs/plans/2026-07-13-current-cc-grammar.md` recorded the user message as
"`❯` at column 0, continuation indented 2, **no box**", and claudify 2.x renders it that
way (stripping pi's own user-message background). Claude Code v2.1.211 now paints settled
user messages on a gray block — this doc supersedes divergence row 1 of the July 13 table.

## Captures (tmux `capture-pane -e`, CC v2.1.211, dark theme, 256-color)

Settled single-line message (after the assistant reply landed):

```
[38;5;239][48;5;237]❯ [38;5;231]reply with just the word ok please[39]
```

- Background `48;5;237` (`#3a3a3a`) covers the `❯ ` prefix and the text.
- The `❯` is dim (`38;5;239`, `#4e4e4e`) ON the background; the text is bright
  (`38;5;231`).

While the turn is still in flight, the echo renders **plain** — `[39]❯ text`,
continuation indented 2, no background (captured twice, consistently). The box appears
when the message settles. pi has no separate pending-echo presentation, so claudify boxes
the message from the start; the in-flight nuance is not mappable.

Multi-line geometry (Berto's screenshot of a live truecolor session): the block is a
**rectangle** — every wrapped line's background runs to the width of the widest line,
plus about one column of right padding; continuation lines sit fully on the background,
indented 2 under the text start.

## Design

New setting **`userMessageBox`**: `"theme"` | `"claude"` | `"off"`, a row on the
Messages section. Default **`theme`**.

| Mode | Background | Prefix `❯` | Text |
|---|---|---|---|
| `theme` (default) | the active pi theme's own `userMessageBg` (captured before claudify's transparent overwrite; every theme — including user JSON themes — defines it, dark default `#343541`) | theme `dim` | theme default |
| `claude` | `#3a3a3a` (captured 237) | `#4e4e4e` (captured 239) | bright white (captured 231) |
| `off` | none — the 2.2.0 rendering | `WORKED_LINE_FG` as today | default |

Default is `theme` because pi users run heavily customized theme JSONs; the box should
inherit their palette, not fight it. `claude` is the byte-authentic option; on light
themes it will look wrong by construction (dark gray + white text), which is why it is
not the default.

Mechanics: the render patch keeps producing plain `❯ `-prefixed lines, then (box modes)
wraps the first-to-last content lines in the background, padding each to the widest
line + 1 column so the block is a rectangle; interior blank lines (paragraph breaks) are
padded and painted too. The theme's original `userMessageBg` is remembered per theme
instance (WeakMap) at the point `applyToolBackgroundMode` would overwrite it with
transparent — the overwrite itself stays, since pi's own markdown background is still
stripped in all modes and the box is painted by claudify.
