---
title: Permission modes
description: How much your assistant may do without asking. Pick one per chat, and a default for new ones.
order: 4
---

New chats start in **Auto**. Change it from the composer, or with `/mode`; to start every new chat there, press **Make this my default** in the same panel. Every provider offers every mode, and each one means the same with all of them: where a provider has no way of its own, Conch does it.

<!-- conch:modes -->

## Auto

**Auto** gets on with the work and stops only for something serious. It goes ahead with edits, commands, installs, pushes and your apps. It stops to ask, saying why, before it would:

- run code downloaded from the internet, or install straight from an address;
- install a package whose name is one letter off a well-known one (`reqeusts` for `requests`), a classic trap;
- read your keys or saved sign-ins, or send something to an address made for catching data;
- delete files outside the work folder, or force-push over a branch others share;
- run something as administrator, or turn off a safety check of your computer;
- tear down or change production infrastructure, wipe a database, publish a package;
- delete something in one of your apps;
- stop programs your computer runs on, restart it, or change its own system files;
- delete a repository's history, or the data a container kept.

It also asks before it would change someone else's systems, unless you asked for it: deploy an app or apply to a cluster or cloud account (staging too), push an image to a registry, or add or change where `git push` goes.

These questions offer no **Always allow**. Everyday work never asks, outside the sealed box too: checking, pulling and fetching with git, installing what the project lists in its own `package.json`, `pyproject.toml`, requirements, `Cargo.toml`, `go.mod` or `Gemfile`, or a well-known package (`fonttools`, `requests`, `zod`, `jq`) with pip, uv, npm, pnpm, brew or cargo, into a virtual environment, your user folder or the project, running Python, building, testing, rendering a PDF, tidying the work folder. Throwing away uncommitted changes (`git reset --hard`, `git clean`) never asks when there are none to lose. Spending money asks (a paid picture); your own plan, at no extra charge, doesn't.

## What you ask for goes ahead

Auto reads your own words. Ask for a step and name the thing that makes it risky, and it goes ahead without a card, before and after the chat has read something: "force-push my branch feature/login", "deploy it with fly", "ship it to production", "delete the old branch feature/old", "install left-pad", "post it to api.example.com", "install nginx with sudo", "send it to the team". The name matters: "push it" doesn't force-push, "apply the terraform" doesn't apply to production, and "push to the gh-pages branch" names the branch. Your latest message is what counts; "push it" two messages ago covers nothing now.

Say not to, and it holds: "fix it but don't push yet", "no deploys today", "never send anything" make that step ask, before reading too, until a later message says otherwise.

A few things ask whatever you say, because no words should be able to lift them, least of all words on a page: reading or sending your keys or your `.env`, running code decoded from a blob, sending a key or a token to an app, paying, changing who may sign in to this computer, changing an assistant's own permission files, a package name one letter off a well-known one, a push anywhere but the repository's own remote, and deleting a whole folder.

Once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted), Auto still gets on with everyday work. Reading something isn't a reason to ask about everything after it: Auto asks only before a step that is a real harm in itself, or that a page could have steered toward one. That means a push you didn't ask for, a package Conch doesn't know well or one from another registry, sending data or what a command printed, words to other people, and giving someone access. Asked to make a PDF, it installs `fonttools`, bootstraps pip in a virtual environment and runs Python without a word, after reading too.

