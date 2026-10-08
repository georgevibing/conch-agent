# 0106 — Where work runs: a container, your machine, the cloud

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0016](./0016-getting-what-a-feature-needs.md) (needs),
  [ADR 0025](./0025-passwords.md) (sealed keys), [ADR 0028](./0028-safe-hands.md) (the
  guard, the sealed box), [ADR 0036](./0036-provider-consistency.md),
  [ADR 0066](./0066-codex-cli-and-coding-agents.md),
  [ADR 0100](./0100-permission-modes-every-provider.md) (modes on every provider),
  [ADR 0103](./0103-the-chat-tells-what-the-assistant-is-doing.md) (rows in words)

## Context

The assistant's commands run as the person, on the computer Conch runs on, inside the
OS sandbox (ADR 0028): writes to the work folder, no network, no secrets, leaving the
box asks. That is a good default, and it has limits. The box is a list, not a
machine: an unsealed command (a clone, an install, anything in Full trust) has the
person's full reach. Windows has no box at all. And some work belongs on another
computer: a build server, a GPU desktop, a throwaway sandbox.

The other agents people use offer this:

- **OpenClaw** (`docs/gateway/sandboxing.md`): the gateway stays on the host; tool
  execution moves into a backend (`docker`, `podman`, `ssh`, `openshell`). Docker
  defaults: `network: none`, read-only root, `capDrop: ALL`, `no-new-privileges`,
  user `1000:1000`, pids and memory limits, an explicit `env` map only. Its SSH
  backend seeds the remote workspace once and never syncs back: the remote becomes
  the truth. It is configured in a file (mode, scope, workspace access).
- **Hermes Agent** (`terminal.backend`): `local`, `docker`, `ssh`, `modal`,
  `daytona`, `vercel_sandbox`, `singularity`. Docker drops every capability but three,
  `no-new-privileges`, size-limited tmpfs; provider credentials are never forwarded
  even when listed. SSH, Modal and Daytona sync changed files back on teardown.

Both are configured by hand, and neither says in the chat where a command ran.

For a hosted sandbox we compared four (read 2026-10-08): **Daytona** stops after 15
idle minutes by default and keeps the files, is reached with one Bearer key, and is
plain JSON over HTTPS (create, execute returning `{exitCode, result}`, file upload
and download). **E2B** pauses well but runs commands only over a Connect streaming
RPC with a second per-sandbox token. **Modal** terminates idle sandboxes and is
SDK-first with a two-part token. **Vercel Sandbox** stops on a session timeout, needs
a token plus team and project ids, and recommends its SDK. Daytona is the one that
hibernates, has one simple key and needs no one's SDK.

## Decision

### The places

