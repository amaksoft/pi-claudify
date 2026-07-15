# Claude Code Dialog Chrome Grammar (`/config`, `/mcp`, `/theme`)

Status: ground truth
Date: 2026-07-15
Claude Code: `2.1.210 (Claude Code)`
Method: live `claude` session in `/tmp/clfy1-probe.EP7M3J`, driven through cmux and sampled with `cmux read-screen` at approximately 0.6 seconds through command entry, opening, navigation, mutation, restoration, and exit. Visual color observations came from the same live cmux surface under Claude Code's Dark mode. Nothing here is reconstructed from memory.

## Shared capture conditions

The wide capture used a roughly 200-column Claude surface. Narrow captures split that cmux workspace vertically. cmux exposes `resize-pane`: targeting the left pane's nonexistent left border returned `invalid_state: Pane has no adjacent border in direction left`; targeting the new right pane with `-L` succeeded and shrank the Claude pane further. `/config` was recorded at the initial half-width and `/mcp` at both full width and the narrower resized width.

The probe ran outside this repository. No project files or settings were exposed to the probe session. The `/config` mutations were toggling `Show tips` from `true` to `false` and immediately back to `true`, plus an accidental `Auto-compact` toggle from `true` to `false` during the first `/mcp` launch; the capture confirmed `Auto-compact` was restored to `true` before `/mcp` capture continued. `/theme` was temporarily committed to Light mode to confirm Enter semantics, then committed back to the original Dark mode before capture ended.

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

## `/mcp`

### An unboxed, fixed-width management panel

`/mcp` opens below a thin lavender horizontal rule over the transcript. There is no outer border, search field, or tab strip. The panel has a lavender/purple bold title followed by a dim count:

```text
   Manage MCP servers
   10 servers
```

The content stays in a compact fixed-width column at wide terminal widths rather than stretching across the pane.

### Section and row grammar

Servers are grouped under bold light-gray section headers. Qualifiers and paths in parentheses are dim:

```text
     User MCPs (/Users/berto/.claude.json)
   ❯ codegraph · ✔ connected · 1 tool
     forgejo · ✔ connected · 114 tools

     claude.ai
     claude.ai Context7 · ✔ connected · 2 tools

     Built-in MCPs (always available)
     claude-in-chrome · ✔ connected · 22 tools
     computer-use · ◯ disabled
```

Rows are unboxed and single-line. The selected row uses a lavender `❯`; its server name is brighter than unselected names. Middle dots and tool counts are dim. Connected servers use a green `✔`; `connected` remains normal/dim gray rather than green. Disabled servers use a hollow gray `◯`, and the status text is dim. A disabled row remains navigable and selectable; it is not skipped.

The help URL appears one blank line below the final group in dim gray:

```text
https://code.claude.com/docs/en/mcp for help
```

### Server detail grammar

`Enter` on a server replaces the list with a second-level detail surface. The title is the capitalized server name plus `MCP Server`. Metadata is a label/value table with labels aligned to one width:

```text
   Forgejo MCP Server

   Status:           ✔ connected
   Command:          /Users/berto/go/bin/forgejo-mcp
   Args:             --transport stdio --url https://forgejo.owlburtoe.dev
   Config location:  /Users/berto/.claude.json
   Capabilities: tools
   Tools: 114 tools

   ❯ 1. View tools
     2. Reconnect
     3. Disable
```

The detail action list is numbered, unboxed, and uses the same lavender `❯` selection marker. Connected servers expose `View tools`, `Reconnect`, and `Disable` in this capture.

Entering the disabled `computer-use` row does not enable it. It opens a detail view with disabled status and one explicit action:

```text
   Computer-use MCP Server

   Status:           ◯ disabled
   Command:          /Users/berto/.local/share/claude/versions/2.1.210
   Args:             --computer-use-mcp
   Config location:  Dynamically configured

   ❯ 1. Enable
```

No server action was invoked during capture.

### Footer wording

Server list, verbatim:

```text
↑/↓ to navigate · Enter to confirm · Esc to cancel
```

Server detail, verbatim:

```text
↑/↓ to navigate · Enter to select · Esc to back
```

Both footers are dim and sit directly below the panel content. The main view's help URL is a separate line above its key hints.

### Key semantics