An unusual command that could reach the internet or your sign-ins also gets a second look from a small model you already have. So does a change in an app you connected or added from someone else. The look is given what you asked this turn. It asks only about a real harm, or a step that does nothing for your request and looks steered by what was read. And when Auto would ask about a command only because the chat has read something (a package it doesn't know, data sent somewhere), the look lets it through if it plainly serves what you asked, the way it would have gone before reading. Without a small model to look, the question stands. It never lifts a step that asks whatever was read. Conch's own lists of models and the pictures it makes don't count as reading something from outside. With Claude Code, Auto is Conch's own: Claude Code asks, and Conch answers each question by the same rules as for every other provider.

Reading issues, pull requests or CI logs with `gh` counts as reading something from outside, because anyone can write in them. A command's own output, like a build or a test run, doesn't. Nor does fetching a language's own tools from where they're published, like pip's `get-pip.py` from bootstrap.pypa.io, or Python and Node from python.org and nodejs.org.

**Always allow** on a question Auto asked after reading lifts that kind of step for the rest of the chat. Say it once to an unfamiliar package, and the next one installs without asking. A push, sending data or a look-alike package name still asks on its own terms. When a card asks about a kind of step you already allowed in another chat, or asks for the third time in one go, its button says **Always allow, in every chat**: press it, and Auto never asks about that kind again, in any chat. **Settings → Security → Safety** lists what you allowed this way, each with an × to make Auto ask again.

What still goes ahead after reading, in Auto:

- **A push you asked for.** If your latest message asks for it ("fix CI and push to main"), a push to the repository's own remote goes ahead after reading, and so does merging its pull request. It still asks before a push somewhere else, a new or changed remote or a force-push you didn't name, a branch that publishes (like `gh-pages`) you didn't name, a `.env` or a key added along with it, or anything on the same line that sends what it read. If you said "don't push yet", or someone else's words are in the chat, it asks.

- **Apps you made in Conch**, even in a chat that had read something while you made them. Looking things up doesn’t ask after reading, in any mode, and in Auto neither does an ordinary change, like logging a meal. They ask before they'd pay, send something to other people, delete, give someone access, or send a key or pages of text to the app's site.
- **Apps you connected or added from someone else.** In Auto, a lookup that sends no more than a lookup (a date, an id, a city) goes ahead. A lookup that sends more, and any change, gets the second look, and goes ahead when it sees nothing wrong. Without a small model to look, it asks as before. A tool you set to **Allow** is your answer, so it goes ahead without the look. Paying, deleting, giving someone access, running code, or sending something that looks like a key always asks.
- **Lookups asked at once.** When several lookups in one app would ask for the same reason at the same moment, you get one question for all of them.
- **Reading pages and shopping around.** Searching, reading another page, sorting and filtering a shop, typing a search and filling a basket in [the browser](../features/browser.md) don't ask. Buying, sending or deleting on a site does, in German, French, Spanish, Portuguese, Italian and Dutch shops too. So do an address that looks like it carries data, a long text typed into a page, an upload and a download.

## What a chat does, watched

Some things only look wrong in numbers. Conch counts what each chat does in your apps and asks, saying why, when it sees:

- one message to 20 people or more, every 20th message in one go, or every 100th in a day;
- after reading something from outside, a message to an address nobody gave in the chat;
- every 10th thing deleted in one go, or 25 deleted at once;
- a payment of 1,000 or more, or the fifth in a day;
- the very same change made again and again.

One message to 500 people or more, or the 500th message from a chat in a day, looks like a spam campaign: Conch stops it in every mode, says why, and suggests a mailing service instead. The bigger of the others ask in Full trust too.

**Always allow** holds for that tool for the rest of the chat, also after Conch restarts. To never be asked about a tool in any chat, set it to **Allow** in **Apps**.

## Full trust

**Full trust** never stops to ask, with every provider. What still holds, because your trust can't reach it:

- deleting a whole folder like your home, the work folder or a disk asks;
- Passwords and Conch's own keys stay out of reach, and the assistant can't change who may use Conch;
- a tool you turned **Off** stays off;
- someone else's words in the chat, a routine or a chat app that read something, and a skill's list still ask;
- a message to 500 people or more stops, and the bigger patterns above ask;
- paying or deleting on a website asks.

## In every mode

In **Ask first** and **Read only**, anything that sends, spends or deletes asks first once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted); **Always allow** on that question lets it through for the rest of the chat. A command that wants out of the sealed box (to clone a repository or install something) asks too, with **Always allow**, except in Full trust and Auto. In Auto it asks only for what Auto would stop anyway, or, with someone else's words in the chat or nobody there, once the chat reads something. Whatever the mode, paying or deleting in [the browser](../features/browser.md) asks. A [task](../features/tasks.md) never has more than its chat.

A question nobody answers is a no. After 30 minutes (an hour for a routine), the step doesn't happen, and its line in the chat says **No answer in 30 minutes, so it didn't**. Ask again ("go ahead") and it asks again. You can answer from your phone's notification too: see [On your phone](../start/phone.md#answer-from-the-notification).
