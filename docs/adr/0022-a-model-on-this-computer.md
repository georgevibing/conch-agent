# 0022 — A model on this computer

- Status: accepted
- Date: 2026-09-30
- Builds on: [ADR 0010](./0010-providers.md), [ADR 0012](./0012-every-provider-at-once.md),
  [ADR 0016](./0016-getting-what-a-feature-needs.md). Offline routing, which picks
  a local provider when the internet is down, is ADR 0018.

## Context

Every provider Conch had needed the internet and, one way or another, cost
money. People asked for three things at once: a model that stays **private**
(nothing leaves the machine), that's **free**, and that **keeps working
offline** — on a train, when a provider is down, when a plan runs out.

Open models that call tools well now fit on an ordinary laptop, and Ollama is
the way most people run them: a per-user install on Windows, an app on macOS, a
service on Linux, with a small local HTTP API. The hard parts are the ones a
non-technical person hits first: installing it, knowing which model to get,
a download of several gigabytes, and a model that quietly doesn't fit.

## Decision

A new provider, **On this computer** (engine `ollama`, `Engine.local = true`),
is a third variant of the API engine family (`engines/api/ollama.ts`), fed by
`LocalService` (`apps/server/src/local/`), which knows where Ollama is and how
it is.

### Native `/api/chat`, not `/v1/chat/completions`

Ollama's OpenAI-compatible endpoint would have reused OpenRouter's wire, but
it can't set the context size, and Ollama's default (`num_ctx` 4,096 on
machines with under 24 GiB of VRAM) can't hold Conch's tool definitions: the
start of the conversation is silently dropped. The native API takes
`options.num_ctx`, so Conch asks for 16K tokens on computers under 12 GB and
32K above, clamped to the model's own `<arch>.context_length` from
`/api/show`, and the same number every time for a model (a different one
reloads it).

What the native stream is, and what the wire does about it:

- NDJSON, one object a line. A tool call arrives whole in one chunk with
  `arguments` already an object; calls have an `id` since 0.12.10, and one is
  made up for older versions so results still pair. A failure after the 200 is
  a line with `error`.
- The whole assistant message (content, `thinking`, `tool_calls`) goes back
  next time; tool results are `role: "tool"` with `tool_name` (and
  `tool_call_id`).
- `think` takes a boolean, or a level for gpt-oss. `think: true` on a model
  that can't think is a 400, and so are tools on a model that can't call them:
  both are healed by asking again without, once, and remembered.
- Small models on an ordinary computer are slow to think, so "Auto" answers
  straight away (`think: false`); the picker's Thinking dial turns it on.
- A model that can't call tools is sent none and told so in its prompt;
  it still chats. A model that isn't loaded yet gets a "Loading … into
  memory" notice instead of a silent spinner.
- Costs are recorded as $0; usage says "nothing to pay, and no limit".

### Zero setup

Settings → Providers → On this computer is one flow on Nacre's
`SetupChecklist`: **Ollama → the model → ready to chat**, with one button.

1. **Ollama** is a need (`setup/known.ts`): found on `PATH` or where its
   installers put it (`%LOCALAPPDATA%\Programs\Ollama`, the Mac bundle's
   `Contents/Resources`, `/usr/local/bin`). Windows installs it with winget
   `Ollama.Ollama` (Inno, user scope, no administrator); macOS with the
   Homebrew cask `ollama-app` (renamed from `ollama` in 2026). Linux's
   installer is a script run with sudo, so Linux gets a link — never
   `curl | sh`.
2. **The model**: the page suggests one for this computer, with its size and
   an honest download time (a typical 90 Mbit/s connection until Conch has
   seen a real download here, then that speed). The press that installs
   Ollama carries straight on to the model — no second press. The download is
   `/api/pull`, streamed: real bytes, speed and time left; **Pause** keeps what's
   there and **Resume** carries on from it (Ollama resumes partial files; there
   is no cancel endpoint, so both abort the request); **Cancel** forgets it.
3. **Ready**: the page lists the models here to pick from (the pick becomes
   what local chats use), and offers to get another.

It says plainly, before you connect, that these models are slower and less
capable than the big cloud ones, and what they're good for.

### Which model, for which computer

Conch only suggests models that call tools, checked against Ollama's library
and registry manifests in September 2026:

| Memory (as the OS reports it) | Suggested           | Download | Why                                                                           |
| ----------------------------- | ------------------- | -------- | ----------------------------------------------------------------------------- |
| under 7 GiB                   | `qwen3.5:2b-q4_K_M` | 1.9 GB   | tools and vision in under 2 GB (`qwen3:1.7b` on Ollama < 0.17.1)              |
| 7–14 GiB ("8 GB")             | `qwen3:4b-instruct` | 2.5 GB   | fast, no thinking, good tool calls (BFCL 35.7%)                               |
| 14–40 GiB ("16 GB"+)          | `qwen3.5:9b`        | 6.6 GB   | best small model at tool calls (vendor BFCL 66.1); `qwen3:8b` on older Ollama |
| 40 GiB+                       | `qwen3.6:35b-a3b`   | 22.6 GB  | mixture of experts, near cloud quality; needs Ollama ≥ 0.30.0                 |

Alternatives on the list: `qwen3:1.7b`, `llama3.2:3b`, `qwen3.5:4b`,
`qwen3:8b`, `gpt-oss:20b`. Gemma 3 isn't offered (no tools in Ollama); Gemma 4
needs Ollama 0.30.9. Each model carries the oldest Ollama that runs it, and a
model this Ollama can't run isn't suggested.

