# 0132 — Switching models when asked

- Status: accepted
- Date: 2026-10-11
- Amends: [ADR 0012](./0012-every-provider-at-once.md) (a chat's model changes from the chat
  too), [ADR 0060](./0060-the-chat-knows-conch.md) (Conch's own chips from a tool),
  [ADR 0021](./0021-connect-from-chat.md) (a provider offered for a model it serves)

## Context

A chat on Codex was asked to "use Opus 5.5", with a Claude plan connected. It couldn't. The
assistant knew nothing about the other providers or their models, and no tool changed the
chat's model. Only the picker and `/model` did, and `/model` matched a label by its letters.

People ask in words: a name and version ("Opus 5.5"), a family ("try this with GPT"), a
provider ("go back to Codex"), how it's paid ("use my Claude plan", "with my API key"), where
it runs ("a local model"), or relative to now ("cheaper", "stronger for this step").

## Decision

### One reading of the words, everywhere

`resolveSwitch` in `@conch/protocol` (`switching.ts`) reads the words against the connected
models (`switchCandidates`, from the model catalog). The assistant's tool, the web's `/model`
and the chat apps' `/model` all use it.

- **Names.** Every word must fit a model's name or id, its provider, or its family (Claude,
  GPT, Gemini, Grok, Llama, Qwen…). Versions stay whole: "opus5.5" and `claude-opus-5-5` are
  both Opus 5.5. Words nobody asked for count against a model, so "GPT-5.5" isn't GPT-5.5 mini.
- **Plan, key, this computer.** The catalog now says how each provider is paid for
  (`ProviderModels.billing`, `account`), from its sign-in.
- **Stronger, cheaper, faster.** A tier read from the model's name (`modelTier`). Rough on
  purpose: it only ranks what's connected.
- **Back.** The model before the last switch, or the picker's last other choice.
- **Which, when several fit.** The chat's own provider first, then a plan, then this
  computer, then a key. The same model on a plan and a key is the plan. Two plans that fit
  equally, two keys, or a version that isn't connected ("Opus 4.1"): up to three choices.
- **Nothing fits.** It says which provider would serve the family: on a plan unless a key was
  asked for (Claude → Claude Code, GPT → Codex, Gemini → Gemini CLI).

### The assistant knows, in a few lines

Each turn's system text ends with **Models you can switch to**: one line per provider, how
it's paid, each model with its tier, and which one is answering. At most 1,400 characters; a
provider with more than eight models says "ask by name". It's last among the sections, so
the ones before keep their places (ADR 0085). Only for providers that can call Conch's tools.

### `switch_model`

`switch_model({ to, carry_on })` (`switching/tools.ts`) takes the person's words as said, never
an id. `carry_on` is true when the message also asks for work ("try this with GPT").

| It finds…                                              | It does                                                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| One                                                    | Switches the chat (`ConversationManager.switchModel`): the chat's options, then a `model.switched` line.                          |
| The one answering                                      | Says so.                                                                                                                          |
| A few                                                  | Conch's own chips (`model.choices`, `replies` by `conch`). A tap switches at once, with no turn on the old model.                 |
| Nothing                                                | Offers to connect the provider that would (connect-from-chat). Connected, the chat moves to it (`Offer.switchTo`) and carries on. |
| Nothing stronger, cheaper or faster, or nothing before | Says so.                                                                                                                          |

**Carrying on.** Switched mid-turn with `carry_on`, the turn ends as it is, and the new model
answers next in the same run (`Live.carry`, `TurnResult.carry`). It gets the person's request
as they typed it (`requestOf`), never the old model's words, and is told the switch is done.
It's handed what it missed, as for any change of provider (ADR 0069). A tapped chip carries
the request that was waiting the same way.

**This chat only.** The default provider and model stay as they were. New chats start there.

**The line.** "Switched to Opus 5.5 on your Claude Max plan", or "… on Anthropic API, about
$0.03 a reply", or "… on this computer". **Switch back** on the latest, until you write again
(`POST /api/conversations/:id/switch`). The picker follows the chat's options live.

### What it never does

- **Spend on a guess.** "Stronger" picks among plans and this computer. A model paid per reply
  is used when the person named it, or taps it. ADR 0126's rule: choosing a key by name is a
  choice to pay.
- **Pass a limit.** A paid model past the chat's own limit or the month's budget isn't
  switched to (ADR 0079).
- **Raise the mode.** The chat keeps its permission mode, or the new provider's safest when it
  can't run that one. The line says so ("Ask first: Copilot can't do Auto").
- **Switch on a page's say-so.** In a chat that read something untrusted (ADR 0028), the one
  that fits is offered as a chip for the person to tap.
- **Run for nobody.** Routines, tasks, pinned apps, other apps and outside agents keep the
  model they were given: no tool. In a chat app there's nothing to tap, so the assistant asks
  which in words.
- **Hide a chat-only model.** One that can only chat (ADR 0050) is offered last while the
  chat's model can use apps. Named, it's switched to, and the assistant is told it can't use
  apps.

## Consequences

- A chat on any provider can move to any other connected one when asked, including a model on
  this computer and a server of your own.
- `ProviderModels` gains `billing` and `account`. Old clients ignore them.
- Two new events, `model.switched` and `model.choices`. An older Conch skips them; the
  `options` event beside each still moves the chat.
- The tier is a guess from names. A new family's flagship may read as "everyday" until its
  name is in `modelTier`.
- `/model` in the web tries an exact id first, then these words, then a label's letters. In a
  chat app the letters come first, as before, and the words when they find nothing.

## Verification

- `packages/protocol/src/switching.test.ts`: names, versions, families, plan and key, this
  computer, stronger, cheaper, faster, back, already, near, ambiguous, pays, nothing and who
  would serve it; every chip's words mean its model; the line and the list.
- `apps/server/src/switching/switching.test.ts`: on Codex, "use Opus 5.5" switches to the
  Claude plan with a line, and the next message goes there; carrying on in the same run; a
  tapped chip switches and carries on with no turn on the old model; nothing fits offers the
  provider; an untrusted chat waits for a tap; switching back; no tool for routines; words in
  a chat app.
- `apps/web/src/features/chat/Switched.test.tsx` (the line, Switch back, chips) and Nacre
  `Offline.test.tsx` (`RoutedNote` `switched`).
- Eval `switch-asked` (`evals/tasks.ts`): on real models, asked by name, the chat moves to the
  partner model.
