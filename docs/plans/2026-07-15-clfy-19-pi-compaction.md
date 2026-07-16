# CLFY-19: pi compaction investigation

## Scope

This investigation records what the pi runtime used by pi-claudify actually exposes for compaction before CLFY-19 changes its rendering. The inspected installation is `@earendil-works/pi-coding-agent` 0.80.6 (`node_modules/@earendil-works/pi-coding-agent/package.json:1-18`).

## Findings

### Pi exposes lifecycle boundaries, not compaction progress

Pi's internal `AgentSessionEvent` union has `compaction_start` with only a reason and `compaction_end` with the final result, abort/retry state, and an optional error (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:53-70`). The extension API similarly exposes `session_before_compact` and the completed `session_compact`; neither event has current, total, percentage, chunk, or delta fields (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:430-451, 839-848`).

The manual compaction path emits the start event, awaits the complete compaction result, saves it, and only then emits the end event (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1345-1450`). Even when summarization uses a streaming provider, pi awaits `stream.result()` and does not forward summary deltas (`node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js:410-415`).

The native TUI therefore has only an indeterminate `CompactionStatusIndicator` (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/status-indicator.js:37-44`). Its terminal progress call is a Boolean on/off lifecycle toggle, not a numeric value (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2441-2456`). `CompactionStatusIndicator` is also not exported by the package root; the package exports only `.` and `./rpc-entry` (`node_modules/@earendil-works/pi-coding-agent/package.json:14-21`).

**Decision:** CLFY-19 cannot truthfully render Claude Code's counting progress bar. It will not invent a percentage or patch an unexported internal status component to create a partial imitation of the captured two-line in-flight shape.

### Pi tracks historical file paths, but does not re-hydrate files

Default compaction details contain `readFiles: string[]` and `modifiedFiles: string[]` (`node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.d.ts:11-24`). Those lists are derived from historical `read`, `write`, and `edit` tool-call `path` arguments (`node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js:14-53`). Pi appends the paths as `<read-files>` and `<modified-files>` tags in the generated summary and persists the same arrays in `CompactionResult.details` (`node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js:563-574`). The completed `session_compact` extension event receives the persisted `CompactionEntry`, whose generic `details` field can carry those arrays (`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:36-44`).

This metadata is cumulative history, not a list of files pulled back into the new context. Pi does not re-read those paths, record line counts, or distinguish Claude Code's `Read` re-hydration from `Referenced file` fallback. It only places the path strings inside the summary text. The conversion from a persisted compaction entry to the displayed message explicitly drops `details` (`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:163-187`), and the resulting `CompactionSummaryMessage` contains only `summary`, `tokensBefore`, and `timestamp` (`node_modules/@earendil-works/pi-coding-agent/dist/core/messages.d.ts:46-50`). Source searches across the compaction, session, message, and extension contracts found no re-hydration, referenced-file, or line-count field.

**Decision:** CLFY-19 will not render Claude Code's re-hydration rows. Turning cumulative path metadata into `Read <path> (<N> lines)` or `Referenced file <name>` would fabricate both the operation and, for `Read`, unavailable line counts.

### The settled component has a direct, exported patch point

Pi renders `compactionSummary` messages with `CompactionSummaryMessageComponent` (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2587-2592`). Its `updateDisplay()` method creates the bold `[compaction]` marker and the collapsed `Compacted from N tokens (... to expand)` line (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/compaction-summary-message.js:8-43`). The class is exported from the package root (`node_modules/@earendil-works/pi-coding-agent/dist/index.js:35-39`), so pi-claudify can apply the same guarded prototype-patch pattern it already uses for native message components.

**Implementation ceiling:** restyle the exported component's settled head to the captured Claude Code branch row, `⎿  Compacted (ctrl+o to see full summary)`, while preserving the native expanded summary below it. No progress bar or re-hydration rows will be fabricated.
