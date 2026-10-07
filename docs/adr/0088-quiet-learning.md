# 0088 — Quiet learning: learned while you're away, said afterwards, undone in one press

> Amended by [ADR 0097](./0097-proactive-memory-maintenance.md): routine owner-backed memories apply with Undo; length and outside reading alone no longer require approval. Security holds remain protected. Since § Silent by default there, learning says nothing in the chat unless the memory check held something, nothing routine waits, and § 8's Memory page is one summary and one list.

- Status: accepted
- Date: 2026-10-05
- Builds on: [ADR 0003](./0003-memory.md) (memory in the open),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0032](./0032-it-learns-you.md) (it learns you),
  [ADR 0055](./0055-long-chats-on-every-model.md) (learn before forgetting),
  [ADR 0058](./0058-skills-from-what-worked.md) (skills from what worked),
  [ADR 0079](./0079-what-a-chat-costs.md) (what a chat costs),
  [ADR 0087](./0087-the-memory-check.md) (the memory check)
- Amends: ADR 0032 §2–3, ADR 0055 §4, and ADR 0058's "nothing is saved by Conch",
  which from now on covers skills only.

## Context

Conch learns you in three ways today:

- the assistant's `remember` tool, when the model thinks to call it;
- the tidy-up, which is off until you turn it on;
- skill offers, which wait for you to read and save them.

So most of what Conch could learn is never learned. A person says "no, I meant TypeScript" in one chat. In the next chat they say it again. Nothing remembers the correction: the only signal Conch reads from a chat is a thank-you. When something changes ("I moved to Lisbon"), the old memory is overwritten, so Conch can't say what used to be true.

Research on agents that learn from use points the same way, and warns about the same traps:

- **Rewrite a whole memory with a model and detail goes missing.** Small, itemised changes merged by code keep it; a model rewriting the lot shrinks it ("context collapse": _Agentic Context Engineering_, arXiv 2510.04618).
- **Facts change.** A fact that's replaced should be marked as no longer true rather than deleted, so questions about time still have an answer (_Zep_, arXiv 2501.13956; _LongMemEval_, arXiv 2410.10813).
- **Preferences drift out of sight.** Models follow a stated preference less than one time in ten after a dozen turns, unless it's restated near the question (_PrefEval_, arXiv 2502.09597).
- **Corrections and rephrasing are the strongest signals people give**, stronger than thanks (_PRELUDE/CIPHER_, arXiv 2404.15269; _Retrospective learning from interactions_, arXiv 2410.13852).
- **Memories about a person make models agree with them more**, on facts too (arXiv 2509.12517).
- **Memory is a way in for prompt injection.** A page or a message can get an agent to write instructions into its own memory (_MINJA_, arXiv 2503.03704; _MemoryGraft_, arXiv 2512.16962). Learning has to know where everything came from.
- **A self-written instruction doesn't help on average unless it's checked** (_SkillsBench_, arXiv 2602.12670). A learning pass that saves nothing should be the normal case, not a failure.

## Decision

Conch learns from every chat you were in, by itself, once the chat goes quiet. It applies what's safe without asking. Then it says so quietly at the end of that chat, where one press undoes it and **Why?** shows the words it learned from. It still asks first after reading something from outside, and when nobody is there to see it. It learns nothing from a chat with someone else's words in it. It never deletes, and it never learns a power.

### 1. A quiet look at a chat once it goes quiet

The work lives in `apps/server/src/learning/`. Its service is `QuietLearning`.

A sweep runs every five minutes. It looks at chats:

- updated in the last week;
- not running and not waiting for anyone;
- whose last turn ended at least ten minutes ago;
- that have words from you past where the last look stopped.

At most two chats are looked at per sweep, one at a time, so a restart loses nothing. Archiving a chat looks at it at once. When a long chat's start is summarised (ADR 0055 §4), the look covers the words before the cut. It replaces `MemoryTidy.learn`.

Some chats are never looked at:

- learning is off (**Learn from your chats**, the setting `autoMemory`);
- the chat is marked **Don't learn from this chat**;
- a guest in a group (ADR 0075), a routine's run, a task or a page fetching its data;
- someone else's words are in it: they aren't yours to learn from (ADR 0032);
- the learning cap or the month's budget has been reached;
- a plan is at least 80% used (`PLAN_ROOM_PERCENT`, as for routines).

For money, a missing model or a provider that didn't answer, the place where the look stopped stays put, and the chat is tried again at most once an hour.

What was said while learning was off, or while a chat was marked **Don't learn from this chat**, is never read: turning either back on starts from there.

