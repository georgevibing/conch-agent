# 0123 — A script that calls your tools, one story in the chat

- Status: accepted
- Date: 2026-10-09
- Builds on: [ADR 0061](./0061-apps-you-make-share-and-add.md) (the sealed runtime),
  [ADR 0072](./0072-every-model-gets-its-tools.md) (every model gets its tools),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0100](./0100-permission-modes-every-provider.md), [ADR 0117](./0117-auto-asks-about-what-matters.md)
  and [ADR 0118](./0118-auto-judges-every-app-step.md) (modes, Auto's judgement, patterns across steps),
  [ADR 0103](./0103-the-chat-tells-what-the-assistant-is-doing.md) (stories),
  [ADR 0030](./0030-undo.md) (Undo), [ADR 0113](./0113-how-it-did-it.md) (how it did it)

## Context

"Go through my 300 emails and tag the invoices", "fetch these 40 pages and tabulate the prices",
"rename every photo by its date". Conch did each of these one tool call per model step: 300
round trips, each one re-reading the whole chat, each result landing in the model's context
whether it mattered or not. Slow, costly, and the chat showed 300 rows.

The other agents answer this by letting the model write one program that loops over the tools.
What they got right, and what they left open:

| Prior art                                                                                      | What it does well                                                                                                                                                                                                                                                      | What it left open                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic, _Code execution with MCP_ (2025-11-04) and _programmatic tool calling_ (2025-11-24) | Tools as a code API; intermediate data stays in the sandbox ("the agent only sees what you explicitly log or return"): 150,000 → 2,000 tokens in their example; 37% fewer tokens on their benchmarks. Each call comes back to the app as a `tool_use` with a `caller`. | Its own docs: "Do not rely on `allowed_callers` as a security boundary." No taint across calls. The trail of calls exists only in your client; the model sees stdout. No progress, no Undo.                                                                                              |
| Cloudflare, _Code Mode_ (2025-09-26)                                                           | A typed API from the schemas; a fresh V8 isolate per run with `globalOutbound: null`; tools only through bindings, so keys never enter the sandbox.                                                                                                                    | Approvals, prompt injection and misuse of the allowed bindings aren't discussed. Output is `console.log`; no per-call trail.                                                                                                                                                             |
| Hermes Agent, `execute_code`                                                                   | Python calling tools over a socket; bounds (300 s, 50 calls, 50 KB of output); secrets stripped from the environment; counts returned.                                                                                                                                 | Its own code calls itself "not an isolation jail" and runs in the project folder. It was an approval bypass ("execute_code is a straight bypass", later patched by checking the whole script before it runs). No taint handling; no per-call trail for the person; no progress; no Undo. |
| OpenClaw, Code Mode                                                                            | Nested calls keep "policy, approvals, hooks, telemetry"; approval waits pause the time budget; tight defaults.                                                                                                                                                         | The default executor is `node:vm`, "not a security boundary"; how a question looks mid-script is unclear; no Undo.                                                                                                                                                                       |
| smolagents CodeAct; Wang et al., _Executable Code Actions_ (ICML 2024)                         | Up to 30% fewer actions and up to 20% more success with code as the action.                                                                                                                                                                                            | An allowlist interpreter, escaped repeatedly (CVE-2025-5120, CVE-2025-9959) and a remote-executor RCE (CVE-2025-14931). No per-call approval; no record of the calls inside the code.                                                                                                    |

The lessons: hold every key and every power outside the sandbox; send every nested call through
the normal per-call path, never a whole-script check; use a real isolation boundary, not an
interpreter's allowlist; bound everything and say which bound ended it; keep the data out of the
model's context but keep the trail in front of the person. None of them make that trail, or Undo,
part of the experience.

## Decision

### The tool: `run_script`

One host tool, `run_script` (`apps/server/src/scripts/`), in every turn that runs Conch's tools,
for every provider (ADR 0072). Its input is a `title` (what it's for, in the assistant's words), the
`script`, and optionally `seconds` and `calls`. Its description teaches any model when to use it
(many similar calls, loops, filtering or joining what tools return) and when not to (one call or
two). It loads up front where a provider defers tools.

Inside, the script is the body of an async function, in **JavaScript or TypeScript** (types stripped
by Node's own `stripTypeScriptTypes`, which leaves every line where it was):

- `tools.<name>(input)`: every tool the model has, by the same name and with the same input
  (Conch's tools, and the computer's own `Read`, `LS`, `Write`, `Edit` and `Bash` for every
  provider). It resolves to the tool's answer, parsed when it's JSON, or throws an `Error` saying
  what went wrong; a call the person says no to throws one named `Declined`.
- `progress(done, total, label)` and `note(text)`: for the person. The last note is the story's
  headline once it's over ("Tagged 47 invoices among 300 emails").
- `console.log` and `return`: what comes back to the model.

Not reachable: the script tool itself, and what's said to the person once, outside a loop (`ask`,
`offer`, `suggest_replies`, `update_plan`, `exit_plan_mode`, `delegate`).

### The sandbox: the sealed runtime, unchanged

No new interpreter and no new dependency. Each run is one generated Conch app with one tool,
run by `SealedRuntime` from ADR 0061 exactly as it runs every app (`runtime.ts` and `host.mjs` are
not touched, and their attack tests hold for scripts as they are): a Node process of its own under
the permission model (reading only its own module, no programs, workers, addons, WASI, inspector
or `eval`), no environment, 256 MB, the fence inside the process (no `fetch`, sockets, Node's
modules, real `process`; frozen built-ins), and messages capped as they're read. Its one way out is
`app.fetch`, which the runtime hands to a fetcher: for a script, the fetcher answers only its own
three requests (a call, a progress word, a note) and refuses every address. The generated helpers
are not a wall: a script can reshape them or break out of its function, and still reaches nothing
but that fetcher. The syntax is checked in the gateway first, by compiling without running, so a
mistake comes back with its line.

### The gate: the same as a call the model made

Each call meets `authorizeTool`, the gate API engines use, against **this turn's own `TurnInput`**:
the guard (protected places, tools turned off, patterns across steps, the circuit breaker, the
guard after reading with Auto's risk policy and second looks, skill holds), the mode's own rule for
the computer's tools, and the questions. Then the tool runs as the turn has it, with the taint
wrapper that marks the chat after it reads, and its own questions (`ctx.ask`). That is stricter
than Claude Code's path for Conch's tools (which skips the guard), and the same as every API
engine's. So:

- **A write still asks.** Whatever would ask across steps asks inside a script, as the same card.
- **Taint carries across calls.** A read marks the chat before its answer reaches the script; a
  later call that could send it out meets the guard after reading, with the same words.
- **Patterns see the loop.** Calls are gated one at a time, in order, and each is logged as it
  starts (`script.call`), which `behaviour.ts` counts like any step: fifty deletes in a row ask in
  Full trust whether a script made them or not. Inputs are kept as JSON (long words shortened
  first), so who a call went to can still be read.
- **A no throws.** A refused or declined call throws in the script; the model is told which call,
  at which line, if the script didn't catch it.
- **Uncertain actions settle.** Each call is marked pending by the guard and settled when it ends,
  so a restart mid-script knows what may have happened, and a finished one leaves nothing behind.
- A script itself is never judged as a whole (`taint.ts`, `risk.ts`, `permissions.ts` say so
  explicitly): its words are code, and any of it could be anything. Each call is judged at the
  call, with its real arguments.

### The bounds

All of them end the process, and the model is told which, in words it can act on:

| Bound                                          | Default                                                     | At most |
| ---------------------------------------------- | ----------------------------------------------------------- | ------- |
| Work time (waiting for the person not counted) | 120 s                                                       | 600 s   |
| Tool calls                                     | 500                                                         | 2,000   |
| Calls running at once                          | 8                                                           |         |
| Memory                                         | 256 MB                                                      |         |
| What comes back to the model                   | 20,000 characters, 400 lines, with "N more lines not shown" |         |
| The script                                     | 40,000 characters                                           |         |
| One call's input                               | 512 KB                                                      |         |

Stop, or the turn ending, kills the process; a question still waiting resolves as a no. The work
clock stops while a question waits (`scripts/scope.ts` carries the step to the manager's
question), as OpenClaw's does.

### The chat: one story

`script.run` (the run as it stands; a later one replaces it) and `script.call` (each call, as it
starts and ends) are new, additive events (`@conch/protocol` `scripts.ts`). Everything that doesn't
know them passes them by: older clients, the handoff to another provider, summaries. The calls'
outputs are kept to 800 characters in the log, so a long run stays light.

Nacre's `ScriptRun` tells the run as one line, like a story: what it's for, a hairline that fills
as it says how far, the live line with Stop, a counter for each kind of call that turns as the
calls go ("Read an email ×120"). A question it waits on sits under its line and names the step
and the run ("Step 48 of the script · Remind everyone with an unpaid invoice"), with the usual
Allow, Always allow and Deny. Once over, the script's last note is the headline, with **Undo all
N changes**. Opened: the script itself (`CodeBlock`, copyable), the calls grouped by kind, each
opening to its input and output, the questions it asked, and what it gave back. The run's own
`run_script` row is folded into it.

### Undo, Activity and replay

The computer's tools are tracked per call (ADR 0030): a `Write` inside a script is its own change
set, named by its call. The story gathers them, and **Undo all** puts them back in one press,
through the one Undo dialog. Activity lists each consequential call ("Created notes/a.md, in a
script") with its own Undo, and a run's replay (ADR 0113) shows every call as a step of its own.

## Threat model

- **The script is untrusted code**, written by a model that may have read a hostile page. It runs
  sealed; it holds no key, handle or path; it reaches only the gateway's three answers. Every
  power stays in the gateway, checked per call.
- **A script as a way around a question.** Closed by gating every call at the call, with the real
  arguments, through the same function as a step: never a whole-script approval, which is what
  made Hermes's an approval bypass. Tested end to end (`scripts/gate.test.ts`): a write still asks
  and waits; taint from a read in the script holds a later sink exactly as across steps, with the
  same words, and Auto lets the same call through without the read; a declined call throws and
  isn't skipped; fifty deletes in a loop ask in Full trust.
- **Parallel calls.** Calls are gated one at a time, so a `Promise.all` of 300 sends meets the
  patterns in order. A call's arguments can only depend on what earlier calls answered once they
  have answered, and by then their reads have marked the chat.
- **Escaping the process.** The runtime's own attack tests (`conchapps/runtime.test.ts`) and the
  script's (`scripts/runner.test.ts`: `fetch`, `import('node:fs')`, child processes, sockets,
  `eval`, `new Function`, `require`, the environment, `getBuiltinModule`, any other address) all
  refuse.
- **Exhausting the computer.** The bounds above; eight calls at once; Stop kills the process tree
  (a sealed process can't start programs, so it is the tree).
- **Flooding the person.** One story per run; counters, not rows; at most a few progress words a
  second.

## Consequences

- A loop of 300 calls costs one model step and the size of what the script returns, not 300 steps
  and 300 results.
- The model must write a little code. The description teaches when it's worth it; a model that
  writes it badly gets the line and the error back, and can fix it.
- The computer's own tools are now reachable through Conch for providers that bring their own
  (Claude Code, Codex): inside a script only, gated as for an API model.
- A chat's log grows by two small events per call. A 2,000-call run is a few MB at most.
- What a provider brings as tools of its own (its native shell, its own MCP servers) isn't
  reachable from a script: only Conch's tools and the computer's are.

## Sources

- Anthropic, "Code execution with MCP: building more efficient AI agents", 2025-11-04,
  <https://www.anthropic.com/engineering/code-execution-with-mcp>
- Anthropic, "Introducing advanced tool use on the Claude Developer Platform", 2025-11-24,
  <https://www.anthropic.com/engineering/advanced-tool-use>; programmatic tool calling,
  <https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling>
- Cloudflare, "Code Mode: the better way to use MCP", 2025-09-26, <https://blog.cloudflare.com/code-mode/>
- Nous Research, Hermes Agent code execution,
  <https://hermes-agent.nousresearch.com/docs/user-guide/features/code-execution> and
  `tools/code_execution_tool.py` in <https://github.com/NousResearch/hermes-agent>
- OpenClaw, Code Mode, `docs/tools/code-mode.md` in <https://github.com/openclaw/openclaw>
- Wang et al., "Executable Code Actions Elicit Better LLM Agents", ICML 2024,
  <https://arxiv.org/abs/2402.01030>; Hugging Face, smolagents secure code execution,
  <https://huggingface.co/docs/smolagents/tutorials/secure_code_execution>; CVE-2025-5120,
  CVE-2025-9959, CVE-2025-14931
- Greshake et al., "Not what you've signed up for: Compromising Real-World LLM-Integrated
  Applications with Indirect Prompt Injection", 2023, <https://arxiv.org/abs/2302.12173>
- Node.js permission model, <https://nodejs.org/api/permissions.html>; `module.stripTypeScriptTypes`,
  <https://nodejs.org/api/module.html#modulestriptypescripttypescode-options>