`Up` and `Down` move the `❯` among every server row, including disabled rows. `Enter` on a server opens its detail view; it does not run the initially selected detail action. `Escape` in a detail view returns to the server list. The returned list reset selection to the first server in each captured return rather than preserving the server that had been opened. `Escape` on the server list closes `/mcp` without changing server state.

In a detail view, `Up` and `Down` move among numbered actions and `Enter` selects the highlighted action, as stated by the captured footer. Capture deliberately did not press `Enter` on `Reconnect`, `Disable`, or `Enable`.

### Wide and narrow behavior

At wide width the management panel keeps its compact content width and leaves unused space to the right. At the narrower resized width, the title, count, section headers, rows, help URL, and footer retain the same indentation and remain single-line in the captured server set. The panel does not acquire a border, stack status beneath names, or switch to cards. Only the transcript and welcome chrome behind it reflowed and truncated as the pane narrowed.

## `/theme`

### Unboxed option list plus a full-width preview

`/theme` opens below the same thin lavender horizontal rule used by `/mcp`. There is no outer border. The lavender/purple title is followed by a bold light-gray instruction:

```text
   Theme

   Choose the text style that looks best with your terminal
```

The option list is numbered and unboxed:

```text
     1. Auto (match terminal)
   ❯ 2. Dark mode ✔
     3. Light mode
     4. Dark mode (colorblind-friendly)
     5. Light mode (colorblind-friendly)
     6. Dark mode (ANSI colors only)
     7. Light mode (ANSI colors only)
     8. New custom theme…
```

The lavender `❯` marks the highlighted preview. The persisted theme is separately marked with a green label and green `✔`. Those states can diverge: while Light mode was highlighted for preview, `Dark mode ✔` remained green until Enter committed Light mode.

Rows have no disabled state in the captured option set. Parenthetical qualifiers are normal light gray, and unselected rows are light gray with dimmer numbers.

### Preview grammar

One blank line separates the options from a syntax/diff preview bounded by full-width dim `╌` rules:

```text
   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
   function greet() {
     console.log("Hello, World!");
     console.log("Hello, Claude!");
   }
   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
    Syntax theme: Monokai Extended (ctrl+t to disable)
```

The actual preview is syntax-colored. Under Dark mode, `function` is cyan, `greet` is yellow-green, and the two changed lines use dark red and dark green full-row backgrounds. Under the Light mode preview, the token palette changes and those rows use pale pink and pale green backgrounds. The `Syntax theme` line is dim gray and one column farther left than the option rows.

`ctrl+t to disable` is part of the syntax-theme status line, not the key-hint footer. The capture did not toggle syntax highlighting.

### Footer wording

Verbatim in every captured highlight state:

```text
Enter to select · Esc to cancel
```

The footer is dim and italic, with one blank line above it.

### Live preview, commit, and cancel semantics

`Up` and `Down` move the `❯` and apply the highlighted theme immediately to the entire Claude Code surface. Moving from persisted Dark mode to highlighted Light mode changed the option colors, syntax tokens, diff backgrounds, transcript selection treatment, and other Claude chrome before Enter was pressed. It also changed the preview's syntax-theme label from `Monokai Extended` to `GitHub`.

The preview changes Claude's color tokens, not the terminal emulator's background. In the captured cmux terminal, highlighting Light mode left the underlying dark terminal background in place while repainting text, selection, diff, and syntax colors for the light palette.

The persisted theme's green `✔` does not move during preview. `Escape` closes `/theme`, restores the persisted theme and syntax theme, and emits no transcript result. The captured Light mode preview returned to Dark mode colors and `Monokai Extended` after Escape.

`Enter` commits the highlighted option and closes the surface. Claude then appends a result under the `/theme` command:

```text
❯ /theme
  ⎿  Theme set to light
```

Reopening `/theme` after that commit showed `Light mode ✔` selected. The capture moved to Dark mode and pressed Enter to restore the original setting, producing:

```text
❯ /theme
  ⎿  Theme set to dark
```

### Wide and narrow behavior

At wide width the option list stays compact at the left while the two `╌` preview rules and colored diff-row backgrounds stretch across nearly the full available overlay width. The footer stays left-aligned rather than following the stretched preview edge.

At the captured narrow width, all eight option rows remain single-line and keep the same numbering, indentation, selection marker, and checkmark grammar. The preview rules and colored row backgrounds shrink to the pane. The syntax-theme line and footer remain intact; the surface does not add a border, stack option metadata, or hide the preview.