`preferences.place` (new chats) and `TurnOptions.place` (one chat) hold a
`WorkPlaceId`: `computer` (the default, unchanged), `container`, `ssh:<host>` or
`cloud`. The words are one definition (`PLACE_WORDS`, protocol `workplaces.ts`).
`WorkPlaces` (`apps/server/src/workplaces/service.ts`) lists them as they stand and
gives a turn its `WorkPlace`: `run(request)`, `seals` (can it keep the box's promise),
`where` (what the row says) and `about` (what the command tool's description says).

- **A container** (`container.ts`): one fresh `docker run --rm` (or Podman) per
  command, labelled `conch.work=1`. The flags are the seal: `--cap-drop ALL`,
  `no-new-privileges`, `--read-only` with a 2 GB `/tmp`, `--pids-limit 512`, 4 GB,
  two CPUs at most, `--init`, the person's own uid (Podman: `--userns keep-id`), only
  `HOME` and `LANG` set: nothing of this computer's environment goes in. The work
  folder is mounted at the same path, so absolute paths mean the same in and out
  (Claude Code's file tools work here, its commands there, on the same files). Sealed
  commands get `--network none` and a read-only `.git`, as the box on this computer
  keeps them; a command that leaves the box gets the engine's default network and a
  writable `.git`. Keys inside the work folder are covered (a tmpfs over a folder,
  Conch's own empty read-only file over a file). The image is the official
  `node:24-bookworm`: Git, Node, Python and a compiler, nothing else to trust.
- **Your machine** (`ssh.ts`): a `Host` in `~/.ssh/config` (and its `Include`s),
  never typed; a name that could read as an option is not listed, and `--` ends the
  options anyway. Conch runs the person's own `ssh` with `BatchMode=yes` (never a
  password prompt), `ForwardAgent=no`, `ForwardX11=no`, `ClearAllForwardings=yes`,
  `PermitLocalCommand=no`, given first so they win over the settings file. A shared
  connection (`ControlMaster`) lives in `~/.conch/workplaces/ssh/`, a protected path.
- **The cloud** (`cloud.ts`): one Daytona sandbox per chat, found by its
  `conch-chat` label or made, asleep after 15 idle minutes, archived after a week,
  removed after 30 days unused. A stopped or archived sandbox is started and waited
  for. The key is sealed in `workplaces.secrets.json`, sent only in an
  `Authorization` header and only to Daytona's own HTTPS hosts: a toolbox address
  from an answer that isn't Daytona's is refused. 429 and 5xx are retried with
  backoff; 401 asks for a new key in words.

### The work folder, there and back

Conch's file tools, and Claude Code's, work on the work folder here. For an SSH
machine or the cloud, `mirror.ts` keeps that chat's copy there in step: before each
command, the files that changed here go there (a listing of path, time and size each
side, so only changes travel); after it, what changed there comes back, deletions
included. Dependency folders (`node_modules`, `.venv`, `target`…) aren't carried:
each side installs its own. Links aren't followed or copied, protected places are
left out, and a folder over 50,000 files or 1 GB is refused with a sentence that says
to use a container instead. Commands for one chat's copy run one at a time.

What comes back is untrusted, because the machine (or the command on it) can say
anything. So it is never unpacked by a program: `tar.ts` only lists entries, and each
file lands only if it was asked for, is a plain file, has a relative path with no
`..`, isn't under a protected place or a dependency folder, and every folder on its
way is a real folder inside the work folder (no link). Files are opened with
`O_NOFOLLOW`. A deletion removes only a plain, singly linked file inside the work
folder. More than 512 MB coming back is refused.

### Which providers it reaches, honestly

| Provider                                                                                                             | Its commands                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model APIs, local models, servers of your own, Codex (Conch's tools), Copilot, Gemini CLI, Grok (ACP door), the mock | Conch's `Bash`: `runHostCommand` hands each to the place (`runElsewhere`)                                                                                                                           |
| Claude Code                                                                                                          | Its own `Bash`: the PreToolUse hook swaps the command for the turn's relay (below)                                                                                                                  |
| Codex CLI                                                                                                            | Its own tools, in its own sandbox, on this computer. Its app server can approve or decline a command but not change it, so Conch can't route it. The picker says so in a sentence (`Engine.places`) |

Engines declare it (`Engine.places`); the picker reads it from the model catalog and
says plainly which provider runs its own commands here. File tools always work on
the work folder here.

**Claude Code's relay** (`relay.ts`). Claude Code runs its `Bash` itself. The
PreToolUse hook, after the guard has judged the command the model wrote, returns
`updatedInput` with the command swapped for a runner: Conch's own Node fetching
`http://127.0.0.1:<port>/run/<ticket>`, with `dangerouslyDisableSandbox` (the place is
the box; the runner only reaches loopback). It answers `ask`, so the question goes to
`canUseTool`, which asks Conch with the original command and lets Conch's mode answer
(not marked `escalated`), then allows with the swapped input. The gateway runs the
ticket's command at the place and answers with its output and exit code, which the
runner passes on. The door is the turn's own (a random loopback port, closed when the
turn ends); a ticket is 256 random bits kept only as its hash, good once, for 30
minutes; a request with an `Origin` or another `Host` is refused.

### The guard and the modes

Nothing about asking changes for a container, which seals as this computer does: a
sealed command is sealed, one that leaves asks as it would here. An SSH machine and
the cloud can't keep the box's promise (their network is theirs), so `seals` is
false and every command there is judged as leaving the box: in Auto, routine work
goes ahead and the risk policy decides after reading (ADR 0100); Ask first asks. A
command naming a protected place is refused wherever it would run. A place that
isn't there never falls back to this computer: the command fails with what happened
and the next step, and the model is told not to run it another way.

### Fix it before you ask

- Docker or Podman is a need (`container`, ADR 0016): found where Docker Desktop,
  OrbStack, Rancher Desktop and Podman put themselves; **Install Podman** with
  Homebrew or winget (no administrator), the system's packages on Linux as a command
  to copy. Docker Desktop and OrbStack are opened, Podman's machine started (or made)
  when a command needs them, and noted under Fixed on its own. The image is fetched
  once, said the same way. Docker on Linux that isn't running is the one command the
  person runs (`sudo systemctl start docker`).
- Boxes a crash left behind are removed at start (only Conch's label), and on
  Repair. A stopped command's box is removed, not left running.
- Repair everything has a `workplaces` check for the default place: the engine, the
  machine answering, the key working; each with one action.
- SSH failures are turned into words: a machine this computer hasn't met yet ("connect
  once from a terminal"), a key it won't take, a name it can't find, a machine asleep.

### In the chat

A chip beside the mode (Nacre `WorkPlacePicker`), there once somewhere other than this
computer is ready, or the chat already runs elsewhere: the place's mark, its name,
**Make this my default**, a dot on a place that isn't ready and its one next step
(**Install Podman**, **Add a key**). When the place changes, the new mark glides up
into the chip on a spring with one glint (still, with reduced motion). Each
`tool.finished` for a command run elsewhere carries `where`, and the row says it
(Nacre `WorkedAt`): once on a story's row when every command ran there, per step when
they differ, read out in full ("Ran on build-box"). Settings → Security → Advanced →
**Where work runs** holds the default and the Daytona key; ⌘K finds it.

### Whole Conch

`workplaces.secrets.json` is a sealed key file (`SEALED_FILES`), `secret` in backups,
a protected path, and listed in Passwords; `workplaces/` is `derived`. A backup whose
new chats run on another machine or in the cloud says so before it's restored
(`work-runs-elsewhere`). Saving the key needs a recent sign-in. The agent can't
choose a place: only a person's `configure` or settings change does.

## Threat model

Who can reach it, and what they could do:

- **The agent itself** (prompt-injected): it can't change the place, add a machine or
  a key (no tool does). In a container it gets less than in the sealed box: no host
  files beyond the work folder, no environment, no capabilities, no network while
  sealed. On an SSH machine it gets that machine's reach, which the person chose by
  choosing it; agent forwarding is off, so it can't use the person's keys to reach a
  third machine from there. Its output and the files it makes come back only through
  the mirror's checks (traversal, links, protected places, size).
- **The machine or the sandbox**: could send paths outside the work folder, links,
  devices, more than was asked, or a huge archive. Each is refused and tested
  (`mirror.test.ts`). It never receives a key of the person's or Conch's.
- **Another program on this computer**: the relay's port is loopback, its tickets
  unguessable, single use and short-lived; a ticket is visible in the runner's
  arguments to `ps` for the moment it runs, and buys only the one command that was
  already judged, once. A web page is refused by its `Origin`, another port's name by
  `Host`. The SSH control sockets are in a protected folder; anyone who could use
  them as the person could already run `ssh` as the person.
- **Daytona**: sees the work folder (minus protected places and dependency folders)
  and the commands. The key is sent nowhere else; a redirect is an error, not
  followed.
- **A shared temporary folder**: nothing is created there; the file laid over keys is
  Conch's own, in its home.

Abuse cases tested: traversal, absolute paths and unrequested entries in a returned
archive; writing through a link (a folder or a file); a protected place in and out;
an option-shaped host name; a toolbox address that isn't Daytona's; the key only in a
header; the relay's ticket reused, a web page's `Origin`, and a command naming a key;
a place that's gone not falling back to this computer.

## Consequences

- People get real isolation in one press where Docker or Podman is, and on Windows,
  where there was no box; and a way to run work on a machine they already own.
- Claude Code's commands route through a relay rather than its own sandbox; the
  relay's runner needs Conch's Node on loopback, which Claude Code's command may reach
  because the place is the box. A background command (`run_in_background`) ends with
  the turn.
- Codex CLI stays on this computer; the UI says so rather than pretend.
- Each command in a container starts a fresh box (about half a second); nothing
  outside the work folder survives between commands, on purpose.
- The mirror costs a listing before and after each command on a remote place; large
  folders are better in a container.

## Sources

Read 2026-10-08:

- OpenClaw: `docs/gateway/sandboxing.md`, `sandboxing/{docker-backend,ssh-backend,what-gets-sandboxed}.md`.
- Hermes Agent: configuration and tools documentation (terminal backends, `env_passthrough`).
- Daytona API (`/docs/openapi.json`, `/docs/toolbox-openapi.json`, sandboxes and network limits);
  E2B, Modal and Vercel Sandbox documentation, for the comparison above.
- OWASP Docker Security Cheat Sheet (capabilities, `no-new-privileges`, read-only
  filesystem, resource limits, no socket in the box); CIS Docker Benchmark §5.
- OpenSSH `ssh_config(5)` (`BatchMode`, `ForwardAgent`, `ClearAllForwardings`, first value wins).
- OWASP Top 10 for LLM applications 2025 (LLM06 excessive agency); Greshake et al.
  (2023), indirect prompt injection; ADR 0028's lethal trifecta.
- Claude Agent SDK: `PreToolUseHookSpecificOutput.updatedInput`, `PermissionResult.updatedInput`.