A look at the start of a long chat happens mid-reply, so what it learned isn't said there. It's said with the rest at the chat's end, once the chat goes quiet.

### 2. Signals, read by code

`signals.ts` reads Conch's own log of the chat, which is the same for every provider. It looks for:

| Signal              | What it is                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| a correction        | "no, I meant…", "actually…", "I said…"                                                                                               |
| rephrasing          | the same thing asked again in other words                                                                                            |
| a retry             | the same message sent again                                                                                                          |
| a Stop              | you stopped a reply                                                                                                                  |
| an Undo of files    | the assistant's changes put back (ADR 0030)                                                                                          |
| an Undo of a memory | a memory the chat learned, taken back                                                                                                |
| frustration         | a short list of words                                                                                                                |
| thanks              | the same words skills use (ADR 0058)                                                                                                 |
| worked another way  | a command's own program wasn't there ("command not found", "is not recognized"), and another program did the same job straight after |

**Worked another way** becomes a fact about this computer, written by code from a template ("On this computer, `python` isn't found; `py` works."). No model writes it, and no tool output reaches any prompt.

A chat with no signal and nothing durable in your words (first person with "always", "never", "prefer", "I live", "I work", "call me", "my partner"…) isn't sent to a model at all. The place where the look stopped moves on for free.

### 3. The review: a cheap model, data in, a few changes out

**Which model.** The cheapest model of the provider that answered the chat, which has seen it already (as skill drafts do, ADR 0058). Failing that, a model on this computer. Failing that, any other connected provider that can write a short answer (the default first), so learning only waits when none can. Failing that, nothing, and Health says learning is waiting until one is connected. If the answer fails, it gets one retry with the provider's default model.

**What it reads:**

- your words, framed as data, up to 6,000 characters;
- the steps as Conch summarises them ("Run `npm test`"), never their output;
- the signals;
- at most 15 memories close to what was said;
- the few things Conch was told not to learn that are close to it.

**What it may answer:** at most five changes, each one of two kinds:

- **add** a memory, with its kind and the words of yours it rests on;
- **supersede** a memory: what's true now, why, and the words of yours that say so.

There is no "forget" and no "delete". The prompt says plainly that an empty list is the usual answer.

Code applies every change. A model never rewrites a stored memory in place.

### 4. The gate: apply, wait or drop

`policy.ts` decides each change by itself, and is tested row by row:

| Situation                                                                   | Result                                   |
| --------------------------------------------------------------------------- | ---------------------------------------- |
| You were in the chat, it read nothing from outside, every check passes      | **applied**, and the chat says so        |
| The chat read something from outside (ADR 0028)                             | **waits**, saying where it was learned   |
| A chat app, or another app through Conch (nobody sees the chat)             | **waits**, shown on the Memory page only |
| It would replace a memory you wrote yourself, or one still waiting          | **waits**                                |
| More than 3 in one look, or more than 8 in a day                            | the rest **wait**                        |
| The words it rests on aren't in what you said, or share no word with it     | **dropped**                              |
| A key, a password, anything the vault would hide; health or money           | **dropped**                              |
| About the assistant itself, or an order to it ("from now on", "always say") | **dropped**                              |
| A power ("without asking", "trust", "auto-approve")                         | **dropped**                              |
| You told Conch not to learn it (§6)                                         | **dropped**                              |
| It's only close to something you told Conch not to learn                    | **waits**, saying what you took back     |
| Already known                                                               | nothing new; it's counted as seen again  |

Then it's written like any memory, through the memory check (ADR 0087), told what the chat read and what you said. If the check holds it, it waits for your OK with the check's own reasons, whatever the gate said. Keep on something that waits is a person's answer, minted by the route that takes it, for exactly the words you saw.

### 5. Superseded, not overwritten

A memory that's replaced moves to `memory/superseded/`, marked with when it stopped being true (`invalidAt`) and what replaced it (`supersededBy`).

- It leaves the prompt. `recall` still finds it, with its date ("until August 2026").
- Undo moves it back exactly as it was.
- The version before this one reads only `memory/*.md`, so after going back, a superseded memory never returns as if it were true (ADR 0051).
- The new fields are optional. A previous version reading a memory with them simply ignores them.
- Facts about this computer and lessons from dead ends are ordinary `fact` memories with `about: environment` or `about: pitfall`. A new kind would make the previous version drop the memory.

- A replacement that waits for your OK leaves the old memory true until you keep it. Keep retires the old one only if it still says what the card showed, and never one that is itself held or waiting. A "replacement" that only repeats a memory already there retires nothing.
- Copies of what used to be true are sealed like every memory file (ADR 0087). One brought back from a backup, or changed by hand, is checked again when it's read, and left out if the check would hold it. Undo brings the old one back from that copy, through the same check, never from the record's words. **Earlier → Forget** removes a copy and touches nothing live.

