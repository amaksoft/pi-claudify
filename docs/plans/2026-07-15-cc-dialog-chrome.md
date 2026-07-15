# Claude Code Dialog Chrome Grammar (`/config`, `/mcp`, `/theme`)

Status: ground truth capture in progress
Date: 2026-07-15
Claude Code: `2.1.210 (Claude Code)`
Method: live `claude` session in `/tmp/clfy1-probe.EP7M3J`, driven through cmux and sampled with `cmux read-screen` at approximately 0.6 seconds through command entry, opening, navigation, mutation, restoration, and exit. Visual color observations came from the same live cmux surface under Claude Code's Dark mode. Nothing here is reconstructed from memory.

## Shared capture conditions

The wide capture used a roughly 200-column Claude surface. The narrow capture split that cmux workspace vertically, leaving the Claude pane roughly half-width. cmux exposes `resize-pane`; an attempted further shrink with `resize-pane --pane pane:7 -L --amount 30` returned `invalid_state: Pane has no adjacent border in direction left`, but the vertical split itself produced the narrow capture described below.

The probe ran outside this repository. No project files or settings were exposed to the probe session. The only `/config` mutation was toggling `Show tips` from `true` to `false` and immediately back to `true` in the same dialog.

## `/config`

### The surface is tabbed, not a bordered dialog

`/config` opens a full-width overlay on top of the transcript. There is no outer dialog border and no title. The top row is a five-tab section header:

```text
   Settings  Status   Config   Usage   Stats
```

`Settings` is lavender/purple. The selected `Config` tab is dark text on a compact light-gray rectangular highlight. Unselected tabs are normal light-gray text. A thin lavender horizontal rule separates the underlying welcome/transcript area from the overlay.

Below the tabs is the only bordered element, a one-line search field. It uses rounded box-drawing corners, one blank column of inner horizontal padding, a dim magnifier, and a dim placeholder:

```text
   ╭────────────────────────────────────────────────────────────────────────╮
   │ ⌕ Search settings…                                                     │
   ╰────────────────────────────────────────────────────────────────────────╯
```

The focused search border is lavender. There is one blank line between the tabs and search box, and one blank line between the search box and rows.

### Row grammar

Rows are an unboxed two-column list. Labels begin five columns from the overlay's left edge; values align to one shared column. There are no row separators, bullets, or per-row borders:

```text
     Auto-compact                               true
     Switch models when a message is flagged    true
     Show tips                                  true
     Dynamic workflow size                      unrestricted
     Default permission mode                    Auto
     Theme                                      Dark mode
     Local notifications                        Disabled
```

Labels and values are normal light gray. No disabled row appeared in the captured settings state; `Disabled` above is a value, not disabled-row styling. The surface has no internal section headers beyond the top tabs.

Pressing `Down` from search focus selects the first matching row. Selection replaces the row's leading spaces with `❯`; the row does not gain a box:

```text
   ❯ Show tips                                  true
```

In Dark mode the selector is lavender/purple and the selected row text is brighter than unselected rows. Filtering leaves the two-column alignment intact:

```text
   ╭────────────────────────────────────────────────────────────────────────╮
   │ ⌕ Show tips                                                            │
   ╰────────────────────────────────────────────────────────────────────────╯

     Show tips                                  true
```

### Footer wording and focus states

Search focus, verbatim:

```text
Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear
```

Selected-row focus, verbatim:

```text
Enter/Space to change · / to search · Esc to close
```

Tab focus, verbatim:

```text
←/→/tab to switch · ↓ to return · Esc to close
```

The footer is dim gray and sits one blank line below the final visible row. Its wording is stateful, not a fixed dialog footer.

### Key semantics

Typing filters immediately. `Enter` or `Down` from search focus moves into the results. `Up` from search focus moves to the tab strip. With tab focus, `Left`, `Right`, and `Tab` switch sections live; moving right from `Config` displayed `Usage` without a confirm step.

On a selected boolean row, `Enter` and `Space` change the value immediately and keep the row selected. There is no Apply or Save action. The capture toggled `Show tips` to `false`, then pressed `Enter` again to restore `true` before exit.

`Escape` has focus-dependent behavior. With non-empty search text and search focus it clears the query but leaves `/config` open. With a row selected it closes `/config` immediately, even when the search query is still present. With tab focus it closes the surface. No settings rollback occurs on close because row changes commit immediately.

### Wide and narrow behavior

At wide width the search box stretches almost the full overlay width while values remain in a compact column near the labels; the list does not distribute its columns across the available space.

At the captured half-width, the tabs, search box, label column, value column, and footer all retain the same grammar. The search border shrinks to the pane. Long labels remain single-line in this capture, and the value column stays aligned; rows do not become cards or stack label above value. The overlay clips vertically to the pane and relies on its scrollable list rather than adding an outer border.
