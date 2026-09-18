# Background shell research and Pi integration boundary

## Decision

Do not add background-process execution to pi-claudify. Claudify remains a presentation extension and must not replace Pi's Bash execution, trust, sandbox, environment, mutation, or cancellation contracts.

Background execution should be implemented either:

1. in Pi as a first-class background-job service; or
2. as a separate opt-in execution extension with its own tools and explicit ownership.

Claudify may later add presentation-only adapters for those host-owned jobs.

## Captured behavior

Claude Code 2.1.267 accepts these additional Bash fields:

```ts
{
  command: string;
  description?: string;
  timeout?: number;            // foreground wait in milliseconds
  run_in_background?: boolean;
}
```

Explicit background execution returns immediately with an opaque task ID and a private output-spool path. A foreground call may also be promoted while running. The process is not restarted.

A Bash timeout is a foreground-detach deadline, not a hard execution timeout. The process continues as a background task.

Polling uses:

```ts
TaskOutput({ task_id, block?: boolean, timeout?: number })
```

Results distinguish `not_ready` from `success`, and include task type, status, accumulated output, and final exit code. `TaskOutput.timeout` controls polling only.

Cancellation uses:

```ts
TaskStop({ task_id })
```

Completion is delivered asynchronously as a task notification carrying task ID, originating tool-use ID, output file, status, and summary. Multiple jobs run independently.

Session-level backgrounding is a separate daemon feature with attach/log/stop/remove operations; it should not be conflated with shell task IDs.

## Pi 0.85 capabilities and gaps

Pi already provides:

- native Bash execution and streaming updates;
- abort-aware process-group termination;
- hard execution timeouts;
- shell path/prefix/environment handling;
- output truncation and full-output files;
- extension tools and lifecycle events;
- notifications, widgets, custom entries, and queued messages.

Pi does not currently provide:

- `run_in_background` on native Bash;
- foreground-to-background promotion;
- a background-job registry;
- output polling and task stopping;
- asynchronous completion notifications;
- job restoration or whole-session daemonization.

Replacing Bash inside Claudify would regress its native-execution ownership guarantee and would be unable to transfer an already-running native process safely.

## Preferred upstream API

```ts
interface BackgroundJobs {
  start(command: string, options: {
    cwd: string;
    description?: string;
    foregroundWaitMs?: number;
    executionTimeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<BackgroundJob>;

  detach(toolCallId: string): Promise<BackgroundJob>;
  get(id: string, options?: { block?: boolean; timeoutMs?: number }): Promise<BackgroundJobSnapshot>;
  stop(id: string): Promise<BackgroundJobSnapshot>;
  subscribe(listener: (event: BackgroundJobEvent) => void): Disposable;
}
```

Required host guarantees:

- same shell, cwd, environment, sandbox, trust, and process-tree semantics as native Bash;
- opaque session-scoped ownership IDs;
- bounded, permission-safe output spooling;
- idempotent stop and well-defined signal escalation;
- separate foreground-wait and execution deadlines;
- completion events independent of polling;
- bounded retention and cleanup;
- Unix process-group and Windows job-object behavior;
- explicit reload/new/resume/fork/quit policy.

## Separate-extension fallback

If upstream support is unavailable, a separate execution package could expose:

```ts
background_bash({ command, description?, foregroundWaitMs?, executionTimeoutMs? })
task_output({ task_id, block?, timeoutMs? })
task_stop({ task_id })
```

It must not override built-in Bash. It would own detached processes, spool files, retention, and shutdown prompts. Claudify would only recognize and render its public result contracts.

## Required tests

- explicit background execution, foreground promotion, no output, nonzero exit, and spawn failure;
- blocking/nonblocking polls and poll timeout versus execution timeout;
- cancellation, signal traps, repeated stop, and unknown IDs;
- concurrent jobs and interleaved output;
- large, binary, ANSI, and truncated output;
- completion while idle, mid-turn, or after polling;
- reload, replacement, resume, crash, and extension removal;
- trust/sandbox/cwd/environment parity with native Bash;
- no orphaned processes or leaked spool files;
- TUI, print, JSON, RPC, restored transcript, and narrow-terminal presentation.
