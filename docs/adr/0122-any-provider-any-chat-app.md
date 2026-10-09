# 0122 — Any provider, any chat app

- Status: accepted
- Date: 2026-10-09
- Builds on: [ADR 0061](./0061-apps-you-make-share-and-add.md) (Conch apps: the maker, the seal, signing, sharing),
  [ADR 0053](./0053-more-providers.md) (one OpenAI-style adapter, servers of your own),
  [ADR 0018](./0018-channels.md) and [ADR 0045](./0045-teams-matrix-wechat.md) (channels, the public door),
  [ADR 0052](./0052-one-app-one-card.md) (one app, one card), [ADR 0046](./0046-edit-by-hand-and-live-data.md) (the SSRF guard),
  [ADR 0028](./0028-safe-hands.md), [ADR 0117](./0117-auto-asks-about-what-matters.md) and [ADR 0118](./0118-auto-judges-every-app-step.md)

## Context

Conch ships two dozen providers and fifteen chat apps. Whoever needs one more — a model
company at work, Fireworks, a self-hosted Zulip — waits for a release. We don't want a
hub: a registry is a supply chain to police, and the person who needs Baseten shouldn't
need anyone's permission.

How others do it (read 2026-10-09):

- **OpenClaw** plugins: an `openclaw.plugin.json` read before any code runs, providers
  and channels registered from TypeScript (`registerProvider`, `createChatChannelPlugin`),
  installed from npm, ClawHub or git. A consent screen hashes the declared surface and
  asks again when an update declares more. Native plugins run in-process: its own docs call
  a malicious one "equivalent to arbitrary code execution". An OpenAI- or
  Anthropic-compatible endpoint can be config alone (`models.providers.<id>`).
- **Hermes Agent**: `providers:` in `config.yaml` (`api`, `key_env`, `transport`:
  `chat_completions` or `anthropic_messages`), `key_cmd` for short-lived tokens;
  platform adapters are Python dropped in `~/.hermes/plugins/` with a `plugin.yaml`
  declaring `requires_env`, enabled with a y/N that defaults to No, a restart for files.
  In-process, unsandboxed.
- **LiteLLM**: `openai/<model>` with `api_base`, or a `CustomLLM` Python class named in
  `custom_provider_map`, restart. No safety story.
- **Vercel AI SDK**: `createOpenAICompatible({ baseURL, headers })`, or the
  `LanguageModel` spec (`doStream` with typed parts, a spec version). A library: code,
  npm, redeploy.
- **n8n community nodes**: npm packages, a GUI install for admins behind a risk
  checkbox, "full access to the machine"; a verified tier.
- **Matterbridge**: a protocol is Go in the tree, a fork to add one; tokens in TOML.
- **Zed / LibreChat / Continue**: `openai_compatible` settings with per-model
  capabilities; keys in the keychain (Zed) or env references.

Where they're hard: an npm or pip install, a config file, a restart, keys in a file, and
code with the person's full powers. Where they're good: **declare first** (most providers
are an address and a key), **a small adapter contract** (Matterbridge's four methods,
the AI SDK's stream), **consent tied to what's declared**, and **pairing for chat apps**.

Conch already has every hard part solved once: Conch apps are made by the assistant in
a chat, checked, sealed in a process of their own, signed, shared on GitHub, added from a
link with a preview, kept with Go back and Repair everything.

## Decision

### 1. A provider and a chat app are parts of a Conch app

`conch-app.json` (`ConchAppManifest`) gains two optional parts (`packages/protocol/src/app-parts.ts`):

- **`provider`**: `speaks` (`openai`, `anthropic` or `code`), `address` (https, its host
  in `reaches`), `auth` (`bearer`, `header` with `header`, `none`), `key` (what the person
  types: label, help, link, pattern, optional), `models` (with context, tools, images,
  thinking and a price per million tokens; empty means read live), `small`.
- **`channel`**: `receives` (`poll` from this computer, or `webhook` through the public
  door), `fields` (what the person types, secret unless said otherwise), `steps` (what to
  press in the chat app), `buttons`.

Everything Conch apps have comes with them unchanged: the maker, the quality bar, the
seal, signatures, Share and **From a link**, updates that show new reach first, Go back,
the Apps card and its switch. No hub, no npm, no config file, no restart.

### 2. Declared first; code when it must

A declared provider runs on the same `ApiEngine` and chat adapters as Conch's own
(`openai.ts`, or `anthropic.ts` through an `AnthropicRoute`), so tools on every model,
long chats, healing, limits and the fallback all work. Its one way out is `partFetch`
(`extensions/fetch.ts`): https to a host in `reaches` exactly, every address checked as
it's dialled (the live-data guard), never this computer, your network or Conch's port,
no redirects, nothing of Conch's; and its key in the header it declared, or none.

The rest export functions from the app's module, run in the sealed runtime (additive to
`runtime/host.mjs` and `runtime.ts`):

- `provider.chat({ model, system, messages, tools, maxTokens }, app)`: OpenAI's chat shape
  in, `app.emit({ type: 'text' | 'thinking', delta })` to stream, `{ toolCalls, stop, usage }`
  out (`SealedWire`). The transcript keeps OpenAI's shape, so a chat moves to any provider.
- `channel.identify(app)`, `channel.poll({ cursor }, app)` or `channel.receive(delivery, app)`,
  `channel.send({ chatId, text, buttons? }, app)`, `channel.directChat`.

