# /claudify as a framed full-height panel (like the Extensions Manager)

Date: 2026-07-16
Captured from: live pi session (`pi-extmgr@0.3.0`, `@earendil-works/pi-coding-agent`) driven
in tmux, read with `tmux capture-pane -e`. See [[pi-side-capture-via-tmux]].

## The complaint

Opening `/claudify` shows a tiny settings block **pinned to the top-left corner** of the
terminal — 5 section rows + a hint line (~7 lines), floating over the transcript. On a short
transcript it sits far above the input with a large empty gap below it: "you can almost miss it."

Root cause (verified in code, not guessed): the command opens the screen as a floating
**overlay** —

```
extensions/index.ts:4530
  overlay: true,
  overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left" }
```

`maxHeight: "100%"` only *caps* height; the component renders its natural ~7 lines, so the
overlay collapses to that size and `anchor: "top-left"` pins it to the corner.

## Capture — how `/extensions` (pi-extmgr) presents itself

`pi-extmgr` calls `ctx.ui.custom(factory)` with **no options** — i.e. it is **not an overlay**.
It renders **inline** in the transcript flow, as a tall framed panel anchored just above the
input bar. Construction (`pi-extmgr/src/ui/unified.ts:168-197`):

```
DynamicBorder(accent)          ── top rule, full width
Text  "Extensions Manager"     accent + bold title      (indent 2)
Text  "25 items • 7 local …"   dim stats line           (indent 2)
Spacer(1)
<list body>                    sized to `tui.terminal.rows - 12`, capped
Spacer(1)
Text  <footer keybindings>     dim                      (indent 2)
DynamicBorder(accent)          ── bottom rule, full width
```

The **fill** is the key: the list body is explicitly sized to `terminal.rows - 12`, so the panel
always spans nearly the full viewport height. `DynamicBorder.render(width)` emits a single
`"─".repeat(width)` rule (no box corners — plain horizontal line).

Live capture (52-row terminal, ANSI stripped):

```
──────────────────────────────────────────────────────────────────────────────
  Extensions Manager
  25 items • 7 local • 18 packages

> ▏

  [1:All] 2:Local 3:Packages 4:Updates 5:Disabled · / search

  Local extensions (7)
→ ● [G] ~/.pi/agent/extensions/claude-code-spinner.ts
  ● [G] ~/.pi/agent/extensions/exit-alias.ts
  …(list fills the viewport)…

  Showing 1-16 of 25
  import type { … } • local extension • global • enabled •
  Space toggle · Enter/A actions · V details · … · Esc clear/cancel
──────────────────────────────────────────────────────────────────────────────
gpt-5.6-sol  ❯  think:xhigh  ❯  0.0% / 372k
```

## Target — `/claudify` framed panel

Give `ClaudifyScreen` the same frame + fill, and render it **inline** (drop the overlay), so it
sits above the input and spans the viewport. Approved layout:

```
──────────────────────────────────────────────
  Claudify                     accent + bold title (indent 2)
  5 sections                   dim subtitle (indent 2); hub only
                               blank spacer
  ❯ Theme                      body (existing rows/inputs), unchanged
    Diffs
    Spinner
    Messages
    Tool output
                               ← fill padding (blank rows) grows here
  ↑/↓ to move · Enter to open · Esc to close   footer, pinned above bottom rule
──────────────────────────────────────────────
gpt-5.6-sol  ❯  think:xhigh  ❯  0% / 372k
```

### Mechanism

1. `extensions/index.ts` — open the screen inline: `ctx.ui.custom(factory)` with **no** overlay
   options (mirrors extmgr). The Hub/Section drill-down and all callbacks are unchanged.
2. `extensions/claudify-screen.ts` — `ClaudifyScreen.render(width)` composes the frame:
   `topBorder · title · subtitle? · blank · <body> · <fill> · <footer> · bottomBorder`.
   - **Footer is separated from the body** so it pins to the bottom (above the rule); the fill
     padding goes *between* body and footer, matching extmgr (whose fill lives inside the list,
     above the footer). Today the footer is the last child of `this.content`; it moves to a
     stored field composed by `render()`.
   - **Fill target** mirrors extmgr's `rows - 12` list sizing: total panel height =
     `terminal.rows - 5` (extmgr's own panel is `rows - 5`: 2 rules + title + stats + 2 spacers +
     footer around a `rows - 12` list). Clamp to natural height — never negative padding.
   - **Degrade gracefully:** the fill reads `this.tui.terminal?.rows`. The assembled-render tests
     construct `ClaudifyScreen` with a fake `tui` that has **no `.terminal`** → no fill, natural
     framed height. Fill is asserted separately by passing a fake `terminal: { rows }`.

### Test deltas (`scripts/test-claudify-hub.ts`)

- **Compatible:** line 88 (`no [╭╮╰╯│]`) still holds — `DynamicBorder` is a plain `─` rule.
  Lines 87/89/101 (`❯ Theme`, hub footer present, section≠hub footer) still hold.
- **Update:** the overlay-options assertion (currently `{ overlay: true, overlayOptions:{…} }`,
  ~line 669) becomes "opens inline (no overlay options)".
- **Add:** frame present (top/bottom `─` rules, `Claudify` title, `5 sections` subtitle on hub);
  fill behavior — with a fake `terminal: { rows: N }`, the rendered height reaches `N - 5` and the
  footer stays on the penultimate line (bottom rule last).

## Not doing / open

- Exact reserve constant (`rows - 5`) is derived from the extmgr capture; if the inline panel
  reads a hair too tall/short against live pi, tune the single `PANEL_HEIGHT_RESERVE` constant.
  Needs a dev build in front of pi to confirm (installed pkg is the npm `@2.1.0`).
