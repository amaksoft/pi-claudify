# Current Claude Code Transcript Grammar (v2.1.207)

Status: ground truth
Date: 2026-07-13
Method: live capture of `claude` v2.1.207 in a cmux pane via `cmux read-screen`, polled
during and after turns. Not reconstructed from memory or screenshots.

This supersedes the screenshot-derived target in
`2026-06-05-claude-transcript-grammar-design.md`, which described Claude Code as it was
(per-tool `⏺ Read(file)` rows for every tool). Current Claude Code renders read-only
tools differently.

## The core model

Claude Code splits tools into two classes and renders them differently:

- **Mutating tools** (`Write`, `Edit`) get an individual, persistent `⏺ Tool(path)` row
  with results and a diff underneath. These survive to the end of the turn.
- **Read-only tools** (`Read`, `Grep`, `Bash`, `Glob`) are *aggregated* into a single
  gerund header row listing all in-flight targets. When the turn ends, the whole block
  **collapses** into one dim summary line. The per-tool rows are transient — there is no
  keybinding that brings them back (`ctrl+o` and `ctrl+r` do not expand them).

This validates the `readOnlyToolGrouping` split already in this package. The grouping is
right; the labels, gutters, and collapse behavior are what differ.

## Verbatim captures

### User message

No box. `❯` at column 0, continuation indented 2. Blank line after.

```
❯ Do these: write /tmp/ccprobe.txt containing "hello", then edit it to say
  "hello world", then run: bash -c "exit 3", then read /tmp/does-not-exist.txt,
  then reply ok.
```

### Assistant prose

Same `⏺` glyph as tool rows, column 0, continuation indented 2.

```
⏺ @owlburtoe/pi-cc-tools v1.1.6 — a pi extension (TypeScript/Bun) that renders
  Claude Code-style tool rows in the pi TUI: built-in/MCP/custom tool chrome,
  syntax-highlighted diffs via shiki, Ctrl+O image previews. Working tree clean.
```

### Mutating tools — individual rows, diff inline

`Edit` renders under the label **`Update`**, not `Edit`.

```
⏺ Write(/tmp/ccprobe.txt)
  ⎿  Wrote 1 line to ../../../../tmp/ccprobe.txt
      1 hello
  ⎿  Allowed by auto mode classifier

⏺ Update(/tmp/ccprobe.txt)
  ⎿  Added 1 line, removed 1 line
      1 -hello
      1 +hello world
```

- Result gutter: two spaces, `⎿`, two spaces.
- Diff body: six spaces, line number, space, `-`/`+` sign, content.
- Permission notices append as an additional `⎿` row on the same block.
- Result text is a sentence, not a stat: `Wrote 1 line to <path>`,
  `Added 1 line, removed 1 line` (singular/plural agreement).

### Read-only tools — aggregated, gerund header

```
⏺ Searching for 1 pattern, reading 2 files, running 1 shell command…
  ⎿  README.md
  ⎿  extensions/spinner.ts
  ⎿  $ git log --oneline -3
```

- Header is a gerund clause ending in `…`, clauses joined with `, `.
- One `⎿` per target. Files render as a bare path; bash renders as `$ <command>`.
- Header rewrites live as more tools are dispatched
  (`⏺ Reading 1 file…` → `⏺ Reading 1 file, running 1 shell command…`).

### Post-turn collapse

When the turn ends, the entire read-only block is replaced by one dim line, indented 2,
with **no bullet glyph**, past tense:

```
  Read 1 file, ran 1 shell command
```

Errors are not surfaced here. A `bash -c "exit 3"` and a read of a nonexistent file both
collapsed into this summary with no visible error marker.

### Tool row chrome

Captured from the raw TTY stream. The header is:

```
⏺ Write(/tmp/ccdiff.ts)
```

which on the wire is:

```
<ESC>[38;2;78;186;101m ⏺   <ESC>[39m <ESC>[1m Write <ESC>[22m ( <OSC8 link>/tmp/ccdiff.ts</OSC8> )
```

Two things worth stating plainly, because both are easy to get wrong:

- **Claude Code does not tint file paths.** The path carries no color of its own. It is
  wrapped in an OSC 8 hyperlink (`ESC ] 8 ; ; file://<abs> BEL <label> ESC ] 8 ; ; BEL`)
  so the terminal makes it clickable and styles it. Emphasis comes from **bold**, never
  from hue. The tool name is bold in the default foreground; the parens are plain.
- **The bullet is the status signal.** It carries the only color in the row, and it
  changes as the tool runs:

| State | Bullet color |
|-------|--------------|
| Running | `38;2;153;153;153` (gray) |
| Succeeded | `38;2;78;186;101` (green) |
| Assistant prose | `38;2;255;255;255` (white) |

Result rows put the counts and the path in **bold** against the default foreground, with
the `⎿` gutter in `38;2;153;153;153`:

```
  ⎿  Wrote **3** lines to **../../../../tmp/ccdiff.ts**
  ⎿  Added **2** lines, removed **2** lines
```

### Diff body

Captured from the raw TTY stream (`script`), so the SGR codes are exact.

A write shows the content with no sign column:

```
  ⎿  Wrote 3 lines to ../../../../tmp/ccdiff.ts
      1 const a = 1;
      2 const b = 2;
```

An edit shows a unified hunk — all removals, then all additions. Removals carry old
line numbers, additions carry new ones:

```
  ⎿  Added 2 lines, removed 2 lines
      1  const a = 1;
      2 -const b = 2;
      3 -const c = 3;
      2 +const b = 20;
      3 +const c = 30;
```

Line structure: five columns of indent, then a ` N ` line-number gutter, then the sign
column (`-`, `+`, or a space for context), then content. No box, no `▌`, no `│`, no
horizontal rules.

Colors, refreshed from Claude Code v2.1.266's xterm capture (shown as exact RGB equivalents):

| Element | SGR |
|---------|-----|
| Removed line background | xterm 52 → `48;2;95;0;0` |
| Removed changed token background | none; same background as the rest of the removed row |
| Removed gutter + sign foreground | xterm 167 → `38;2;215;95;95` |
| Added line background | xterm 22 → `48;2;0;95;0` |
| Added changed token background | xterm 28 → `48;2;0;135;0` |
| Added gutter + sign foreground | xterm 77 → `38;2;95;215;95` |
| Context line number | dim (`2m`), default foreground |
| Syntax highlighting | Monokai: fg xterm 231, keyword 81, function/property 148, string 186, number 141, boolean 197 |
| Result `⎿` gutter | `38;2;153;153;153` |
| Success bullet `⏺` | xterm 114 → `38;2;135;215;135` |

Two details that are easy to miss:

- **Removed lines are not syntax-highlighted.** Their content renders in the plain
  default foreground; only added and context lines get Monokai tokens.
- The line background is painted to the full terminal width (trailing spaces are
  filled), while the changed token within the line gets the brighter background.
- The counts in "Added **2** lines, removed **2** lines" are bold.

### Worked line

Playful past-tense verb, not "Worked for". Suffix appends live background state.

```
✻ Cooked for 8s
✻ Sautéed for 11s · 1 shell still running
✻ Baked for 4s
```

### Spinner

Glyph animates (`·` → `✽` → `✻`). Verb phrase, `…`, then a parenthesized status list
joined with ` · `.

```
✽ Gathering the Fellowship… (3s · ↓ 162 tokens · thought for 1s)
· Gathering the Fellowship… (4s · ↓ 206 tokens)
✽ Breaking the Siege of Minas Tirith… (5s · ↓ 163 tokens · thinking with high effort)
```

### Subagents

```
⏺ Explore(Map extensions/index.ts structure)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)
  ⎿  Allowed by auto mode classifier

⏺ Agent "Map extensions/index.ts structure" finished · 1m 25s
```

### Expansion hints

Lowercase, parenthesized, ` · ` separated. Never `• Ctrl+O to expand`.

```
(↓ to manage · ctrl+o to expand)
```

## Delta against this package as of 1.1.6

| # | Element | This package | Claude Code |
|---|---------|--------------|-------------|
| 1 | User message | `╭─ User ─╮` box | `❯ text`, no box |
| 2 | Assistant prefix | `●`, one leading space | `⏺`, column 0 |
| 3 | Block indent | `padding=1` on Text components | column 0 |
| 4 | Expand hint | `• Ctrl+O to expand` | `(ctrl+o to expand)` |
| 5 | Edit label | `Edit(path)` | `Update(path)` |
| 6 | Write result | stat line | `Wrote N lines to <path>` |
| 7 | Edit result | stat bar | `Added N lines, removed M lines` |
| 8 | Read-only group | `Inspect(2 tool uses)` | gerund header + `⎿` targets |
| 9 | Group at rest | stays expanded | collapses to dim `Read 1 file, …` |
| 10 | Worked line | `Worked for Ns` | `Cooked for 8s` (verb pool) |
| 11 | Spinner status | `(5m 8s)` | `(3s · ↓ 162 tokens · thought for 1s)` |

Todo rendering is out of scope — handled by a separate pi extension.
