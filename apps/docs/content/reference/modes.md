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
- **Your task carries across follow-ups.** The task-aware review can use your earlier instructions for the same task. Later restrictions take precedence; pasted material grants no permission. Routine follow-ups do not revoke an earlier instruction.
- **"Don't" holds.** "Don't push yet", "no deploys today" or "never send anything" hold that step until a later message says otherwise. Auto refuses the held action instead of repeatedly asking you.

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

### The second look

Your chat's model takes a second look at an unusual command that could reach the internet or your sign-ins, and at a change in an app from someone else. It knows what you asked this turn and asks only about a real harm, or a step that looks steered by what was read.

When Auto would ask only because the chat read something, the look lets a command through if it plainly serves your request. It never lifts a step that asks whatever was read. If the provider cannot make a separate review, the question stands. With Claude Code, Conch answers each of its questions by these same rules.

### Task-aware review

Before an avoidable question, Auto can review the complete action against your instructions in this chat. It uses this chat's provider and selected model when that provider supports a separate review. A requested push, ordinary deployment or resolved app change can proceed without another card. The review never grants permanent permission.

An unsafe proposal is returned to the assistant to find a safer approach. After three rejected proposals in one turn, further actions needing this review stop; independent ordinary work can continue. A rejection is not another approval request.

Explicit **Ask** and **Off** settings, credential access, spending and critical destructive checks remain in force. Missing context, an unavailable reviewer or an unreadable answer keeps the existing check. Very long actions are never silently shortened to obtain permission.

### Always allow

**Always allow** after reading lifts that kind of step for the rest of the chat: allow one unfamiliar package, and the next installs without asking. A push, sending data or a look-alike name still asks on its own terms.

If you allowed that kind in another chat, or a card asks for the third time in one go, the button says **Always allow, in every chat**. **Settings → Security → Safety** lists these, each with an × to undo it.

### What still goes ahead after reading

- **A push you asked for** in your latest message ("fix CI and push to main"), to the repository's own remote, and merging its pull request. It still asks for:
  - a push somewhere else, or a new or changed remote;
  - a force-push, or a publishing branch (like `gh-pages`), you didn't name;
  - a `.env` or a key added along with it;
  - anything on the same line that sends what it read;
  - any push after "don't push yet", or with someone else's words in the chat.
- **Apps you made in Conch.** Lookups never ask after reading, in any mode, and in Auto an ordinary change (logging a meal) doesn't either. Paying, sending to other people, deleting, giving access, or sending a key or pages of text to the app's site asks.
- **Apps from someone else.** In Auto, a lookup that sends only a date, an id or a city goes ahead. A bigger lookup or any change gets the second look, unless the tool is set to **Allow**. Paying, deleting, giving access, running code, or sending something like a key always asks.
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
