# 0006 — Routines (scheduled tasks)

- Status: accepted
- Date: 2026-09-29

## Context

A personal agent becomes genuinely useful when it does things _without being asked
each time_: a morning briefing, a weekly tidy-up, a reminder. Schedules are often
cron expressions in config files, which are hard for most people to read, easy to get
wrong, quiet when a run fails, and unaware that the computer was asleep.

## Decision

**Routines** — scheduled tasks designed for people who have never heard of cron.

- **Structured schedules**, not cron strings: `once`, `daily`, `weekly` (days + time),
  `monthly` (day or "last"), `interval` (≥ 15 minutes) and — as an escape hatch —
  `cron`. They are validated (real timezone, not in the past, not too frequent) and
  **described by Conch itself** ("Every weekday at 7:30 AM"), never by the model, so
  every routine reads the same way.
- **A consistent shape**: a short title, one plain sentence saying what you get, and a
  self-contained instruction. The agent's `create_routine` tool enforces the style in
  its schema and description; titles/summaries are tidied server-side.
- **Agent proposes, user confirms.** Routines drafted in a chat start as `draft` and
  appear inline as a card ("Turn on · Try it now · Edit · Not now"). Nothing runs until
  a person turns it on. Duplicate titles are refused so the agent updates instead.
- **Every run is a real conversation** (`origin: routine`), briefed that nobody is
  watching live, ending with a `report_outcome` tool call (`done`, `nothing-to-do`,
  `needs-attention`) whose one-line summary becomes the run's outcome. You can open any
  run, read everything it did, and reply to follow up.
- **Unattended permissions** are explicit per routine: _Ask me first_ (the run pauses as
  "Needs you" and notifies), _Allow file changes_, or _Allow everything_.
- **Honest scheduling.** Conch checks at least every 30 seconds and on start-up. If it
  wasn't running at a scheduled time, it records the run as _missed_ or — by default —
  catches up **once** (never a backlog). Overlapping runs are _skipped_ with a reason;
  at most two routines run at once; runs fail clearly if Claude Code is signed out.
- **Plain files**: `~/.conch/routines/<id>.json` and `<id>.runs.jsonl` (last 200 runs).

## Consequences

Routines only run while Conch is running on the machine; the UI says so. A future
"launch at login" helper removes most of that limitation without changing the model.
