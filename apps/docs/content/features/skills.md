---
title: Skills
description: Teach your assistant how you like something done, once, and use it with every model.
order: 2
---

A skill is instructions for one kind of job, like your weekly review or a release checklist. Write it once, in your own words. Every provider can use it, whenever a request fits.

## Teach one

1. Open **Skills** in the sidebar and press **New skill**.
2. Describe the steps, the tone and what to leave out. With only a sentence, press **Write the steps for me**. **Back to my words** restores yours.
3. Pause, and Conch writes a title and description you can change.
4. Under **Use it**, choose **Automatically** or **When I ask**, then press **Create skill**.

**Write the steps for me** needs a provider that can write, such as Claude Code. Without one, your words are the skill.

## Use one

Each skill has one of three settings:

- **Automatically.** Used whenever a request fits.
- **When I ask.** Only when you type `/` and its name, like `/weekly-review`, then what to work on.
- **Off.** Never, but kept and backed up. **Off** at the top of the list shows them, and <kbd>mod+k</kbd> finds them as **Skills that are off**.

A line in the chat names the skill that shaped the reply. Change the setting on the skill's page or with its switch. **Try it in a chat** starts a chat with it filled in. Choosing it in <kbd>mod+k</kbd> puts it in the message box.

## When a skill that's off would help

If an **Off** or **When I ask** skill fits, a card under the reply offers it and says why.

- **Off:** **Turn on** shows what it can do; **Turn on** again sets it to **Automatically**.
- **When I ask:** **Use it** shows what it can do. Then **Use it** for this request, or **Always** to set it to **Automatically**.

The chat carries on using it. **Not now** and **Don't suggest** work as for [apps](./apps.md#or-connect-from-a-chat). A worrying skill is never offered.

## Add a skill people share

**Discover**, the second tab on the Skills page, finds skills from Anthropic's own collection, ClawHub and skills.sh.

1. Open **Skills** and choose **Discover**. Search, or pick a kind such as **Writing**.
2. Each card shows what it does, who published it, how many use it, and the source's rating: **Official**, **Verified publisher**, **Community** or **Flagged**.
3. Open one. Conch reads every file first and shows what it can do, what it found, the version and the licence.
4. Choose **When it fits** or **Only when I ask**, and press **Add skill**.

It's yours, under **Added from Discover**. Nothing runs when it's added.

- **A worrying skill** shows what Conch found. **Add anyway** waits until you tick that you've read it.
- **Some can't be added**, when its source found harmful code or its licence limits it to its maker's apps. You see why.
- **Updates wait for you.** Its page says **A newer version is there**. **Read the update** shows each changed file, and first whether it asks to do more. Nothing changes until you press **Update**.
- **Remove** on its page takes it away.

When a shared skill would clearly help, a card under the reply offers it. **Add and carry on** adds it and continues. **Don't suggest skills from Discover**, under **More**, stops these. A chat that has read something from outside never offers them. Offline, Discover shows its last results.

## Skills you already have

Conch saves a skill as a `SKILL.md`, the format Claude Code, Codex, OpenClaw and Hermes read. Skills in other assistants' folders appear under **From other apps**, turned off until you read and turn them on. Conch never changes another app's folder: **Make a copy to edit** gives you your own.

## What keeps a skill honest

A skill runs with your powers, so:

- **It's read first.** Conch says plainly what could hurt you, like running a download or reaching for saved passwords. A worrying skill stays off until you've looked.
- **It's held to what it says.** Its page lists what it can do, like "run commands (only `git`), change files in your work folder". In **Ask first** and **Read only**, anything outside that list asks for the rest of the chat and its tasks. **Auto** judges each action by its risk; **Full trust** skips action approvals. Loading a skill never silently changes your selected mode.
- **A change turns it off.** If another app's skill changes after you turned it on, it's off until you look again.
- **A signature says who made it.** Press **Trust this publisher…** on a signed skill once. Their skills then say **Verified**, and their signed updates stay on. A skill changed after signing can't be turned on.

To sign your own, see `conch skills sign` in the [command line reference](../reference/cli.md). Your signing key opens only on this computer; a passphrase-locked [backup](../care/backups.md) moves it.

## Stop holding a chat to a skill

In Ask first and Read only, the skill's list stays active after use. Auto and Full trust suspend these restrictions without deleting the list. When you're done:

1. Press **Stop holding** on the line above the message box, or find **Stop holding this chat to …** in <kbd>mod+k</kbd>.
2. Read what changes, and press **Stop holding**.

The chat and **Activity** record it. Only you can do this, and not mid-answer.

## Skills Conch suggests

Ask for the same thing in three chats, and the Skills page offers a draft skill for it. Once search [understands meaning](./memory.md#search-that-understands), the words needn't match.

- **Look at the draft** opens it to edit.
- **Not now** hides it for a month.
- **Don't suggest this** hides it for good.

## Save how I did this

When your assistant works something out the long way, a card under the reply offers **Save as skill** ("Log a meal in Yazio"). It appears when:

- a background task finished and Conch confirmed it;
- a routine ran and did its job;
- you said it worked ("perfect, thanks") right after a few steps;
- or it took many steps and ended well.

The draft keeps the steps that worked. One-off details, like a date, become questions for next time. It starts as **When I ask** and can do only what the work needed. Edit it, then press **Create skill**.

- Offered once per chat, never mid-answer, and never for work that failed.
- **Not now** puts it away. It also waits on the Skills page, with **Don't suggest this**, and in <kbd>mod+k</kbd> in that chat.
- If the chat read something from outside, the offer says so ("Learned from trains.example"), and Conch drops steps that look slipped in.
- Never offered for a chat with someone else's messages in it.
- The chat's own provider writes the draft, so nothing goes anywhere new.

## A tidy shelf

When a skill Conch suggested, saved from your work or brought in from another app goes unused for two months, the Skills page says **You haven't used these in two months**. **Turn them off** moves them under **Off**; **Keep them** asks again in two months. Skills you wrote, and skills still in another app's folder, are never on this card.

## Good to know

- Your skills live in `~/.conch/skills`, one folder each, and are in every [backup](../care/backups.md).
- Claude Code reads its own skills folder, so it may use those skills whatever you choose. The skill's page says so.
- Publishers you trust are listed at the bottom of the Skills page. **Forget** stops trusting one.
