# 0095 — Independent reads during browser waits

- Status: accepted
- Date: 2026-10-06

## Context

Codex can send several dynamic tool requests before receiving their results.
Conch queued all of them behind one promise. A browser waiting for control or a
stalled page therefore blocked independent file and public-web reads as well.
A browser wait also missed cancellation if its signal was already aborted.

## Decision

Use two bounded lanes in the Codex adapter: one for explicitly known built-in
file and public-web reads, one for Conch browser tools. Each lane runs at most
one call. Browser calls also wait for earlier reads to finish, including their
published results, before authorizing an action. Later independent reads may
finish while an earlier browser call waits.

Every other call is a barrier across both lanes. Shell commands, writes,
connectors, generated app tools and unknown names keep their original ordering.
Read-only declarations supplied by an external tool do not grant concurrency.
The existing schema validation, guards, permissions, durable pre-dispatch events,
and completion/taint acknowledgements remain in the execution path.

Cancellation is checked again when queued work starts. Browser control waits
reject already-cancelled signals and closed tabs. Closing the last page releases
waiters with failure rather than leaving them waiting for control forever.
After provider completion, draining pending tools remains cancellable so Stop
can close the provider and clean up its temporary home even if a tool stalls.

This changes Codex scheduling only; browser cancellation applies to every provider.
It introduces no new permission or confirmation flow. It does not promise to
interrupt an arbitrary running connector, replay a mutation, or impose a deadline
on time a person intentionally spends in the browser. Browser-wide execution
deadlines need operation-specific cancellation and are separate from this change.

## Verification

Tests reproduce the blocked-read and already-cancelled-wait failures before the
fix. Scheduler tests cover mutation barriers, browser ordering, failure recovery,
and reads finishing before a later action. A fake Codex app-server sends concurrent
tool requests through the real adapter, including its guards and event publication.
