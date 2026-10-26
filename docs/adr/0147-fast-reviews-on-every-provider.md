# 0147 — Fast reviews on every provider

Date: 2026-10-26

## Context

Auto reviews a step with a model before it asks the person (ADR 0128, ADR 0144). A review that doesn't answer in time leaves the question for the person, so a slow review is a question. Three things made reviews slow or missing:

- Reviews ran on the turn's own model, often the largest one the provider has.
- Each review started the provider's program afresh: a Claude Code process, or a Codex app server.
- Copilot, Gemini CLI and Grok had no way to answer one prompt, so every eligible question from them reached the person.

Nothing measured how long reviews took or how often they ran out of time.

## Decision

**A declared fast reviewer.** `Engine.reviewModel()` names the provider's own fast model, in that engine's own code. It returns only a model the account lists, or nothing. `services.fastReview` hands it to the review flow as a `LookModel` on the same engine. It never crosses to another provider (ADR 0144): the answer comes from that engine's `complete` and nothing else. A fast model that fails (an account without it, a cloud region without it, a managed setting that denies it) is left alone for ten minutes, and the turn's model reviews instead. Stop and timeouts don't count as failures.

This is not choosing by cheap-sounding names (ADR 0144). Each declaration is the provider's own tier, written in its own row:

| Provider                                                     | Fast reviewer                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                                                  | `haiku`, the alias Claude Code takes on every sign-in, Bedrock and Vertex included (or `ANTHROPIC_DEFAULT_HAIKU_MODEL`)                                 |
| Codex, Codex CLI                                             | `gpt-6-luna`, then `gpt-5.6-luna`, by name, as Codex 0.164's own catalog describes them ("Fast and affordable model for easier tasks"), with low effort |
| Anthropic API, Bedrock, Vertex                               | the newest Haiku the provider lists                                                                                                                     |
| OpenAI                                                       | GPT Luna or mini, from GPT-5 on                                                                                                                         |
| Google Gemini                                                | Flash, never Flash-Lite                                                                                                                                 |
| xAI                                                          | Grok's fast models without reasoning                                                                                                                    |
| DeepSeek                                                     | Flash                                                                                                                                                   |
| Mistral                                                      | Mistral Small, never Ministral or Tiny                                                                                                                  |
| Groq, Cerebras                                               | none: every model there is fast already                                                                                                                 |
| OpenRouter                                                   | none: a fast model there may be another company's, and the person chose this one                                                                        |
| Azure OpenAI                                                 | none: a deployment's name is the person's, not a tier                                                                                                   |
| Z.ai, Kimi, MiniMax, Qwen, Ollama Cloud, servers of your own | none: no fast tier we could verify can judge an action                                                                                                  |
| Ollama, LM Studio                                            | none: the turn's model is already on this computer                                                                                                      |
| Copilot, Gemini CLI, Grok                                    | none: their model lists over ACP declare no tier, so the turn's model reviews                                                                           |

Codex's catalog also has a hidden `codex-auto-review` model. Conch doesn't use it: it isn't listed to accounts, and it was made for Codex's own review prompt, not Conch's.

A fast model judges less well than a large one. That's acceptable here because of what a review can do. It can only lift an eligible question, with owner evidence, for low or moderate risk (ADR 0144). The hard rules stay deterministic and outside any model: keys, money, the circuit breaker, an assistant's own permission files, `NEVER` wishes, protected paths, tools turned Off, explicit Ask, and guests. A review that is unsure, unreadable or late keeps the question.

**Faster reviews per call.**

