---
title: Agents
description: Make agents of your own, each with a name, a face and a voice. Pick who answers each chat, task and routine, here and in your chat apps.
order: 0.5
---

<!--
  verify-ui: the words this page takes from the app. Check each against the real UI and fix it here.
  The place: Settings → Agents. Buttons: New agent, Create agent, Make default, Delete agent.
  Fields: Name, Face (Choose one, Upload a photo, Draw one), Personality, Instructions.
  The picker in a new chat: Who answers. The command: /agent, /agent <name>.
-->

An agent is someone to talk to in Conch: a name, a face, a personality and what it should always keep in mind. Make one for work and one for home, one that's brief and one that takes its time. Each answers in its own voice. Underneath, every agent is the same Conch, with the same memory, apps and skills.

## Your first agent

The welcome makes your first agent. You give it a name, choose how it sounds, and it says hello in that voice. It's your default: new chats start with it. <!-- verify-ui -->

## Make another

1. Open **Settings → Agents** and press **New agent**. <!-- verify-ui --> <kbd>mod+k</kbd> finds **New agent** too.
2. Give it a **Name**. It's how the agent signs its answers, and what you type after `/agent`.
3. Choose a **Face**. See [A face](#a-face).
4. Choose a **Personality**: how it talks. **Warm**, **Concise**, **Playful**, **Precise**, or your own words. <!-- verify-ui -->
5. Write its **Instructions**, if it needs any: what it's for, what to always do, what never to do. "You help with the garden. Use metric units." Leave it empty and it's a good all-rounder.
6. Press **Create agent**. <!-- verify-ui -->

Press an agent in **Settings → Agents** to change any of it. A change counts from its next answer, in every chat it's in.

## A face

Every agent has a face, shown beside its name above each answer, in the sidebar and in the picker.

- **Choose one** from the set Conch comes with. <!-- verify-ui -->
- **Upload a photo** or a picture. Drag it to frame it, as with [your own photo](./memory.md#about-you). PNG, JPEG and WebP all work.
- **Draw one.** Say what you'd like ("a fox in a raincoat") and a provider you've connected that makes pictures draws it. You only see this when one can. <!-- verify-ui -->

**Where the pictures go.** A face you choose or upload stays on your computer, shrunk to the size Conch shows it, and goes into your [backups](../care/backups.md). Drawing one sends only the words you wrote to the provider that draws it, never your chats or memories, and the picture it sends back is kept on your computer like the others. <!-- verify-ui -->

## Who answers

New chats start with your default agent. To start with another, choose it under **Who answers** before you send the first message. <!-- verify-ui --> To change your default, press **Make default** on an agent's page.

You can hand a chat to another agent at any point, with `/agent` and its name. Above each answer, a small header with the agent's face and name says who wrote it, so a chat that changed hands reads clearly. The new agent reads the whole chat, so nothing is lost.

An agent decides who's talking, not which model answers. Every agent uses the chat's model, and the model picker works the same with each. <!-- verify-ui -->

## In your chat apps

In [Telegram, WhatsApp, Slack](../channels/index.md) and the others, your messages go to your default agent. Send `/agent` to see your agents, with the one answering ticked, and tap another (in an app without buttons, reply with its number). `/agent Atlas` goes straight to Atlas. The choice stays for that chat until you change it. <!-- verify-ui -->

Only you can change agents, in your private chat with Conch. In a group, people you let in talk to whichever agent you chose there.

## Tasks and routines

- **A task** you [send to the background](./tasks.md) runs as the agent of the chat it came from, and its card says who's doing it.
- **A routine** runs as the agent that drafted it. [**Edit**](./routines.md) shows the **Agent** and lets you choose another. Its results arrive in that agent's voice, here and in your chat apps. <!-- verify-ui -->

## What they share, and what's their own

Each agent has its own name, face, personality and instructions. Everything else belongs to Conch, so every agent has it:

- **What Conch knows about you.** [Memory](./memory.md) and About you are shared. Tell one agent you're vegetarian and the others know too.
- **Your apps, skills and providers.** Connect an app once and every agent can use it.
- **Your chats.** Any agent can [look through earlier chats](./memory.md#your-earlier-chats), whoever was in them.
- **Safety.** The [mode](../reference/modes.md), what asks first, and what you've allowed belong to the chat, not the agent. A new agent can never do more than the chat already could.

## Every agent keeps going

Whichever you pick, an agent doesn't give up at the first error. When something fails, it works out why, tries another way, and checks the result before it tells you it's done. If it really can't, it says what it tried and the one thing it needs from you, in its own voice. See [how Conch works on a problem](./working-on-a-problem.md).

## Bring them from OpenClaw or Hermes

If you used OpenClaw or Hermes, your agents can come over with their names, personalities, memories, skills and routines. See [Coming from another assistant](../care/come-home.md#what-comes-over).

## Delete one

Press **Delete agent** on its page. Its chats stay, signed with its name, and carry on with your default agent if you write in them. Memories stay too, since they were never only its own. Your default agent can't be deleted: make another the default first. <!-- verify-ui -->

## Good to know

- Up to 12 agents. <!-- verify-ui -->
- Instructions are read before every answer, so long ones cost a little on every message. A few lines is plenty.
- Agents are plain files in `~/.conch/agents`, faces included, and part of every backup. <!-- verify-ui -->
- A personality or instructions that read like orders to get round Conch's safety ("never ask before deleting") don't change what asks first. See [Safety](../reference/modes.md).
