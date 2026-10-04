# 0053 — More providers: the plans you pay for, every key, and servers of your own

- Status: accepted
- Date: 2026-10-03
- Amends: [ADR 0010](./0010-providers.md) (the provider list and its page),
  [ADR 0012](./0012-every-provider-at-once.md), [ADR 0020](./0020-backups.md) (a new power),
  [ADR 0036](./0036-provider-consistency.md) (declining a program's own tools),
  [ADR 0042](./0042-come-home-the-rest.md) (keys brought home)
- Amended by: [ADR 0069](./0069-carrying-a-chat-on.md) (sessions loaded again, instructions where each
  program takes them, its own tool calls shown, the door over stdio)

## Context

Conch spoke to five providers: Claude Code, Codex, Ollama, OpenRouter and the Anthropic API.
OpenClaw and Hermes Agent list dozens. Most people who try Conch already pay for something — a
Copilot seat, a Google account with Gemini, a SuperGrok plan — or have a key from a company we
didn't know, or run llama.cpp on a box under the desk. Each of those was a dead end.

Adding twenty providers the obvious way would also have made the Providers page twenty cards long,
twenty sets of words to get wrong, and twenty bits of HTTP code that each half-handle streaming,
reasoning and errors.

## Decision

Conch gets sixteen more providers and any server of your own, in three kinds, and a Providers page built around finding the
one you want rather than scrolling to it.

| Kind                 | Providers                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **Your plans**       | GitHub Copilot, Gemini CLI, Grok (beside Claude Code and Codex)                                        |
| **On this computer** | LM Studio, and **Another server**: any OpenAI-compatible address (beside Ollama)                       |
| **Pay as you go**    | OpenAI, Google Gemini, xAI, DeepSeek, Mistral, Groq, Cerebras, Z.ai, Kimi, MiniMax, Qwen, Ollama Cloud |

Enterprise clouds (Bedrock, Vertex, Azure) are left for later.

### One reader, one adapter, a row per company

Every pay-as-you-go company speaks the OpenAI chat format, each with its own accent. There is one
stream reader (`engines/api/chat.ts`) and one adapter (`OpenAiWire`, `engines/api/openai.ts`); a
company is a row in `engines/api/presets.ts`, not a class.

- **The reader** takes reasoning however it comes (`reasoning_content`, `reasoning`, Mistral's
  thinking parts, `<think>` tags in the text), keeps Gemini's thought signatures so a tool call can be
  replayed, takes the last usage seen, and reads an error that arrives inside a 200.
- **The row** says where the company answers, where its key comes from, how to read its model list
  (field names differ: `context_length`, `max_model_len`, `context_window`, …), and what's free.
- **Models are tidied once, for everyone.** Embedding, speech, image and moderation models are left
  out; dated copies and `-latest` aliases fold into one; the list is ranked newest first.
- **It heals instead of failing.** A model that rejects tools, or an effort setting, is asked again
  without them, and Conch remembers for that model.
- **Errors are read by status and code together** (`mapChatError`), so "out of credit", "bad key" and
  "model not available in your region" each say what to do.

### Regions

Z.ai, Kimi, MiniMax and Qwen sell the same thing at several addresses (international, China,
Singapore, US, Hong Kong), and a key works at exactly one. Rather than asking a person which region
their key is from — a question few can answer — Conch tries the company's own addresses in order
and remembers the one that took the key (`settings.endpoints`). It only ever tries that company's
addresses.

### A key is recognised, never tried at the wrong company

Paste a key anywhere on Settings → Providers and Conch says whose it is. Each key form carries two
patterns (`KeyForm.recognise`):

- **distinct** — a prefix only one company uses (`gsk_` Groq, `xai-` xAI, `sk-ant-` Anthropic,
  `sk-or-` OpenRouter, `sk-proj-` OpenAI, `csk-` Cerebras, `AIza` Google, `sk-ws` Qwen). A match
  connects straight away.
- **loose** — a shape that isn't a company's own: `sk-` and 32 hex characters (DeepSeek, older Qwen
  and OpenAI keys), or no prefix at all (Mistral's 32 characters, Z.ai's `id.secret`). Conch asks
  whose it is, offering those companies as buttons and "Someone else's". It asks **even when only
  one company's shape fits**: an unprefixed key that looks like Mistral's could be anyone's.

`recogniseKey()` lives in the protocol, so the browser and the server agree, and returns whether
it is `sure`. The rule that matters: **a key is only ever sent to the company that alone uses its
prefix, or the one the person chose.** Trying a key at each candidate in turn to see which takes it
would hand one company's secret to several others, and those companies may log it. Only a prefix
that is the company's own mark can be `distinct`; a length or a character set never is.

### Your plans, through the vendor's own program (ACP)

Copilot, Gemini CLI and Grok are driven the way Codex is: Conch runs the vendor's own program on this
computer, signed in with the person's own sign-in, and talks to it over the
[Agent Client Protocol](https://agentclientprotocol.com) — JSON-RPC on stdin and stdout
(`engines/acp/`). Each program is a row in `engines/acp/agents.ts`: how it starts (`copilot --acp
--stdio`, `gemini --acp`, `grok agent stdio`), how a person signs in, what to keep out of its
environment.

- **Conch never touches their credentials.** Signing in runs the program's own sign-in. Copilot and
  Grok print a device code, which Conch shows large with a copy-and-open button; Gemini opens
  Google's page in the browser itself. Conch never reads `~/.gemini/oauth_creds.json`,
  `~/.grok/auth.json` or Copilot's token, and never calls the vendors' endpoints with their client
  ids. That is the line the vendors draw. Gemini CLI's terms call "directly accessing the services
  powering Gemini CLI … using third-party software" grounds for suspension. GitHub's API terms and
  xAI's terms only license their documented paths. All three document ACP as the way for other
  tools to drive their program. Conch uses only these documented paths.
- **Conch's tools, through a door.** Each turn opens a loopback MCP server (`engines/acp/door.ts`) that
  serves Conch's own tools: files, commands, memory, the browser and your apps. It listens on
  127.0.0.1 only, refuses any request with an `Origin` header or a non-loopback `Host`, and wants a
  random bearer key compared in constant time. A program's request to use a door tool is allowed
  (`forDoor`), because Conch checks those itself, every call. The request must name the tool and
  nothing else (`conch__remember`, `remember (conch MCP Server)`): a shell command that merely
  starts with "conch remember" is the program's own. It's allowed once, never "always", so the
  program can't learn to skip asking for things that look the same. Its own built-in tools that
  change things are declined, as Codex's are ([ADR 0036](./0036-provider-consistency.md)), so every
  action is sealed, guarded and can be undone.
- **A warm program, a fresh session per turn.** The program stays running; each turn is a new session
  carrying Conch's handoff, so switching provider mid-chat works the same as everywhere else.
  _Amended by [ADR 0069](./0069-carrying-a-chat-on.md): a chat's session is loaded again where the
  program can (`session/load`); Conch's instructions go where each program takes them, not in the
  message; the program's own tool calls show as rows; and a program without HTTP gets the door over
  stdio._

### On this computer

- **LM Studio** is found where it lives: its home from `~/.lmstudio-home-pointer`, its port from its
  own server config, confirmed with its greeting endpoint. If the server isn't running, Conch starts
  it with `lms server start` and says so.
- **Ollama Cloud** works two ways: an ollama.com key, or the Ollama app's own sign-in, in which case
  the `-cloud` models come through the local app and no key is needed.
- **Another server** is any OpenAI-compatible address: llama.cpp, vLLM, Jan, LiteLLM, or a hosted
  service such as Together or Fireworks. Each one becomes a provider of its own (`server-xxxxxxxx`)
  with its own name, card and models. As the address is typed, Conch looks at it (`probeServer`):
  it tries the likely paths, says what answered ("llama.cpp, with 3 models"), and whether it wants
  a key. The Add button is only enabled once that will work. Ollama and LM Studio addresses are
  sent to their own cards, where they can do more.
- **Plain http only stays at home.** An `http://` address must be this computer or a private
  network (`isPrivateUrl`: loopback, RFC 1918, link-local, CGNAT for tailnets, `.local`); anything
  else must be https, so a key and a chat never cross the internet in the clear.

### Found on this computer

Conch offers what's already there, under **Found on this computer**: a provider's key in an
environment variable (`OPENAI_API_KEY`, `GROQ_API_KEY`, …) and a model server answering on its usual
port. A found key is shown as its variable and last four characters, and nothing is used until the
person presses **Use**. The server only reads its environment for this when the gateway is started
with `lookAround`, so tests and scratch gateways see nothing.

### The Providers page

Providers you've connected are on top. The rest is a gallery grouped by how connecting works (your
plans, on this computer, pay as you go), searchable by name or by what a provider is good at, with
a "free" note where one is honest. Each provider's page walks through getting a key, with a link
straight to the right console page, and takes a key pasted anywhere on it.

### Whole-Conch hooks

- **Setup and Repair everything** know how to install and update `copilot`, `gemini`, `grok` and
  LM Studio. LM Studio's server is started when a chat needs it.
- **Backups** gain the power `provider-servers`. Restoring a backup that adds a server, which is an
  address chats would go to, shows it first.
- **Come home** brings OpenClaw's and Hermes's keys for every new provider. Keys for providers an
  older Conch doesn't know go in a `moreKeys` field, so an older reader ignores them instead of
  refusing the file.
- **The docs reference** reads the engine list from `engines/registry.ts`, the same list the server
  builds from, so every provider has its page and its row in the capability table.

## Security

- Keys stay where every key stays ([ADR 0025](./0025-passwords.md)), are shown once as their last
  four characters, and never travel in URLs, logs or the browser after saving.
- A key is only sent to the company it was recognised as or chosen for (above), and a server's key
  only to that server.
- An ACP program's credentials are never read, copied or reused; tokens in the environment that would
  silently win over its own sign-in (`GH_TOKEN`, `GITHUB_TOKEN` for Copilot) are removed from it.
- The door accepts only loopback, a random per-turn key and no browser origin; native write and
  command tools are declined.
- Plain http is refused outside private networks; a restored backup can't add a server unseen.

## Consequences

- Twenty-one providers, and adding one more company that speaks the OpenAI format is a row in
  `presets.ts`, a row in `providers/catalog.ts`, a mark in Nacre and a docs page. AGENTS.md says how.
- An ACP agent's own conveniences (its file editor, its shell) aren't used; Conch's sealed tools do
  that work instead. That's the trade for undo and the guard everywhere.
- Copilot's ACP doesn't switch models within a running program, so its model is chosen when the
  program starts, and each model in use gets a warm program of its own.
- Region probing costs one failed request per wrong region, the first time only.
- Gemini CLI on a consumer Google login is the vendor's documented integration path, but no Google
  page explicitly blesses a gateway like Conch driving it. A Gemini API key is offered beside it,
  under Pay as you go, for anyone who wants no ambiguity.

## Sources

- ACP: https://agentclientprotocol.com; Copilot ACP server:
  https://docs.github.com/en/copilot/reference/acp-server; Gemini CLI ACP mode:
  https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md; Grok Build:
  https://docs.x.ai/build/overview
- Terms: https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md,
  https://docs.github.com/en/site-policy/github-terms/github-terms-of-service,
  https://x.ai/legal/terms-of-service
