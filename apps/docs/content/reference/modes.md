---
title: Permission modes
description: How much your assistant may do without asking. Pick one per chat, and a default for new ones.
order: 4
---

New chats start in **Auto**. Change the mode from the composer or with `/mode`, and press **Make this my default** to start every new chat in it. Each mode means the same with every provider. Where a provider can't do it, Conch does.

<!-- conch:modes -->

## Auto

**Auto** gets on with edits, commands, installs, pushes and your apps. It stops and says why before it would:

- run code downloaded from the internet, or install straight from an address;
- install a look-alike package (`reqeusts` for `requests`);
- read your keys or saved sign-ins, or send something to an address made for catching data;
- delete files outside the work folder, or force-push over a shared branch;
- run something as administrator, turn off a safety check, or change system files;
- change or tear down production infrastructure, wipe a database, or publish a package;
- delete something in one of your apps;
- stop programs your computer runs on, or restart it;
- delete a repository's history, or a container's data.

Unless you asked for it, it also asks before deploying an app, applying to a cluster or cloud account (staging too), pushing an image to a registry, or changing where `git push` goes.

These questions offer no **Always allow**.

Some app tools can both read and change data, such as a cloud API executor. If Conch only knows the tool can make destructive changes, its card describes that capability. It does not mean this particular call deletes anything. The approval check still applies.

Everyday work never asks, outside the sealed box too:

- checking, pulling and fetching with git;
- installing what the project lists (`package.json`, `pyproject.toml`, requirements, `Cargo.toml`, `go.mod`, `Gemfile`);
- installing a well-known package (`fonttools`, `requests`, `zod`, `jq`) with pip, uv, npm, pnpm, brew or cargo, into a virtual environment, your user folder or the project;
- running Python, building, testing, rendering a PDF, tidying the work folder;
- `git reset --hard` or `git clean` when there are no uncommitted changes to lose.

Spending money asks (a paid picture). Your own plan, at no extra charge, doesn't.

## What you ask for goes ahead

Name a risky step, and it goes ahead without a card, even after the chat has read something: "force-push my branch feature/login", "ship it to production", "delete the old branch feature/old", "install nginx with sudo", "send it to the team".

- **The name matters.** "Push it" doesn't force-push, and "apply the terraform" doesn't apply to production.
- **Your task carries across follow-ups.** [The review](#the-review) can use your earlier instructions for the same task. Later restrictions take precedence; pasted material grants no permission. Routine follow-ups do not revoke an earlier instruction.
- **"Don't" holds.** "Don't push yet", "no deploys today" or "never send anything" hold that step until a later message says otherwise. If the assistant tries it anyway, the card says you asked it not to, and asks whether to do it now. Your **Allow** is for this once; no review lifts it.

These ask whatever you say:

- reading or sending your keys or your `.env`;
- running code decoded from a blob;
- sending a key or a token to an app;
- paying;
- changing who may sign in to this computer, or an assistant's own permission files;
- a look-alike package name;
- a push anywhere but the repository's own remote;
- deleting a whole folder.

## After reading something from outside

Once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted), everyday work still goes ahead: asked for a PDF, it installs `fonttools`, sets up pip and runs Python. Auto asks only before a step that is harmful in itself, or that a page could have steered:

- a push you didn't ask for;
- a package Conch doesn't know well, or one from another registry;
- sending data, or what a command printed;
- words to other people;
- giving someone access.

Issues, pull requests and CI logs read with `gh` count, because anyone can write in them. These don't:

- a command's own output, like a build or a test run;
- a language's own tools from where they're published (`get-pip.py` from bootstrap.pypa.io, Python and Node from python.org and nodejs.org);
- Conch's own lists of models and the pictures it makes.

### The review

Before Auto would ask, your chat's provider reviews the step once: a command, or a change in an app from someone else. It reads your messages in this chat, what the chat read, and the note about your setup you may have written in **Settings → Security → Safety** (which hosts and remotes are yours, what production means), and answers for that step alone. The note helps it understand; it never says yes by itself. One step gets one review, even when the provider asks about it twice.

- **It knows what you asked.** It lets a step through when it plainly serves your request and your messages back it. A page can tell it which package or flag; it can't give permission.
- **It can only add a question where the rules found nothing.** For an unusual command that could reach the internet or your sign-ins, or a change in someone else's app, it asks about a real harm, or a step that looks steered by what was read. The card says why in Conch's words.
- **It lifts only what it may.** It never lifts a step that asks whatever was read, or one you said not to do.
- **A fast first look.** When your provider has a quicker model for this, it looks first and lets clearly routine, requested work through. Anything else goes to your chat's model.
- **It's reused only while nothing changed.** The same step again in the same reply isn't reviewed twice. A changed command, script, message or mode is a new review.

A requested push, an ordinary deployment or a resolved app change can go ahead without another card. The review never grants permanent permission. If the provider can't make a separate review, the question stands. With Claude Code, Conch answers each of its questions by these same rules. It uses this chat's provider, never another: its own fast model where it has one (Haiku on Claude Code, Luna on Codex), else the chat's selected model. Every provider can review, Copilot, Gemini CLI and Grok included ([ADR 0147](../../../../docs/adr/0147-fast-reviews-on-every-provider.md)).

An unsafe proposal is returned to the assistant to find a safer approach. After three rejected proposals in one turn, further actions needing this review stop; independent ordinary work can continue. A rejection is not another approval request.