- _Claude Code._ Starting Claude Code and its initialize handshake took 1.2–1.6 s on a developer Mac (no model request, measured with the installed Agent SDK 0.3.303). That is longer than Haiku takes to answer a review. The SDK's supported `startup()` starts the process for fixed options and waits for one prompt. A review (`CompletionInput.warm`) takes a process started ahead for exactly its options (program, folder, environment, system prompt, model), and starts the next. Each process answers once, so two reviews never share a session or a transcript (`persistSession: false`, `maxTurns: 1`, no tools, no MCP, thinking off, `--bare` where the sign-in allows it). One nobody takes is let go after a minute, at most two wait, and a new sign-in lets them all go. The next spare starts beside a spare that answers, or after a cold answer succeeds, so two starts never compete for one review. A spare that died while it waited is replaced by a fresh start for that review. The spare's key is a digest of its options, so it holds no secret. `prewarm()` (also in the SDK) is marked alpha and its claims can be refused for project settings, so it isn't used. The subscription path still tries the lighter way first and the usual way after a failure. Remembering a failed lighter way was tried and dropped: one blip would cost the usual way's much larger context for every small job for a while.
- _Codex._ `withClient` starts an app server per call, in a run folder with a copy of the sign-in. Starting it and its handshake took 110–330 ms here. Keeping one running for reviews would save that little, and would keep a plaintext copy of the sign-in on disk for longer. Each review stays a thread and an app server of its own. The time saved is the model: Luna at low effort instead of the turn's model.
- _ACP programs._ The program is kept warm already (five minutes idle).

**Reviews for Copilot, Gemini CLI and Grok.** `AcpEngine.complete` answers one prompt:

- A new session each time, so two answers never share history. It runs on a program kept for answers, apart from the turn's, because a review comes while the turn's own prompt is still running and a program could serve them one at a time.
- An empty temporary folder as its work folder, so the program reads no project files or instructions. No tool server.
- Every permission request is declined. Any tool the program starts by itself (`tool_call`) cancels the session and fails the answer. These are coding agents with tools of their own, and one that reads or searches without asking could send what it's reviewing somewhere.
- A deadline of its own (60 s) on top of the caller's. Stop and the deadline cancel the session.
- The session is closed and the folder removed, whatever happened.
- Grok takes the reviewer's instructions as session rules. Copilot and Gemini CLI take no system prompt over ACP without a tool server, so the instructions lead the message, framed as Conch's. The reviewer's random fence and datamarking still mark the data. This separates instructions from data less well than a system prompt.
- In Auto, the answering program starts with the turn, so the first review doesn't wait for a program to start. It costs one more program per provider (per model for Copilot) while it's warm.

`complete` is general: titles, story headlines and the other small jobs (ADR 0103) can now use these providers too, on the model `cheapestModel` finds in their own list. On Copilot each answer is a request on the person's plan, counted the way Copilot counts requests for that model. Before, those jobs went to another provider or none.

**Measuring.** `completeReview` takes `onSettled({ ms, outcome })`, called exactly once: `answered`, `timeout` (the deadline passed first), `error` (the call failed, or Stop came while it ran) or `unavailable` (no model, or Stop before asking). `ConversationDeps.reviewed(stage, outcome, ms)` sends it to `TelemetryService.review`, which counts `conch.auto.reviews` and records `conch.auto.review.duration`, by stage and outcome. Stage names come from Conch's code; an unknown outcome is `_OTHER`. Numbers only: no prompts, no models' words.

The deadlines keep their meaning and their defaults (6 s for the second look, 8 s for the task review). With a fast model and a process started ahead, a review that used to start a program and run the largest model now usually needs only the fast model's answer.

## Consequences

- Fewer of Auto's questions reach the person because a review was slow, and ACP providers get reviews at all.
- Auto never asks more because of this: a fast reviewer that fails falls back to the turn's model, and any review that can't answer keeps the existing check.
- More memory while warm: up to two parked Claude Code processes for a minute, and one more ACP program per provider for five minutes.
- Short answers on Copilot, Gemini CLI and Grok count toward those plans.
- `CODEX_REVIEW_MODELS` and the preset patterns need a look when providers rename their tiers. A tier that isn't listed is never used, so a stale entry costs speed, never safety.
