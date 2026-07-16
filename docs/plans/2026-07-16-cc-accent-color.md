# Claude Code accent (selection highlight) color — capture & design

Date: 2026-07-16
Status: captured, driving the accent override in `index.ts`

## Problem

pi highlights selected/accented text in teal; Claude Code uses a blue-purple lavender.
The teal is pi's theme key **`accent`** — dark theme value `#8abeb7`
(`dist/modes/interactive/theme/dark.json` `vars.accent`). It reaches every selected row:
`getSelectListTheme`/`getSettingsListTheme` paint `selectedPrefix`, `selectedText`, the
`→` cursor, and selected labels/values with `theme.fg("accent", …)` (`theme.js:1041-1059`),
and the same key styles `mdCode` and `mdListBullet`.

## Claude Code's value (three independent sources, converging)

1. **Binary theme literals.** Claude Code v2.1.211 (Bun binary) stores its four themes'
   `suggestion:`/`permission:` values as `rgb(...)` strings, extracted verbatim:
   `rgb(177,185,249)`, `rgb(153,204,255)`, `rgb(87,105,247)`, `rgb(51,102,255)`, plus
   `ansi:blue`/`ansi:blueBright` for the ANSI themes.
2. **Live 256-color captures** (tmux, CC v2.1.211, dark theme): the permission-mode label
   (`⏵⏵ accept edits on`) renders `38;5;147` = `#afafff`, which is the nearest 256-color to
   **`rgb(177,185,249)` = `#B1B9F9`** — pinning that literal to the dark theme. The
   autocomplete's selected row rendered `38;5;153`, an adjacent light-periwinkle cell.
3. **Berto's description** — "Claude uses like a blue-purple" — matches `#B1B9F9`
   (lavender), not `#99CCFF` (sky blue, the daltonized variant).

Chosen mapping: **dark → `#B1B9F9`**, **light → `#5769F7`** (a light background needs the
darker blue-purple; `#B1B9F9` on white is illegible, so the assignment is forced).

> Uncertainty note: the dark/light/daltonized assignment of the four literals is inferred
> (the binary's minified theme objects don't label them), anchored by the `147` capture and
> legibility constraints. If the exact truecolor looks off next to a real CC pane, the
> override lives in one constant pair.

## Design

- New setting **`accentColor: "claude" | "theme"`** (default `"claude"`), a row on the
  Theme section. `"theme"` restores pi's own accent.
- Mechanism: mutate the live `Theme` instance's `fgColors.accent` (hex string — pi converts
  to truecolor/256 at `fg()` call time, so both terminal modes come free). The original
  value is remembered per theme instance (WeakMap) so `"theme"` restores it exactly.
- Dark-vs-light pi theme detected by the luminance of the theme's `text` color (light text
  ⇒ dark theme ⇒ `#B1B9F9`; dark text ⇒ light theme ⇒ `#5769F7`).
- Applied at the same lifecycle points as the existing palette derivation (session_start,
  turn_start, /claudify refresh) and live-reflected when the row commits.
- Deliberately narrow: only `accent` is overridden. `borderAccent` (pi's cyan) and the
  spinner's color keys are untouched.