Explicit **Ask** and **Off** settings, credential access, spending and critical destructive checks remain in force. Missing context, an unavailable reviewer or an unreadable answer keeps the existing check. Very long actions are never silently shortened to obtain permission.

A [task](../features/tasks.md) is reviewed against what you'd said in the chat it came from, as you'd said it when you handed it off. Its own instructions, written by the assistant, count for nothing. A routine, or a chat with someone else's messages in it, hands nothing on.

### Tell Auto about where you work

**What Auto should know about where you work**, in **Settings → Security → Safety**, is a note in your own words: the hosts you trust, your remotes and buckets, what production means here. The review reads it as yours, so "staging.acme.dev is ours" lets a deploy there go ahead. Only you can change it. No assistant can write it, and a backup that carries one says so before you restore it.

### Always allow

**Always allow** after reading lifts that kind of step for the rest of the chat: allow one unfamiliar package, and the next installs without asking. A push, sending data or a look-alike name still asks on its own terms.

If you allowed that kind in another chat, or a card asks for the third time in one go, the button says **Always allow, in every chat**. **Settings → Security → Safety** lists these, each with an × to undo it.

### Always allow one command

A card about a command can also offer just that command. Press it, and Auto runs exactly that command without asking again, in any chat, in that work folder. A pushed branch is offered by its kind, so **Always allow `git push origin feature/*`** covers `feature/login` and `feature/checkout`.

- It's offered only where Auto asks because the chat read something. A step serious enough to ask before reading too (a force-push over `main`, a deploy, a new remote) asks each time, with no “always”: say it in your message instead.

- It covers the whole command. `git push origin feature/login main` or a `--force` added still asks.
- It's never offered for a shell or an interpreter (`bash`, `python`, `node`), a project's own scripts (`npm run`, `pnpm`, `make`), `sudo`, `rm`, `curl`, `ssh`, or a program on its own (`git`).
- It's never offered for a line with `&&`, `|`, `>`, `$(…)` or a variable in it.
- It never lifts a step that asks whatever you say, a step you said not to do, or anything with someone else's messages in the chat.
- Only your press keeps one. **Settings → Security → Safety** lists them under **Auto never asks again before it runs**, each with an × to forget it.

### What still goes ahead after reading

- **A push you asked for** in your latest message ("fix CI and push to main"), to the repository's own remote, and merging its pull request. It still asks for:
  - a push somewhere else, or a new or changed remote;
  - a force-push, or a publishing branch (like `gh-pages`), you didn't name;
  - a `.env` or a key added along with it;
  - anything on the same line that sends what it read;
  - any push after "don't push yet", or with someone else's words in the chat.
- **Apps you made in Conch.** Lookups never ask after reading, in any mode, and in Auto an ordinary change (logging a meal) doesn't either. Paying, sending to other people, deleting, giving access, or sending a key or pages of text to the app's site asks.
- **Apps from someone else.** In Auto, a lookup that sends only a date, an id or a city goes ahead. A bigger lookup or any change gets [the review](#the-review), unless the tool is set to **Allow**. Paying, deleting, giving access, running code, or sending something like a key always asks.
- **Lookups asked at once** for the same reason get one question.
- **Reading and shopping** in [the browser](../features/browser.md): searching, reading pages, filtering a shop, filling a basket. These ask, in German, French, Spanish, Portuguese, Italian and Dutch shops too:
  - buying or deleting on a site;
  - sending when the complete page cannot establish the requested recipient and content;
  - an address that looks like it carries data;
  - a long text typed into a page;
  - an upload or a download.

## What a chat does, watched

Conch counts what each chat does in your apps and asks at:

- one message to 20 people or more, every 20th message in one go, or every 100th in a day;
- after reading something from outside, a message to an address nobody gave in the chat;
- every 10th thing deleted in one go, or 25 deleted at once;
- a payment of 1,000 or more, or every fifth in a day;
- the very same change made again and again.

One message to 500 people or more, or a chat's 500th message in a day, stops in every mode, with a suggestion to use a mailing service. Full trust skips action approvals, including the counts above. Hard limits still stop a step instead of asking.

**Always allow** holds for that tool for the rest of the chat, even after a restart. To never be asked, set the tool to **Allow** in **Apps**.

## Full trust

**Full trust** acts without approval, including commands, app changes, sending, spending and deleting. Reading a page or loading a skill never downgrades it. Switching to Full trust also releases a waiting action approval.

Choose it only when you accept those consequences. A page or file could mislead the assistant, and a command can destroy data.

Signing in, unlocking Passwords and approving access to a saved credential still need you. Tools turned **Off**, protected Conch files and hard service limits remain unavailable; Full trust does not turn them on. The assistant cannot grant itself permissions.

## In every mode

- In **Ask first** and **Read only**, anything that sends, spends or deletes asks once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted). **Always allow** lets it through for the rest of the chat.
- A command that wants out of the sealed box (to push, install from a private registry or reach another host) asks, with **Always allow**. Full trust never asks this. In Auto:
  - before the chat has read something from outside, it goes ahead;
  - after that, with you in the chat and only pages or files read, it asks only for what Auto would stop anyway;
  - after that, with someone else's words in the chat or nobody there (a routine, a chat app), it asks.
- Paying or deleting in [the browser](../features/browser.md) asks unless you chose Full trust.
- A [task](../features/tasks.md) never has more than its chat.

A question nobody answers is a no. After 30 minutes (an hour for a routine), the step doesn't happen and its line says **No answer in 30 minutes, so it didn't**. Say "go ahead" to be asked again, or [answer from your phone](../start/phone.md#answer-from-the-notification).