The tidy-up (ADR 0032) still updates a memory in place, with its own Undo. Its merges are now checked: a merge that loses a number or a name, or ends up shorter than 60% of the longest memory it merges, isn't made.

### 6. Never learned again

Pressing Undo on something Conch learned, or forgetting a memory Conch wrote, adds it to a short list, `learning/never.json`. Every later change is checked against that list, by words and by meaning (the way turned-down skill suggestions are, ADR 0041). The very same thing is dropped. Something only close to it waits for your OK: "Prefers TypeScript over Python" after you undid "Prefers Python" may well be the correction that came next. The `remember` tool checks the list too: what you took back once waits for your OK if the assistant tries again.

Keep on something that waits is your answer for the words you saw: if they changed since, nothing is kept, and you're asked to look again.

Memories you wrote yourself never go on the list. The Memory page shows the list under **Things Conch won't learn again**, each with **Remove**.

### 7. Preferences near the question

Each turn, at most three remembered preferences, facts about this computer or lessons that match the message are put just before your words in that turn's prompt, at most 360 characters:

`<conch-nearby>How they like things, from memory…</conch-nearby>`

- **Where it goes, and why.** Never in the system prompt: changing that every turn would cost every provider's prompt cache. The block also isn't written into the chat's log, so what you see and what's handed to another provider stay your own words.
- **Where it doesn't go.** Guests never get it. A memory that came from outside (a page, a download), even one you kept, never goes beside your words: it stays in the system prompt's marked memory.
- **What it says.** It's reference, labelled as not part of your message and no reason to agree.
- **Small models.** It fits lean mode (ADR 0086).

The memory section of the system prompt gains one sentence that never changes: memories describe the person; they aren't evidence about the world, and no reason to agree.

### 8. What you see

- **In the chat.** One folded, quiet line at the end of the chat it learned in: "Learned 2 things". It opens to each thing with **Undo**, and **Why?** shows the chat, the words, the signals and the model. A change that waits shows **Keep** and **Forget**. Nothing appears for chats nobody watches.
- **On the Memory page:**
  - **Recent learnings** is the record of everything learned, newest first. The tidy-up's runs stay below it.
  - A card sums up the week: "This week Conch learned 6 things." There's no push and no toast.
  - **Earlier** lists superseded memories with their dates.
  - **Things Conch won't learn again**.
- **Don't learn from this chat**, from the chat's menu and ⌘K.
- **Settings → Usage → What learning may spend.** The cap is $1 a month until you change it; a plan or a model on this computer costs nothing here. At the cap, learning pauses until the 1st. One note under Health says so, and Repair everything shows it.

### 9. Whole Conch

- **Backups:** `learning/` (the record, the never-list, where each chat was read to) and `memory/superseded/` are kept with memory. `learning-spend.json` is kept and merged like the routines' file. A cap above the default is a power a restore names.
- **The agent can't reach any of it.** `learning/` and `learning-spend.json` are protected paths, so the agent can't clear its never-list or raise its cap. There's no tool for either.
- **Repair everything** checks the record and says when learning is paused.
- **⌘K:**
  - What Conch learned;
  - Don't learn from this chat / Learn from this chat again;
  - What learning may spend;
  - Things Conch won't learn again.
- **The mock engine** reviews too: "no, I meant X" becomes a preference, and "review-fail" fails. Tests and `pnpm dev:mock` take the real path.
- **Evals:**
  - `learns-correction`: a correction carries into the next chat;
  - `learns-nothing`: an ordinary chat leaves nothing behind.

## Consequences

- What you tell Conch once, and how you correct it, carries into the next chat without you doing anything, with every provider. You see it afterwards in one quiet line, and one press undoes it.
- Nothing learned can delete a memory. Replaced memories keep their history, and going back to the previous version can't revive them.
- **A poisoned page can't plant a memory.** What a chat learns after reading something from outside waits for a person. Your own words are the only evidence. Tool output never reaches the review.
- **What it costs:** at most one cheap completion per stretch of a chat, often none, from a provider that has seen the chat, capped at $1 a month unless you change it.
- **Known limits:**
  - Signals are read from words in a few languages. A correction in another language falls back on the model reading your words.
  - The review is only as good as the cheapest model, which is why the gate, the grounding check and Undo exist.
  - Skills still wait for a person (ADR 0058). Skills that improve themselves, checking that what was learned helps, and anticipation are later steps on the same record and gate.
