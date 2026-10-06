# 0094 — Staying responsive and recovering safely

- Status: accepted
- Date: 2026-10-06

## Context

A gateway can stay alive while it becomes unusable. Several concurrent builds and
tests exhausted memory headroom on a 16 GB host, caused sustained memory stalls,
and stretched a health request beyond seven seconds. The supervisor saw a living
process and did nothing. Restarting released roughly 5 GB and restored millisecond
responses, but interrupted the person's work.

Conch already has crash backoff, release rollback, conversation checkpoints,
operation receipts and subsystem repair checks. Extend those pieces rather than
add another scheduler, another dashboard or a model-driven repair loop.

## Decisions

### Admit work only when there is room

`ProcessService` owns a bounded queue: at most 32 waiting commands globally and
eight per chat, with at most four running globally and two per chat. Available
memory and CPU headroom may lower concurrency further. Owner rotation keeps one
chat from taking every free slot. Waiting time counts toward the existing command
deadline; cancellation removes permission to launch even before a worker exists.

`recovery/resources.ts` reads portable memory/load information, Linux available
memory and memory-pressure stalls when available, and container memory constraints.
It reserves memory for the gateway and lowers the CPU priority inherited by managed
workers where supported. These are admission and recovery controls, not hard CPU
or RAM isolation: an arbitrary command can allocate suddenly or create descendants.

Sustained critical memory pressure stops one managed process tree, keeps its output,
and holds further admission for a cooldown. The local monitor and outside watchdog
share the relief cooldown. Conch never kills unrelated applications or silently
replays stopped shell commands. Worker stdin loss cleans up descendants even if
the gateway is killed abruptly.

### Watch from outside, recover in stages

The desktop and background supervisors share the watchdog and restart policy.
The gateway periodically probes its real HTTP health endpoint with a two-second
deadline and verifies its boot ID before reporting through its private IPC channel.
Resource pressure pauses admission; it does not by itself declare a responsive
gateway dead.

After startup grace, sustained missing or unsuccessful heartbeats first request
workload relief. If responsiveness does not return, the supervisor sends SIGTERM,
then SIGKILL after a bounded grace period. Initial defaults are 120 seconds to
start, 30 seconds without a healthy heartbeat, 20 seconds for relief, and 15 seconds
for shutdown. The gateway's own shutdown deadline is shorter. Tests inject short
deadlines instead of waiting or overloading the real host.

Successful release proving and rollback remain intact. An older rollback release
without a heartbeat sender retains crash supervision without being falsely killed
for missing messages it cannot produce. Direct development runs have no external
watchdog. An explicit Quit is never mistaken for a crash; losing the supervising
parent shuts down its gateway rather than leaving an orphan.

### Bound repeated restarts and keep a usable recovery mode

A private, atomic state file in `CONCH_HOME/recovery/` keeps bounded failure history,
rapid requested restarts and recovery mode across supervisor replacement. Legitimate
update/restore restart requests remain fast; a rapid sequence eventually consumes
the same failure budget as crashes. Repeated failures enable recovery mode, and
exhaustion causes cooldown rather than an unbounded operating-system restart loop.

Recovery mode preserves chat and settings access while automatic resumption,
queued tasks, scheduled routines, quiet learning and managed commands are held.
Its latch does not expire just because time passes. The existing **Repair everything**
checks for stable HTTP responsiveness and resource headroom, then releases work
gradually and clears the supervisor's budget. No permissions, sign-ins or data are
reset to repair availability.

### Save first; uncertainty survives a restart

Quit, updates, watchdog recovery and OS signals use one idempotent shutdown path.
It stops admission, stops schedules, saves conversation state, then closes services.
A stalled save cannot prevent cleanup indefinitely; the outer supervisor can still
terminate a frozen process. Failed writes are reported, never presented as a
successful save. Checkpointing does not manufacture successful completion.

Ordinary conversation mutations have a durable pending-call marker before dispatch.
Only a persisted successful outcome clears it. Logs are saved before the index so
an index cannot clear uncertainty ahead of the evidence. Unknown tools are not
assumed read-only. Results received after cancellation cannot retire pending calls,
and failed browser steps remain tool errors rather than successful error text.
Browser recovery can reopen a page before an action starts; a lost page after an
action starts cannot trigger a blind replay of that action.
Task operations retain their existing reconciliation and receipt
contract. Pending approvals, uncertain actions and scoped operations are not
blindly resumed by a generic conversation restart.

Safe interrupted chats are deferred durably and resume one at a time, with resource
headroom. A second restart does not lose the deferred queue. Automatic task admission
uses the same resource signal. Manual work and explicit stop retain their meaning.

### Explain through existing surfaces

Managed tool results explain waiting and stopped states. Settings → Health shows
responsiveness, managed commands and recent recovery; **Fixed on its own** receives
quiet repair notes. Recovery history stores only allowlisted timestamps, reason
codes and numeric resource evidence, capped in count and size. It contains no
commands, arguments, chat text or secrets, is protected from agent tools, and is
derived state excluded from backups.

## Verification

Unit and isolated subprocess tests exercise resource admission, fairness, queue
expiry and cancellation, sustained pressure, blocked event loops, bounded shutdown,
supervisor replacement, rapid restart requests, parent death and descendant cleanup.
Conversation tests verify pre-dispatch durability, uncertain outcomes, retained
deferred recovery, preserved approvals and checkpoint flushing. Existing release,
desktop, backup, security, task and provider tests remain part of the repository
checks. Never inject failures into the person's live gateway.

## Limits

Resource measurements are platform dependent; unsupported measurements fall back
to the portable readings. Admission cannot guarantee an arbitrary command's peak
resource use. A full disk may prevent saving the newest checkpoint or restart
history, so recovery retains its in-memory budget and reports that persistence
failed. Side effects without a reconciliation contract require a check before
continuing. Hardware failure or an unavailable operating system is outside the
gateway's ability to repair itself.