**Never one that won't fit.** A model needs its weights × 1.2 plus 1.5 GiB of
memory, within three quarters of this computer's; and its download plus 2 GB
spare on the disk that holds Ollama's models (`OLLAMA_MODELS` or
`~/.ollama/models`). Anything short is said in one sentence with the numbers
("needs 4.5 GB of free space, and this computer has 3.0 GB. Free up about
1.5 GB"), and there's no button to press.

### Kept working (agreement 11)

- **Ollama stopped** while someone uses it here (a model on disk, or one
  chosen in Conch): Conch starts it quietly — the Windows app hidden in the
  tray (`"ollama app.exe" --hide --fast-startup`), the Mac app hidden
  (`open -j -a Ollama`), else `ollama serve` — detached, with Conch's own
  settings kept out of its environment, and leaves a "Fixed on its own"
  note. A turn that finds it stopped does the same and asks again. An
  Ollama nobody uses here, quit on purpose, is left alone.
- **Repair everything** has a `local-model` check: "off" when it isn't set up
  (not a problem), "warning" when a used Ollama isn't running, and a repair
  starts it.
- The chat says why a model isn't there any more, or doesn't fit in memory
  right now, in words a person can act on.

### Offline

Detection, the model list, recommendations and chats only ever talk to Ollama
on this computer. The catalogue and sizes are constants in code; nothing is
looked up online until a person presses Get.

## Security

- **Loopback only.** Conch reads `OLLAMA_HOST` but follows it only to this
  computer (`127.0.0.0/8`, `::1`, `localhost`, or the every-address binding,
  dialled as `127.0.0.1`/`[::1]`), always as an IP literal. Anything else —
  a LAN address, a host name, credentials, another scheme — is refused, and the
  page says what to change. `send(…, local: true)` refuses any non-loopback URL
  and follows no redirect. Reaching an Ollama on another machine would need an
  explicit, explained setting; there is none.
- **Cloud models are never "on this computer".** Ollama lists the cloud
  models someone pulled (`gpt-oss:120b-cloud`) next to real ones, but every
  chat with them goes to ollama.com. Conch leaves out any tag with
  `remote_host` or `remote_model` set, and any name ending in `-cloud` or
  `:cloud` (for an Ollama that doesn't say), so they're never listed,
  chosen, or used for an offline answer.
- **Names are validated** (`LocalModelName`): each part starts with a letter or
  digit, so `.`/`..` can't be a part; no backslashes, spaces, `%`, `?`; at most
  three parts before the tag. **Only models on Conch's list can be downloaded**
  — the same rule as install recipes (ADR 0016): what gets fetched is a
  constant, never a string a page or the agent chose.
- **Downloading needs sudo mode** (a password or key from the last 10 minutes),
  like installing a program: `POST /api/local/pull`. Pausing, cancelling,
  starting Ollama and choosing among models already here persist nothing new
  and don't ask. The agent has no tool for any of it.
- Threat model: a web page can't reach these routes (the gateway's Host,
  Origin and Fetch-Metadata checks cover `/api`); another local program could
  already talk to Ollama directly, so Conch adds no reach; the agent's tool
  calls are untrusted and can't pull, start or choose.

## Consequences

- New: `engines/api/ollama.ts`, `local/` (host, client, models, pull, service,
  routes), the `ollama` need, `GET /api/local`, `POST /api/local/{pull,pull/pause,pull/cancel,start}`,
  `PUT /api/local/model`, `~/.conch/local.json` (the chosen model and the last
  download speed), and the `local-model` doctor check.
- `EngineId` gains `ollama`; `ApiVariant` gains `keyless`, `local`, `status`
  and `where`; `Wire` gains `toolsFor`; `WireEvent` gains `notice`.
- Nacre: `ProviderLogo` `local`, the `ollama` tile, `ProviderCard.stateLabel`.
- Conch may now start Ollama on this computer, and runs winget or Homebrew to
  install it when a person asks.

## Sources (September 2026)

- Ollama API: `docs.ollama.com/api/chat` (streaming, tool calls, `think`,
  `options.num_ctx`), `/api/tags`, `/api/show` (`capabilities`, since 0.6.4),
  `/api/version`, `/api/ps`, `/api/pull` (status sequence, in-stream errors),
  `DELETE /api/delete`; `docs.ollama.com/openai` (OpenAI compatibility, no
  `num_ctx`); `docs.ollama.com/faq` (default context by VRAM, `OLLAMA_HOST`,
  `OLLAMA_MODELS`, resumed pulls).
- Ollama releases on GitHub: 0.12.10 (tool call ids), 0.17.1 (Qwen3.5),
  0.30.0 (Qwen3.6), 0.30.9 (Gemma 4), 0.35.0 (current).
- Installing and starting: `docs.ollama.com/windows` (per-user install, the
  tray app, `ollama serve`), `docs.ollama.com/macos`, `docs.ollama.com/linux`;
  winget-pkgs `manifests/o/Ollama/Ollama/0.35.0` (InstallerType inno, user
  scope); formulae.brew.sh `ollama` (formula) and `ollama-app` (cask).
- Models: `ollama.com/library` pages for `qwen3`, `qwen3.5`, `qwen3.6`,
  `llama3.2`, `gpt-oss`, `gemma3`, `gemma4`; sizes from
  `registry.ollama.ai/v2/library/<name>/manifests/<tag>`; tool-calling quality
  from the Berkeley Function Calling Leaderboard (`gorilla.cs.berkeley.edu/leaderboard.html`)
  and Qwen's own model cards.
- OWASP ASVS 5.0 V8 and NIST SP 800-63B-4 §2.2 for step-up verification before
  an action that persists something; ADR 0016 for fixed recipes.
