---
title: Skills
description: Teach your assistant how you like something done, once, and use it with every model.
order: 2
---

A skill is a set of instructions your assistant follows for one kind of job: your weekly review, a release checklist, the tone of a status update. You write it once, in your own words. It works with every provider, and your assistant reaches for it when a request fits.

## Teach one

1. Open **Skills** in the sidebar and press **New skill**.
2. Describe what it should do: the steps, the tone, what to include and what to leave out.
   A sentence is enough if you'd rather not write the steps: press **Write the steps for me**
   and Conch writes them, with a title and a description. Read them and change anything.
   **Back to my words** puts back what you typed.
3. Pause. Conch writes a title and a one-line description for you. Change either if you like.
4. Under **Use it**, choose **Automatically** or **When I ask**, then press **Create skill**.

Writing the steps needs a provider that can write, such as Claude Code or a key for a model
you pay for as you go. Without one, your own words become the skill as they are.

Not sure where to begin? The page offers a few ideas to start from.

## Use one

Each skill has one of three settings:

- **Automatically.** Your assistant uses it whenever a request fits.
- **When I ask.** Only when you type `/` and its name, such as `/weekly-review`, followed by whatever it should work on.
- **Off.** Never. An off skill is kept, and in every backup. **Off** at the top of the list shows them all, and <kbd>mod+k</kbd> finds them as **Skills that are off**.

Either way, a line in the chat names the skill that shaped the reply. Skills are in <kbd>mod+k</kbd> too: choosing one puts it in the message box, ready to send.

Change the setting on the skill's page, or flip its switch in the list. **Try it in a chat** starts a new chat with the skill filled in.

## When a skill that's off would help

If a skill is **Off** or **When I ask** and it fits what you asked, your assistant can offer it under the reply, in a card with the skill's name and why it would help. Nothing changes until you press something.

- For a skill that's **Off**, press **Turn on**. The card opens to show what the skill can do, in the same words as its page. Press **Turn on** again to set it to **Automatically**.
- For a skill set to **When I ask**, press **Use it** to see what it can do, then **Use it** to use it for this request only, or **Always** to set it to **Automatically**.

Either way the chat carries on by itself with what you asked, now using the skill. **Not now** and **Don't suggest** work as they do for [apps](./apps.md#or-connect-from-a-chat). A skill Conch found something worrying in is never offered: open it from **Skills** and look first.

## Add a skill people share

Thousands of people share skills. **Discover**, the second tab on the Skills page, finds them in Anthropic's own collection, ClawHub and skills.sh.

1. Open **Skills** and choose **Discover**. Search for what it should get better at, pick a kind such as **Writing** or **Design**, or start from one of the ideas.
2. Each card says what the skill does, who published it and where, how many people use it, and what that place says about it: **Official**, **Verified publisher**, **Community** or **Flagged**.
3. Open one. Conch downloads it and reads every file before you add anything. You see what it will be able to do, what Conch found, the version and the licence.
4. Choose **When it fits** or **Only when I ask**, and press **Add skill**.

It's yours from then on, under **Added from Discover**, and works with every model. Nothing in it runs when it's added.

- **A worrying skill** shows what Conch found, and **Add anyway** waits until you tick that you've read it.
- **Some can't be added.** A skill whose place found harmful code in it, or whose licence only allows using it inside its maker's own apps, has no button, only why.
- **Updates wait for you.** A skill is pinned to the exact version you read. When a newer one is out, its page says **A newer version is there**. **Read the update** shows what changed, file by file, and says first if it now asks to do more. Nothing changes until you press **Update**.
- **Remove** on its page takes it away. You can add it again from Discover.

Your assistant can find one for you too. When a skill people share would clearly help with what you asked, a card under the reply names it, says where it's from, and opens it to read. **Add and carry on** adds it, and the chat carries on with it. **Don't suggest skills from Discover**, under the card's **More**, stops these offers. In a chat that has read something from outside, your assistant doesn't look for skills or offer them.

<kbd>mod+k</kbd> finds **Discover skills**, and skills people share by name.

If those places can't be reached, Discover shows what it found last time and says so.

## Skills you already have

Conch saves a skill as a `SKILL.md`, the format Claude Code, Codex, OpenClaw and Hermes all read. Skills it finds in other assistants' folders appear under **From other apps**.

