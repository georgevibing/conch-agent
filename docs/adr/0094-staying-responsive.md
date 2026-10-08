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

### October 8 incident: inherited limits and surviving children

The live gateway stopped answering while Linux held it and replacement gateways
in `mem_cgroup_handle_over_high`. Its service had no local memory limit, but the
ancestor `app.slice` throttled at 7 GiB and capped memory at 7.5 GiB. Host readings
still advertised over 4 GiB available. Abandoned Storybook and test processes
inside the service retained about 2 GiB across gateway restarts. A service restart
removed them and restored a two-millisecond local health response.

Read cgroup v2 limits, usage and pressure from every visible ancestor, including
`memory.high`, before admitting work. Available memory is the smallest remaining
budget, including sibling usage, rather than the leaf's usage subtracted from a
parent limit. Keep the operating system's limits intact. Bound health sampling;
a stuck resource reader must hold admission without hiding a working listener.
The common tool guard also holds provider-native Bash and PowerShell under
pressure and directs them to the managed queue. Reads and stopping work remain
available; a command held before dispatch never acquires an uncertain-action marker.

Give each POSIX gateway its own process group and clean it up on exit. On Linux,
also track descendant identities outside the gateway, including detached children,
and verify kernel start times before terminating them. Never select processes by
their name, command, workspace or memory use. A registered Linux service also
uses its exact cgroup membership, excluding the supervisor's pre-launch helpers:
this catches programs that double-fork or detach between observations. Never use
a shared session or slice as an ownership boundary. Tests exercise actual child
trees in temporary homes. Outside a service, a program that deliberately escapes
ownership between observations still requires operating-system containment.

Recovery mode now attempts its existing repair automatically after a full minute
of continuous HTTP health and resource headroom. Failed repair backs off, shutdown
wins, and work stays paused throughout verification. The failure budget is retained
until a longer stable probation completes, so brief recovery cannot reset a crash
loop. Repair everything remains available. No approval or uncertain action is
released by this availability repair.

The resource semantics follow the [Linux cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html):
limits are hierarchical, `memory.high` throttles, and `memory.current` includes
descendants. Diagnostics retain only numbers and reason codes, never `/proc`
command lines or environments.

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

### Activate protection during an upgrade

An in-app update restarts the gateway, while an existing background supervisor
can remain in memory. Requiring a separate service-manager command to activate
the watchdog would leave upgraded installations unprotected.

When `start.ts` runs under a legacy supervisor (`CONCH_SUPERVISE=1` and
`CONCH_SUPERVISED=1`, without Node IPC), it takes on supervision instead of loading
the gateway. Its child receives IPC, so adoption happens only once. Desktop
children are excluded; packaged desktop updates already replace the application.
Fresh installations start the current supervisor directly. The legacy outer
launcher remains until the next normal full stop, with no extra person-facing step.
Release cleanup retains both supervisors' folders while that compatibility layer
is running, so another update cannot remove code still in use.

The first adopted launch keeps its inherited restart or crash reason and reads
recovery mode from durable state. If an initial release still needs proving,
adoption leaves time to terminate and roll back before the legacy outer launcher's
deadline. Intentional shutdown propagates through both layers. This is compatibility
with pre-IPC launchers, not a promise that an arbitrary future change to an already
running supervisor module can be hot-loaded; such changes must also account for
their activation path.

### Bound repeated restarts and keep a usable recovery mode

A private, atomic state file in `CONCH_HOME/recovery/` keeps bounded failure history,
rapid requested restarts and recovery mode across supervisor replacement. Legitimate
update/restore restart requests remain fast; a rapid sequence eventually consumes
the same failure budget as crashes. Repeated failures enable recovery mode, and
exhaustion causes cooldown rather than an unbounded operating-system restart loop.

Recovery mode preserves chat and settings access while automatic resumption,
queued tasks, scheduled routines, quiet learning and managed commands are held.
Its latch does not expire just because time passes. A repair after continuous
HTTP responsiveness and resource headroom releases work gradually: automatically
after a minute, or sooner through **Repair everything**. Automatic repair retains
the supervisor's budget until ten healthy minutes have passed. No permissions,
sign-ins or data are reset to repair availability.

Each new supervisor marks its revision in its child's environment. When an updated
Linux background gateway finds an older supervisor, it first heals the service
definition, then queues a nonblocking systemd restart of its registered service.
This replaces the in-memory watcher and clears historical service descendants
without a terminal command. `KillMode=mixed` lets the supervisor save the gateway's
checkpoints first; systemd bounds final cleanup at 25 seconds. Desktop updates
replace the supervising app. Other launchers acquire these watcher changes when
their supervising process is restarted; their updated gateway still gets the new
resource checks and automatic repair immediately.

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
