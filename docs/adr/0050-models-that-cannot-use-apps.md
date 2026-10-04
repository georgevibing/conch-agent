# 0050 — Models that can't use apps

- Status: accepted
- Date: 2026-10-02
- Amends: [ADR 0023](./0023-offline-and-limits.md), [ADR 0036](./0036-provider-consistency.md)
- Amended by: [ADR 0072](./0072-every-model-gets-its-tools.md) (a model without native tools
  gets them in words; chat-only is only for one whose window can't hold the list)

## Context

Some models only chat. Many on OpenRouter and the smallest local ones can't
call tools, so Conch gives them none (ADR 0036): no apps, files, commands or
memory. The model said so in a notice only once a reply had started. People
picked one for speed or price, asked about Linear, and got an answer that
couldn't look. To them, their apps had stopped working.

## Decision

**"Can use apps" is a model capability the UI shows.** `canUseApps(provider,
model)` in `@conch/protocol`: the provider offers Conch's tools
(`Capabilities.tools.host`) and the model isn't `tools: false`. Unknown counts
as able: a false "can't" would stop a chat that works. `modelOf` reads which
model a chat answers with, the same way the engines do. The model picker and ⌘K
show a quiet **Chat only — can't use your apps** line under such a model, and
search finds it by those words. Descriptions stop repeating it.

**A message that needs an app waits for a model that can.** Before a turn,
`ConversationManager.send` asks `appsNeeded` (in `providers/apps.ts`). It
checks whether the model that would answer can't use apps and whether the
person's own words need one. A message needs one when it cues an app they
connected (`IntegrationService.about`: the catalog cues of ADR 0021, Google
accounts, a custom app by name) or uses a skill that says it needs tools. If
so, the message waits in the chat as `turn.needs-apps`, with the best model to
switch to (`appsModel`):

1. The same provider's model that can (your default model there, else its first named one).
2. Then the default provider's, then any other ready provider's.
3. Never a provider, a spending choice or a data destination you haven't set up. With none, the card's one next step is **Connect a provider**.

**Switch to <model>** calls `release(id, engine, model)`. The chat keeps that
model, and the waiting message goes once, not twice. **Answer without it**
sends it to the chat's own model. Each chat asks once per model, and a message
typed instead joins the waiting one and is answered as it is. Chats from chat
apps and unattended runs never wait for this. Nobody would be there to press
the button. The internet coming back doesn't release them either.

**Routing judges the models that answer.** `carryTools` (ADR 0023, 0036)
compares the chat's model with the model the fallback would answer with, not
the fallback's first model:

- A turn the chat's own model could only chat in can go to any provider.
- Offline, the model on this computer answers with one of its models that can use apps when its own pick can't. That model is free and stays on this computer, so `TurnRoute.model` carries the choice.
- At a limit, your pick answers only with the model it would use anyway. Choosing a pricier one would be a spending choice you didn't make. When that model can't use apps, the limit card offers what's ready instead.

## Consequences

- The mock engine's **Chat Lite** (`tools: false`) gets no tools and says it can only chat, so the whole journey runs end to end (`e2e/chat-only.spec.ts`).
- A new provider declares `tools` per model. That's all it needs for the badge, the offer and routing.
- Nacre `ModelSwitchCard` is the offer. The picker's `ModelOption.chatOnly` is the badge.
- A skill that doesn't say what it needs isn't treated as needing tools. Its instructions may only be words to follow.
