# Capture: provider usage-quota payloads (Anthropic + Codex) — CLFY-25

**Date:** 2026-07-17
**Issue:** CLFY-25 — footer "Week" quota renders a permanent "~"
**Method:** temporarily instrumented `ProviderUsageSource.fetchTarget` to append the raw
**response body** (usage data only — never the bearer token or request headers) to a scratch
file, ran pi against the local checkout in a detached tmux session, and switched the active
model to hit each provider's endpoint. Instrumentation reverted after capture. This satisfies
the CLAUDE.md constraint: the capture went through pi's `ctx.modelRegistry` OAuth path and
records the response shape only. Identifiers (user_id / account_id / email) are redacted below.

- pi **0.80.10**, claudify from checkout, footer confirmed (`claudify │ ⎇ master │ …`).

---

## Headline — the ticket's premise was wrong

The issue assumed the bug lived in `parseAnthropicUsage`'s `seven_day` branch. **It does not.**
With an Anthropic model active, the footer rendered **both** windows correctly and live:

```
Claude Opus 4.8 │ Ctx: 0% │ Usage: 49% ▓▓▓▓▓░░░░░ → Reset: 02:10 PM │ Week: 4% ░░░░░░░░░░ → Reset: 12:00 PM
```

The permanent "~" is the **Codex / OpenAI** path. Reproduced live with `GPT-5.6 Sol` active:

```
GPT-5.6 Sol │ Ctx: 0% │ Week: ~
```

The reporter was on a Codex model (the sim-208 session that surfaced this runs Codex workers),
not Anthropic. The diagnostic the ticket prescribed — "does Usage resolve while Week shows ~?"
— was Anthropic-shaped; the real answer is provider-shaped: **Anthropic is fine, Codex is broken.**

---

## Anthropic payload — `GET https://api.anthropic.com/api/oauth/usage`  (status 200)

Parser expectation (`parseAnthropicUsage`): `five_hour.utilization`/`resets_at`,
`seven_day.utilization`/`resets_at`. **Matches the live shape exactly** — no change needed.

```jsonc
{
  "five_hour": { "utilization": 49.0, "resets_at": "2026-07-17T18:09:59.657922+00:00", "limit_dollars": null, "used_dollars": null, "remaining_dollars": null },
  "seven_day": { "utilization": 4.0,  "resets_at": "2026-07-24T15:59:59.657953+00:00", ... },
  "seven_day_opus": null, "seven_day_sonnet": null, "seven_day_cowork": null, /* …many family-specific nulls… */
  "extra_usage": { "is_enabled": false, ... },
  "limits": [
    { "kind": "session",       "group": "session", "percent": 49, "severity": "normal", "resets_at": "…", "is_active": true  },
    { "kind": "weekly_all",    "group": "weekly",  "percent": 4,  "severity": "normal", "resets_at": "…", "is_active": false },
    { "kind": "weekly_scoped", "group": "weekly",  "percent": 5,  "severity": "normal", "scope": { "model": { "display_name": "Fable" } }, "is_active": false }
  ],
  "spend": { "used": { "amount_minor": 0, "currency": "USD" }, "percent": 0, "enabled": false, ... }
}
```

Notes: `utilization` is a float (49.0/4.0); `resets_at` is ISO-8601 with microseconds and an
explicit `+00:00` offset. `percentageValue` rounds and `parseResetTimestamp`/`Date.parse`
handle both — verified with a regression test using this exact format. A newer `limits[]`
array duplicates the same numbers with richer metadata; the parser doesn't need it, but it's
a more future-proof source if the top-level `five_hour`/`seven_day` keys are ever dropped.

**Anthropic "~" would now only occur on a real fetch/auth failure or a genuinely absent/null
`seven_day` — not reproducible on this account.**

---

## Codex payload — `GET https://chatgpt.com/backend-api/wham/usage`  (status 200)

Parser expectation (old `parseOpenAIUsage`): `rate_limit.secondary_window.used_percent`/`reset_at`.
**Mismatch — this is the bug.**

```jsonc
{
  "user_id": "<redacted>", "account_id": "<redacted>", "email": "<redacted>",
  "plan_type": "prolite",
  "rate_limit": {
    "allowed": true, "limit_reached": false,
    "primary_window":   { "used_percent": 16, "limit_window_seconds": 604800, "reset_after_seconds": 504192, "reset_at": 1784815409 },
    "secondary_window": null
  },
  "code_review_rate_limit": null,
  "additional_rate_limits": [
    { "limit_name": "GPT-5.3-Codex-Spark", "metered_feature": "codex_bengalfox",
      "rate_limit": { "primary_window": { "used_percent": 0, "limit_window_seconds": 604800, "reset_at": 1784916017 }, "secondary_window": null } }
  ],
  "credits": { "has_credits": false, "balance": "0", ... },
  "rate_limit_reset_credits": { "available_count": 5, "applicable_available_count": 0 }
}
```

**Root cause.** `secondary_window` is **null** on this plan; the 7-day window
(`limit_window_seconds: 604800`, `used_percent: 16`) is in **`primary_window`**. The parser
read `secondary_window` unconditionally → null → the "Week" placeholder "~", permanently, for
every `prolite` user.

**Which window is weekly varies by plan.** The standard Codex shape (already modeled in the
pre-existing footer test) puts a 5-hour window in `primary_window` and the 7-day window in
`secondary_window`. Here it's inverted and `secondary_window` is null. The `additional_rate_limits[]`
entries are per-model sub-limits (e.g. Codex-Spark), not the account weekly — ignored.

**Fix.** `openAIWeeklyWindow` now picks, of `primary_window`/`secondary_window`, the longest
window that spans a weekly scale (`limit_window_seconds ≥ 6 days`), reading its `used_percent`
+ `reset_at`:
- prolite: `primary_window` (604800) → **Week 16%** ✅
- standard: `secondary_window` (604800) beats `primary_window` (18000) → **Week 42%** ✅ (unchanged)
- a sub-weekly-only window is **not** mislabeled "Week" → omitted (honest "~") rather than shown as weekly.
- when no window reports `limit_window_seconds` at all, it falls back to the legacy secondary→primary order.

---

## Caveats
- Only `plan_type: prolite` (Codex) and a Claude Max (Anthropic) account were observed. Plus/Pro
  Codex shapes (where `secondary_window` is the populated weekly window) are covered by the
  existing test but not live-captured this session.
- These are undocumented endpoints; shapes can change without notice. The parser degrades to
  the "~" placeholder on any mismatch, never crashing.
- Anthropic `reset_at` for "Week" showed `12:00 PM` in the footer vs the payload's
  `15:59:59 UTC` — that's local-time rendering, not a parse issue.