They start off. Read one, then turn it on. Conch never changes another app's folder: **Make a copy to edit** gives you one of your own.

## What keeps a skill honest

A skill is instructions your assistant follows with your powers, so Conch treats one with care.

- **It's read through first.** Conch reads every file in a skill and says in plain words what could hurt you: running something it downloads, reaching for saved passwords, hiding what it does from you. A worrying skill stays off until you've looked.
- **It's held to what it says.** A skill's page lists what it can do, for example "run commands (only `git`), change files in your work folder". Once a skill is in a chat, anything else it tries asks you first, in every [mode](../reference/modes.md), for the rest of the chat. A line above the message box says **Held to Quick setup's list**; press the name to see the list. Work you hand off from that chat is held the same way.
- **A change turns it off.** If another app's skill changes after you turned it on, it's off again until you look at what it says now.
- **A signature says who made it.** Open a signed skill and press **Trust this publisher…** once. From then on that publisher's skills say **Verified**, and their signed updates stay on. A skill changed after it was signed can't be turned on.

To sign skills you share, see `conch skills sign` in the [command line reference](../reference/cli.md). Your signing key is locked with this computer's own key, so it only opens here. A passphrase-locked [backup](../care/backups.md) carries it to a new computer.

## Stop holding a chat to a skill

A skill's instructions stay in the chat after the turn it was used in, so the chat stays held to its list. When you're done with it:

1. Press **Stop holding** on the line above the message box, or find **Stop holding this chat to …** in <kbd>mod+k</kbd>.
2. Read what changes, and press **Stop holding**.

The chat says you did, and so does **Activity**. Only you can do this, and not while an answer is being written. A new chat starts with nothing held.

## Skills Conch suggests

When you've asked for the same thing in three different chats, the Skills page offers to save it as a skill, with a first draft written from what you said. Once search [understands meaning](./memory.md#search-that-understands), the words don't have to match: "Write my weekly summary", "Recap this week's meetings" and "What happened at work this week?" count as one thing. A skill you already have is recognised in other words too.

- **Look at the draft** opens it for you to read and change.
- **Not now** hides the offer for a month.
- **Don't suggest this** hides it for good.

Nothing is saved or turned on unless you do it.

## Save how I did this

Sometimes your assistant has to work something out: many steps, a false start or two, then it works. Conch can keep that know-how as a skill, so next time it goes straight there.

When a piece of work goes well, a line appears under the reply: **Save how I did this as a skill**. It appears when:

- a task you sent to the background finished, and Conch checked it really happened;
- a routine ran and did its job;
- you said it worked, like "perfect, thanks", right after a few steps;
- or it took many steps and ended well.

Press it to open a draft, written from the chat. It keeps the steps that worked and leaves out the dead ends. Things that were only true this once, like a file name or a date, become something to ask for next time. The draft starts as **When I ask**, and it says what the skill can do: only what the work needed. Read it, change anything, and press **Create skill** if you want it.

It's offered once per chat, never while an answer is being written, and never for work that failed. **Not now** puts it away. The offer waits on the Skills page too, with **Not now** and **Don't suggest this**. It's in <kbd>mod+k</kbd> while you're in that chat.

If the chat read a web page, an email or a file from outside, the offer says so: "Learned in a chat that read trains.example." Read each step before you save it. A page can try to slip in a step of its own, so Conch reads the draft the way it reads any skill, and drops one that looks wrong. Work from a chat with someone else's messages in it is never offered.

The draft is written by the provider that answered the chat, which has seen it already. Nothing goes anywhere new.

## A tidy shelf

Skills Conch suggested, saved from your work, or brought in from another app can sit unused. When one hasn't been used for two months, the Skills page says **You haven't used these in two months**:

- **Turn them off** turns them off. They stay in your list under **Off**, and in every backup. One switch brings each back.
- **Keep them** leaves them on. Conch asks again only after another two months.

Nothing changes until you press. A skill you wrote yourself is never on this card, and neither is another app's.

## Good to know

- Your skills live in `~/.conch/skills`, one folder each, and are part of every [backup](../care/backups.md).
- A provider that reads a folder by itself may use those skills whatever you choose in Conch. Claude Code does this with its own skills folder, and the skill's page says so.
- The publishers you trust are listed at the bottom of the Skills page. **Forget** stops trusting one.
