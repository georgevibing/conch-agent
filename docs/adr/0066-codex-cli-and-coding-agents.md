# 0066 — Codex CLI, and coding agents as their own kind of provider

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0036](./0036-provider-consistency.md) (Codex runs Conch's tools only),
- Amended by: [ADR 0069](./0069-carrying-a-chat-on.md) (a thread carried on while its tools are the same)
  [ADR 0053](./0053-more-providers.md) (the provider groups)

## Context

People asked for Codex as a full coding agent, the way Claude Code is: its own shell, its own file
edits and its own way of working in a folder. Since ADR 0036, Conch's Codex has run
`codex app-server` with every Codex tool switched off. Conch's tools do the work and Conch's guard
sees every call. That keeps Codex consistent with every other provider, but it isn't the Codex
people know from their terminal.

Before ADR 0036, Codex ran as `codex exec`. That route couldn't ask before acting, so it ran with
approvals switched off. That is why it was replaced, and nothing here brings it back.

The Providers page also puts Claude Code beside Copilot, Gemini CLI and Grok under "Your plans".
All of those are programs on this computer, but Claude Code brings its own tools and the others
don't.

Separately, people asked for an "Anthropic subscription" provider, as OpenClaw once offered. It
used a Claude Pro or Max sign-in against Anthropic's API directly. Anthropic's terms forbid that
since February 2026, and its API now refuses those sign-ins outside Claude Code and Claude.ai.

## Decision

### Codex CLI: Codex with its own tools, asking through Conch

A second Codex provider, `codex-agent`, named **Codex CLI**. It runs the same `codex app-server`,
with the same isolated sign-in as **Codex** (one ChatGPT connection serves both), and keeps
Codex's own shell and file edits switched on. Everything else stays off: apps, browser and
computer use, sub-agents, memories, image generation, hooks and web search. Conch's own tools are
added as before.

What holds it:

- **A sandbox that writes only to the work folder.** Codex's permission profile extends
  `:workspace` and is the threads' `default_permissions`. It adds write access to the folders Conch allows a chat, denies reading
  anywhere secrets live (Passwords, Conch's keys, the folders `TurnInput.protectedPaths` and
  `sandbox.denyRead` name, and Codex's own home), and turns the network off.
- **It asks for anything that isn't plainly read-only.** Every thread starts with
  `approvalPolicy: "untrusted"`, in every permission mode (Codex 0.159.1 no longer takes it as a
  config setting; Conch now sets it per thread for Codex too): only a command Codex knows to be read-only runs without an approval request,
  and no change is ever applied without one.
- **Every approval request goes through Conch.**
  - A command (`item/commandExecution/requestApproval`) becomes a `Bash` request.
  - A change (`item/fileChange/requestApproval`) becomes an `Edit` request with every path the
    change touches.
  - Each one passes the protected-path check, then `TurnInput.guard`, which decides in every mode
    (ADR 0028): taint, skill holds, sinks.
  - Then the chat's permission mode applies:
    - **Ask first** asks in the chat, through `requestPermission`.
    - **Accept edits** allows changes and asks before commands.
    - **Plan only** declines both.
    - **Full trust** allows both, unless the guard said to ask.
  - "Always allow" is remembered by Conch for the chat, never written into Codex's settings.
  - A request for more permissions (`item/permissions/requestApproval`) is answered with none.
  - Nothing that would leave the sandbox is ever granted, in any mode, and the chat says so: a
    request that names the network (`networkApprovalContext`, network rule changes), a change
    asking for lasting write access under another folder (`grantRoot`), a second request for the
    same command (Codex asking to retry outside its sandbox after it blocked the command), or a
    reason that says so. These are refused before the guard or the person is asked.
- **What it did shows like Claude Code's.** Each command and change is a tool card. It is in
  Activity, and Undo puts changed files back: the guard snapshots before a change, and the turn
  tracker covers the work folder.
- The safety page says how it's sealed, as it did for native Codex before ADR 0036: in Codex's
  own sandbox, with Conch's lists, from Codex 0.159.

### Coding agents

A new provider group, `agent`, shown first as **Coding agents**: "They bring their own tools and
work in your folders, on your plan." Claude Code and Codex CLI are in it. Codex (Conch's tools),
Copilot, Gemini CLI and Grok stay under **Your plans**.

### Your Claude plan

Conch doesn't add an "Anthropic subscription" provider. A Claude Pro or Max plan reaches Conch only
through Claude Code, Anthropic's own program, signed in by `claude auth login`. Conch never reads
Claude Code's credentials (ADR 0005). The Claude Code card says it uses your Claude plan. The
Anthropic API card says it's pay as you go.

### Carrying on

Both Codex providers carry a chat on in the same thread while its tools are the same ([ADR 0069](./0069-carrying-a-chat-on.md)). Every resume asks with `approvalPolicy: "untrusted"` in the `conch` profile, exactly as a new thread does.

### Later: the sandbox follows the mode (ADR 0100)

Codex CLI's profile is set per turn from `TurnInput.reach`: sealed as above in Ask first,
Edit freely and Plan only; with the network in Auto until the chat reads something; and in
Full trust writing anywhere in your folders, with the network, and reading your keys, with
only Conch's own keys and Codex's home denied. Auto and Full trust accept each approval
request the guard lets through. A request to leave the profile is still declined.

## Consequences

- People who want Codex as they know it get it, without giving up asking first. Codex's own
  approval requests are the hook; with them switched off (`never`), this provider couldn't exist.
- Two Codex providers share one sign-in, so connecting either connects both.
- A command Codex judges read-only runs without asking. It runs in the sandbox, with no network
  and no reading where keys live.
- A change that spans several files is guarded as one `Edit` with all its paths. Undo puts back
  the work folder as the turn's tracker saw it.