That is the contract every built-in channel implements (`ChannelAdapter`):
`AppChannelAdapter` (`extensions/channel.ts`) maps it, and `ChannelService` takes it like
Telegram, so the hello, **Let in**/**Block**, groups off, approvals as buttons or numbered
replies, routine results, `message_user` and Send all work as they are. Conch owns the
loop: it polls, waits longer while quiet, backs off, stops at a refused key.

A declared price is what spending counts (`PricedWire`).

### 3. Keys stay in Conch

The person types the key into the card. A provider's goes with every provider key
(`ProviderKeys`, under `app-<id>`), shown in Settings → Providers and Passwords; a chat
app's fields go with every channel's keys (`ChannelSecrets` `{ kind: 'app' }`). The sealed
code gets them per call as `app.keys`, never in its files, environment or arguments, and
never anyone else's. Taking the app away takes its provider and its key, and disconnects
its chat app.

### 4. The seal, and what a chat app may not do

- Sealed like any Conch app: its folder and data only, no programs, no network but
  `app.fetch` to its `reaches`; a provider's answer may wait longer (three minutes a request,
  ten a turn), a chat app's polls get a larger hourly budget.
- `app.emit` exists only while `provider.chat` runs; what it sends is checked (text or
  thinking, capped). Everything a part returns is checked by Zod before Conch reads it.
- A chat app's code can only hand messages to the channel service and send what it's
  given: it has nothing to read a chat or call a tool with (`sealed.test.ts` sweeps it).
- **But it says who is writing.** A chat app's code could claim to be its owner, and
  press **Allow** for them. So a chat app not made here (`ownedHere`: from a link, a file,
  or a change to someone else's) never carries what grants trust: its questions say
  "answer it in Conch" and wait there (and as a notification), and its settings commands
  are refused (`ChannelService.#vouched`). One made here asks in the app like a built-in.
- Adding, and **Test it** for anything from outside, need a recent sign-in, like adding a
  stranger's app (ADR 0061 §9). The preview shows what it reaches and which keys it needs
  before anything runs with them.

### 5. Make it with Conch

"Add Fireworks as a provider", "connect me on Zulip", in any chat or from **Make one with
Conch** in Settings → Providers and Apps → Talk to me here. The maker reads the vendor's
docs (the research tools), starts from `app_new` with `kind: "provider" | "channel"` (a
starter that already reads), writes it, and `app_try { part }`: the structural check, and
a real line when no key is needed. The quality bar requires it, and that the address is
in `reaches` and the module exports what the part needs.

The card (Nacre `PartReview` in `AppOffer`, and in the link preview) says what it is and
where its key goes, its models and prices, the steps in the chat app; the person types the
key and presses **Test it**: a real one-line answer streams in, in the provider's own
words, or the bot says who it is. **Add** waits for a test that passed, then is one press.
Added, a provider is in the picker; a chat app waits for the owner's hello.

**Add your own by hand**: **Any OpenAI-compatible address** (the existing Another server,
not a second one) and **Add from a link** (Conch apps' own preview). Badges say **Made by
you** or **Added from a link**. When one breaks later, Repair everything offers **Ask Conch
to fix it** (`DoctorAction` `ask`): a chat that reads the docs again and shows an update.

### 6. Decided while building it

- Provider ids are `app-<appId>`, kept in `EngineId`, so a chat keeps finding it across
  updates. The mock engine, pinned for tests, lists app providers beside itself so the
  journey can make one and chat with it; no other pin does.
- The mock's pretend world (`extensions/pretend.ts`): Pretend AI and Parley on this
  computer, reached only through their exact hosts and only with the mock engine.
- `identify` and `models` take only `app`; the rest take their input, then `app`.

## Threat model

- **A malicious or injected maker** writes a provider that sends chats elsewhere: it
  reaches only the hosts on its card, through the SSRF guard; the person saw them before
  adding it and before testing with their key.
- **A stranger's chat app** impersonates its owner to steer the assistant: approvals and
  settings never go through it; what Auto allows by itself still runs, as for the owner's
  own words, so a stranger's chat app is a trust decision shown on its card.
- **Key theft**: keys never reach its files or environment; each call gets only its own.
- **Residual risk**: as ADR 0061, the network seal on Node 24 is a fence in the process.
  An older Conch reading data from a newer one won't know `app-` providers or the `app`
  channel kind (the same as servers when they arrived).

## Sources (reviewed 2026-10-09)

- OpenClaw: `docs/plugins/manifest.md`, `sdk-channel-plugins.md`, `sdk-provider-plugins.md`, `plugin-permission-requests.md`, `docs/channels/pairing.md`.
- Hermes Agent: `gateway/platforms/ADDING_A_PLATFORM.md`, `plugins/model-providers/README.md`, `website/docs/integrations/providers.md`.
- LiteLLM: docs.litellm.ai/docs/providers/custom_llm_server, /providers/openai_compatible.
- Vercel AI SDK: ai-sdk.dev/providers/openai-compatible-providers, /community-providers/custom-providers.
- n8n: docs.n8n.io/integrations/community-nodes/installation, /risks.
- Matterbridge: github.com/42wim/matterbridge wiki, `bridge/bridge.go`.
- Zed (docs/ai/use-api-access), LibreChat (custom endpoints), Continue (reference).
- OWASP SSRF Prevention Cheat Sheet; OWASP Top 10 for LLM Applications 2025 (LLM03, LLM06); Greshake et al., 2023.
