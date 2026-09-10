# Second Blind Review Resolution

Date: 2026-09-12
Review target: sanitized `master..24ae621` worktree

## Outcome

All eight release blockers were reproduced and fixed. The warning and nit findings were either fixed, converted into explicit tested behavior, or (for the visual-preview complexity note) documented as an intentional exact-counting trade-off. The additional Meta ownership concern was also fixed.

## Finding disposition

| Finding | Disposition | Resolution |
|---|---|---|
| V01 banner replaces an existing header | Fixed | Default banner mode is now `off`; no header is installed until explicitly enabled. |
| V02 settings overflow at 80×24 | Fixed | Settings sections now window their body around the selection while preserving the footer. |
| V03 Pi 0.74 prompt pointer disabled | Fixed | Prompt installation accepts legacy UI contexts that do not expose `ctx.mode`. |
| V04 Pi 0.74 settled edit loses diff | Fixed | Queue-owned `details.diff` is converted into a bounded persisted `ParsedDiff`; modern `details.patch` remains preferred. |
| V05 packed Markdown profile inert | Fixed | Markdown detection is structural rather than `instanceof`, covering duplicate `pi-tui` installations. |
| V06 grouping patches wrong Container | Fixed | Compatible host and extension `Container` prototypes receive the stable grouping delegate. |
| V07 skipped overrides still aggregate/decorate | Fixed | `skipToolOverrides` now bypasses registration, grouping, and global decoration. |
| V08 Markdown glyph heuristics corrupt literals | Fixed | Rendered-glyph rewriting was removed; fence, rule, quote, and indent behavior lives in Markdown theme callbacks. |
| V09 thinking ignores `markdownStyle: "pi"` | Fixed | Mounted thinking blocks resolve the current Markdown style on each render. |
| V10 unterminated envelopes are quadratic | Fixed | Sanitization uses a single-pass envelope scanner. |
| V11 bidi/default-ignorable ambiguity | Fixed | Additional bidi controls and unsafe standalone default ignorables are visibly neutralized while command-audit encoding remains reversible. |
| V12 literal U+E000 is deleted | Fixed | Internal formatter marks are distinguished from literal private-use input. |
| V13 tabs and CRLF are corrupted | Fixed | Content policy preserves tabs, normalizes CRLF as one newline, and makes standalone CR visible. |
| V14 preview processes complete input | Documented | Exact omitted-row/item counts require an O(n) scan; storage remains bounded. Documentation no longer claims source pre-limiting. |
| V15 partial item counted hidden | Fixed | Hidden counts exclude the partially displayed structured item. |
| V16 expanded Bash omits command prefix | Fixed | Execution records only prefix presence; expanded results disclose that a configured prefix was applied without persisting the secret prefix text. |
| V17 native `(no output)` bypasses classifier | Fixed | Pi’s sentinel is normalized before Claude empty-result classification. |
| V18 thinking escalation uses request age | Fixed | Phrase escalation starts at `thinking_start`. |
| V19 session cost omits supported entries | Fixed | Assistant, tool-result, compaction, and branch-summary usage are included. |
| V20 metrics stale after tree changes | Fixed | Successful tree and compaction events rebuild metrics from the active branch. |
| V21 idle elapsed time freezes | Fixed | The idle footer schedules minute-boundary repaints. |
| V22 valid `$0.00` hidden | Fixed | Cost availability is tracked separately from its numeric value. |
| V23 cancelled pre-events clear pointer state | Fixed | Invalidation moved to committed tree/compaction events. |
| V24 Shiki initialization races polarity | Fixed | Every async request snapshots its theme identity and polarity. |
| V25 dark preset under light host uses light tokens | Fixed | Highlight polarity follows explicit diff backgrounds. |
| V26 settled edits persist duplicate models | Fixed | Modern hosts keep only the authoritative patch; Pi 0.74 keeps one bounded converted model. |
| V27 banner paths are POSIX-only | Fixed | Banner path normalization and home abbreviation support Windows separators and drive-letter case. |
| V28 fallback sanitizer survives shutdown/reload | Fixed | A stable owner/delegate registry supports generation-safe activation and release. |
| H01 deferred registration bypasses Meta ownership | Fixed | Deferred registration inspects public `sourceInfo` and preserves tools already owned by another extension. |

## Rejected adversarial claims

The report’s R01–R04 and R06 claims were not reproduced: epoch-bound diff requests, stable first-member identity, and the existing presentation-generation checks cover those races. R05 identified an invalid example (`diffTheme: "monokai"`), which was removed. R07 is superseded by the queue-owned Pi 0.74 diff adapter rather than filesystem inference or a fabricated line-one fallback.

## Validation

- 26-script standard suite
- strict TypeScript check
- full suites, strict TypeScript, and clean packed-consumer rendering on Pi 0.74.0, 0.80.6, and 0.85.1
- real Pi 0.85.1 tmux mouse/lifecycle suite
- normal package loading alongside external tool providers with no ownership conflict
- contract-compatible external tools retain execution ownership while receiving Claudify presentation
- reload coverage preserves Claude-style rendering and stable click geometry for historical settled edit rows
- CI matrix now includes a moving `latest` lane in addition to the pinned compatibility versions
