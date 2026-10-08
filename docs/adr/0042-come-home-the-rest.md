# 0042 — Come home, the rest: the model, other agents, a Slack bot with one key

- Status: accepted; §2 superseded by [§ Update: agents come over as agents](#update-agents-come-over-as-agents) (ADR 0101)
- Date: 2026-10-02
- Builds on: [ADR 0035](./0035-come-home.md) (Come home),
  [ADR 0010](./0010-providers.md) and [ADR 0012](./0012-every-provider-at-once.md)
  (providers, every one at once), [ADR 0013](./0013-skills.md) (skills),
  [ADR 0018](./0018-channels.md) (channels)

## Context

ADR 0035 left three things behind, each a sentence in its known limits:

- **Hermes's model choice.** `~/.hermes/config.yaml` says which model it
  answers with (`model.default`) and through what (`model.provider`:
  `openrouter`, `anthropic`, `openai-codex`, `nous`, `custom`…). OpenClaw says
  it too, in `openclaw.json` (`agents.defaults.model`, `provider/model` or
  `{ primary }`). Someone who chose Sonnet there gets whatever Conch's default
  is here.
- **OpenClaw's agents beyond `main`.** OpenClaw can run several agents
  (`agents.list`), each with its own workspace (`workspace-<id>` by default):
  its own `SOUL.md`, `IDENTITY.md`, `USER.md`, memories and skills, and cron
  jobs that run as it (`agentId`). A "work" agent with its own voice and its
  own notes stayed behind entirely.
- **A Slack bot with one of its two keys.** Conch talks to Slack over Socket
  Mode, which needs a bot token (`xoxb-`) and an app-level token (`xapp-`).
  OpenClaw's Slack in HTTP mode keeps a bot token and a signing secret and no
  app token; a Hermes `.env` can have either alone. Such a bot wasn't offered.

## Decision

### 1. The model: matched by what it is, said in words, undone by the ledger

Conch has no provider called "openrouter" or "nous" in the sense Hermes
does, and the same model has different ids in different places
(`anthropic/claude-sonnet-4.5` on OpenRouter, `claude-sonnet-4-5-20250929` on
the Anthropic API, `sonnet` in Claude Code). So `import/model.ts` matches by
what the model **is** against what each connected provider offers **now**
(`ProviderService.models()`, the model picker's own list):

1. Providers are tried in order: the one the app named (`anthropic` →
   Anthropic API, then Claude Code; `openrouter` → OpenRouter;
   `openai-codex` → Codex; a server on localhost → the model on this
   computer), then where its maker's models run (Anthropic → Claude Code,
   Anthropic API, OpenRouter), then anything else connected.
2. In each, the **very model** (same id once dates, dots and makers are
   set aside), else one of **its family** (Sonnet, Opus, Haiku, GPT-5). A
   provider's own "Default" is never taken for a model. A model on this
   computer only maps to one on this computer, and the other way round.
3. The plan says it in a person's words: **"Use Claude Sonnet, as in
   Hermes"**, with "New chats start with Sonnet 4.5 on Claude Code, the
   nearest here to Claude Sonnet 4.5. Now it's Claude Code's own choice."
   It's ticked only if you haven't chosen a default model yourself (like the
   name, ADR 0035), and marked as already here when it's the same.
4. When it can't be placed, nothing changes and a sentence in "What stays
   behind" says why: the provider isn't connected ("Connect it in Providers,
   then pick the model in any chat"), Conch can't connect to it at all
   ("Kimi"), or nothing connected offers it.
5. When the app's own key would connect its provider (an OpenRouter key in
   Hermes's `.env`), the item is offered **unticked**, saying it needs that
   key ticked too. Keys still never come over unless ticked. The model is
   brought **last**, after keys, and matched again against a fresh list, so
   a key that just came over can bring its provider; if it didn't, the
   outcome says so.
6. It's applied as the model picker's "make default" would be: the default
   provider and its model (`providers.use`, `preferences.model`). Chats you
   already have keep theirs. The ledger keeps what was there before
   (`before.preferences`, `model: null` for the provider's own choice) and
   Undo puts exactly that back (`UpdateSettingsBody.model` now takes `null`).

`config.yaml` is read by a small YAML reader in `read.ts`, like the JSON5
one: nested maps, lists of words, quotes, comments and block text, every
value a string, no anchors, tags or types. A file that isn't YAML (tabs, a
quote or bracket left open, a line that's no setting) throws, and the plan
says "Its config.yaml couldn't be read, so its model choice stays behind."
A `model:` it can't make sense of says so too. Only the model is read: a
`custom_providers` entry's `api_key` stays where it is, and tests check the
plan and the ledger for it. No new dependency: a full YAML parser (`yaml`)
would read more than Conch needs and parse more than it should trust.

The terminal (`pnpm conch import`) has no provider list, so there the model
is a sentence: it comes over in Conch itself.

### 2. Other agents: each persona as a skill, everything else as the main one's

> Superseded: Conch has agents now (ADR 0101), so every agent comes over as
> one of them. See [§ Update](#update-agents-come-over-as-agents) below.

Conch has **one assistant**, with one name and one set of instructions
(`Persona`), and everything you set up belongs to Conch and reaches every
provider (working agreement 9). There's no persona or profile switcher, and
adding one for imports alone would give people two ways to do the same
thing. What Conch does have for "behave this way in this chat" is a
**skill**: a `SKILL.md` you pick in ⌘K or the composer, read first,
held to what it says it needs, and working with every provider. So:

| In the other agent's workspace | Comes over as                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SOUL.md` (+ `IDENTITY.md`)    | A skill of Conch's own, **"Talk as Atlas"** (`atlas`), **off**: "For this chat, answer as Atlas, the "work" agent you had in OpenClaw", then its words |
| `USER.md`                      | Added to About you, unless it's the main agent's                                                                                                       |
| `MEMORY.md`, daily notes       | Memories, as they are (daily notes unticked). One the main agent has too comes over once, from there                                                   |
| `skills/`                      | Skills, off, like the main agent's; a name already taken is the main agent's                                                                           |
| Cron jobs with its `agentId`   | Draft routines, "as Atlas"                                                                                                                             |

Memories aren't tagged with the agent. Conch's memory is about the person,
one place for every chat ([ADR 0032](./0032-it-learns-you.md)), and recall by meaning finds a work
fact in a work chat by itself; a tag nothing reads would only be noise,
and changing the words would change what was remembered. Where each came
from is in the plan ("From Atlas's MEMORY.md").

Agents are found in `agents.list` (a valid id only, so `../escape` goes
nowhere) and, for a damaged or forgetful config, by their `workspace-<id>`
folders. Links aren't followed, as everywhere in Come home. An agent's
`auth-profiles.json` only fills a key the main agent didn't have.

The plan shows each agent **together, under its name**, after everything
else, with one tick for all of it (`ImportItem.agent`, Nacre
`ImportPreview`'s agent sections). Its persona goes through `scanText`
first: one that reads like orders starts unticked. Everything it adds is in
the ledger like the rest, so Undo takes it back.

### 3. A Slack bot with one key: offered, then finished on the Slack setup

The bot is offered like any other (never ticked): "Its bot token, from
Hermes's .env. Slack needs one more key: Conch shows you where to get it,
then waits for your hello." Bringing it connects nothing; the outcome says
which key is missing (`finish: 'slack-key'`) and the summary links to
**Finish connecting Slack** (`/channels/new/slack?from=hermes`).

The Slack setup picks up from there:

- `GET /api/import/slack?source=…` says which key Conch has (`has`), whose
  bot it is (checked with Slack), and the app's id (`A0…`, from inside an
  `xapp-` token, or from `bots.info` for a bot token). **Never the key.** A
  key Slack no longer accepts is a sentence, and the setup starts fresh.
- The app counts as made ("Made, in Hermes") and the key it has as done.
  The missing one is the current step, with a button straight to that
  app's own page:
  - no app-level token: **Socket Mode** (`api.slack.com/apps/<id>/socket-mode`):
    turn on Enable Socket Mode, keep the `connections:write` scope it
    suggests, Generate, copy;
  - no bot token: **Install App** (`…/install-on-team`): Install (or
    Reinstall) to Workspace, Allow, copy the Bot User OAuth Token.
- The pasted key is checked as it lands, then `POST /api/import/:source/slack`
  (sudo mode, like any import) reads the other key from the app's folder
  again, connects through `ChannelService.create` (keys from two apps are
  caught there), and adds the channel to the ledger: Undo takes it back.
- Opening Connect Slack yourself shows the same offer with **Use it**; it's
  only used if you press it.

A Slack check now also returns the app id, so the ordinary setup links to
that app's Basic Information page once a key gives it away.

## Consequences

- Moving over keeps the model you were used to, or says plainly why not,
  and takes nothing else with it. Undo is exact.
- A second OpenClaw agent arrives as a skill you choose per chat, with its
  notes and jobs. Conch stays one assistant.
- A Slack bot that answered over HTTP becomes a Socket Mode bot with one
  extra key and one button to its page; no key is ever shown to the page.
- Security: no new place keys live; the plan, the ledger, logs and the page
  never see a key (tests check each, including a key in `config.yaml`).
  Words from another agent are read first, skills from it come off, and
  finishing Slack needs a recent sign-in like the rest of Come home.
- **Known limits:**
  - A family match is a choice Conch made for you: it says "the nearest
    here" and starts unticked if you'd chosen a model yourself.
  - Another agent's own model (`agents.list[].model`) isn't brought: a skill
    can't choose a model. Its routines run with your default.
  - A routine that ran as another agent comes over in its words but not its
    voice: the persona skill starts off, so a routine can't use it until
    you turn it on.
  - OpenClaw's `bindings` (which agent answers which chat app) have no
    counterpart: a bot answers as your assistant, and you can pick the skill.
  - Slack's page addresses are Slack's to change; a link that moves still
    lands in your apps, one click from the right page.

## Update: agents come over as agents

- Date: 2026-10-07
- Builds on: [ADR 0101](./0101-agents.md) (agents)

Conch has agents now, each with a name, a face, a tone and instructions of
its own, so a persona skill and a renamed default are no longer the honest
counterpart. Every agent the other app ran comes over as one of Conch's
agents (`import/agents.ts`, `ImportService.#agentPlan`, the plan's `agents`
group). The persona items (`persona:name`, `persona:instructions`) and the
"Talk as …" skill are gone; Undo still reads an older ledger's `persona`.

**Where they're read** (both apps' docs and source, Oct 2026):

- OpenClaw: `agents.entries.<id>` (and the older `agents.list`), each with
  `name`, `workspace`, `model`, `thinkingDefault` and `identity { name,
theme, emoji, avatar }`; the workspace's `SOUL.md`, `IDENTITY.md`
  (`- **Name:**` lines, the template's hints ignored) and `AGENTS.md`. Its
  default is the legacy `default: true`, else `agents.defaults.systemAgent`,
  else the only agent. `bindings` say which agent answered which bot; a bot
  on `channels.<app>.accounts.<defaultAccount>` is now read too.
- Hermes: `~/.hermes` is the `default` profile, `~/.hermes/profiles/<name>/`
  (with `config.yaml`, `.env`, `SOUL.md`, `profile.yaml`, `auth.json` or
  `state.db`) the others, each a home of its own with memories, skills, cron
  and `config.yaml`. `profile.yaml` gives `display_name`, `description` and
  Bot Mode's `ui_meta.hermes-bots` (`title`, `avatar`); `active_profile` is
  its default. A profile's own bots stay behind, said; its keys fill a gap.

**How each maps:**

| Conch's agent  | From                                                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | IDENTITY.md's Name, `identity.name`, the entry's `name`, Bot Mode's title, `display_name`, else its id; made unique with `uniqueName` ("Atlas 2")                                                                                                                                               |
| `role`         | A Hermes profile's `description` (120 characters); OpenClaw has none                                                                                                                                                                                                                            |
| `avatar`       | Its own picture (a workspace file, never through a link or out of its folder, or a `data:` URI; never fetched from the web), read and kept by `AgentStore.setImage`; else the preset and colour its emoji (or words: "a curious fox") match, else one chosen from its name, the same every time |
| `persona.tone` | Counted from its words, its own words about its manner (Theme, Creature, Vibe) double, a negated one against; nothing that says one: warm                                                                                                                                                       |
| `personality`  | Its Theme, Creature or Vibe                                                                                                                                                                                                                                                                     |
| `instructions` | SOUL.md, then what the person added to AGENTS.md (OpenClaw's own template sections stay behind), whole up to 100,000 characters (ADR 0101), the plan saying gently when they're long; one an older Conch cut at 8,000 gets the rest                                                             |
| `defaults`     | Its own model, matched as the app's model is (§1), and its effort; never a permission mode. A model that can't be placed is a sentence; one that needs a ticked key waits for it                                                                                                                |
| `imported`     | `{ from, id, at }`: bringing it again finds it there and brings it up to date (Undo puts back what it was); unchanged, it's "Already in Conch"                                                                                                                                                  |
| routines, bots | A routine that ran as it gets `agentId`; the bot it answered gets `Channel.agentId` (also when a half Slack bot is finished later)                                                                                                                                                              |

All agents start ticked, except one whose words (or name, role, manner)
read like orders (`scanText`), one already as it would be, and those past
`AGENT_LIMITS.count`. Before its words are kept, the other app's own keys
and bot tokens are taken out by value, then anything shaped like a key or a
password (`scrubSecrets`, `secretIn`), and invisible characters
(`unsmuggle`); the plan says when it did. **New chats start with** is
theirs when the app said which was its default, else Conch's stays; Undo
puts the old one back. A picture is shown in the plan from
`GET /api/import/:source/agents/:id/face`: cleaned bytes from the last
look, `nosniff`, no caching, behind sign-in, an id that's never a path.

Known limits: Hermes's Bot Mode keeps its avatar in desktop metadata whose
format isn't documented; only a `data:` URI or a file in the profile is read.
An agent's own tools, sandbox and skill allowlist have no counterpart: every
agent here shares Conch's apps, skills and safety settings (ADR 0101).
