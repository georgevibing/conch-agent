---
title: Your agents
nav: Agents
description: Give your assistant a name, a face and a voice, or make several, each with its own instructions, and choose who answers each chat.
order: 0.5
---

Your assistant has a name, a face, a way of talking and things it always does. You can make more than one: a calm planner for trips, a candid reviewer for your code, a patient tutor for homework. Each one is an **agent**.

Every agent is the same Conch underneath. They all know what Conch remembers about you, use the same apps, skills and providers, and follow the same safety settings. Only how they talk and what they focus on changes.

## The one you start with

The welcome makes your first agent. It asks **And who am I?**: type a name under **My name** (it suggests "Conch"), or press **Another name** for an idea, then choose how it sounds and press **Sounds good**. It says hello in that voice as you choose. If you never make another agent, nothing else changes.

## Make another

1. Open **Settings → Agents**, under **Your assistant**, and press **New agent**. <kbd>mod+k</kbd> finds **New agent** too.
2. Give it a **Name**, up to 40 characters. The dice, **Another name**, offers one with a face to match.
3. Choose a **Face**. See [A face](#a-face).
4. Choose **How it sounds**: **Warm**, **Concise**, **Playful**, **Precise**, **Calm**, **Formal** or **Candid**.
5. Press **Create ‹name›**. It says **‹name› is ready**, with **Add instructions** and **Chat with ‹name›**.

## Its page

Press an agent's face in **Settings → Agents** to open its page. Everything saves as you go: the page says **Saving…**, then **Saved**.

- **Name**, and **What it's for**: one line, like "Plans trips and keeps the bookings", shown when you choose an agent.
- **Face**.
- **Personality**: its tone, and **In your own words** for anything else, like "Dry humour, never gushes".
- **Instructions**: what it always does, in every chat. "Answer in British English." "Give me two options, never one." **Start from** offers a starting point (**Coding**, **Research**, **Writing**, **Personal assistant** or **Tutor**) to change as you like; once it has instructions, it's **Start again from…**.
- **Its chats start with**: turn on **A model and mode of ‹name›'s own** and its new chats start with that model and [permission mode](../reference/modes.md). **Full trust** is never one of them: you choose that for a chat yourself.

**Chat with ‹name›** starts a chat with it. **Make default** has new chats start with it. **Delete** removes it.

A change counts from its next answer, in every chat it's in.

## A face

Every agent has a face. It's shown beside its name above every answer, in the pickers and in Settings.

- **One of Conch's faces.** Eighteen of them: a shell, a fox, an owl, a moon, a little robot and more.
- **Upload a picture.** It opens in **Frame the picture**: drag it, zoom, then press **Use this picture**. PNG, JPEG and WebP all work.
- **Create with AI.** Say **What it looks like** ("a fox in a raincoat") and press **Create**. It only shows when [OpenRouter](../providers/openrouter.md) is connected, which makes the picture.

**Where the pictures go.** A picture you upload stays on your computer, framed and shrunk, without what a camera writes into it, like where and when it was taken. **Create with AI** sends OpenRouter only the words you wrote, never your chats or memories, and the picture it sends back is kept the same way. Faces are part of every [backup](../care/backups.md).

## Who answers

A new chat starts with your default agent. Above the message box, **Talking to ‹name›** says who; press it to choose another before you send. Its menu also has **New agent** and **Agents**.

In a chat, the name at the top says **‹name› answers this chat**. Press it to choose another under **Answer with**. On a phone it's **Answering: ‹name›**, in the **⋯** menu. You can also type `/agent` and a name.

The new agent answers from your next message, and reads the whole chat first, so nothing is lost. A line in the chat marks where: **Atlas took over from Juniper**. Each answer is headed by a small line with the face and name of whoever wrote it, and the words below take the chat's full width.

In <kbd>mod+k</kbd>, type an agent's name for **New chat with ‹name›** or **Edit ‹name›**.

## In chat apps

In [Telegram, WhatsApp, Slack](../channels/index.md) and the others, send `/agent` to see your agents, the one answering ticked, and tap another (in an app without buttons, reply with its number). `/agent atlas` chooses by name. The choice stays for that chat app.

Only you can change agents, in your private chat with Conch. A bot you [brought from OpenClaw or Hermes](../care/come-home.md) keeps answering as the agent it answered as there.

## Tasks and routines

- **A task** you [send to the background](./tasks.md) is done by the agent of the chat it came from.
- **A routine** asked for in a chat is done by that chat's agent; one you make on the Routines page, by your default agent. Its results come in that agent's voice, here and in your chat apps. If its agent is deleted, the default agent takes over. See [Routines](./routines.md).

## What they share

Each agent has its own name, face, personality and instructions, and if you like a model and mode to start with. Everything else belongs to Conch, so every agent has it:

- **What Conch knows about you.** [Memory](./memory.md) and About you are shared. Tell one agent you're vegetarian and the others know too.
- **Your apps, skills and providers.** Connect an app once and every agent can use it.
- **Your chats.** Any agent can [look through earlier chats](./memory.md#your-earlier-chats), whoever was in them.

## What an agent can't change

An agent's personality and instructions shape how it talks. They can't lift a permission, turn off a safety check, or make it skip asking you. Conch's own rules come first, whatever an agent's instructions say, and the assistant can't edit an agent itself.

## Every agent keeps going

Whichever you pick, an agent doesn't give up at the first error. When something fails, it works out why, tries another way, and checks the result before it tells you it's done. If it really can't, it says what it tried and the one thing it needs from you, in its own voice. See [how Conch works on a problem](./working-on-a-problem.md).

## Bring them from OpenClaw or Hermes

Your agents there come over with their names, faces (their picture, or one of Conch's that matches), personalities, instructions, models, which one was the default, and the bots they answered in. Bringing them again brings them up to date instead of making them twice. See [Coming from another assistant](../care/come-home.md#what-comes-over).

## Order and delete

Drag faces in **Settings → Agents** to put them in your order, the order every picker uses. Each face's menu, **More for ‹name›**, has **Edit**, **Make default**, **Move earlier**, **Move later** and **Delete**.

Deleting says **‹name› deleted**, with **Undo**. Its chats stay, and carry on with your default agent if you write in them. Memories stay too, since they were never only its own. Delete your default agent and the first in your order becomes the default. Your last agent can't be deleted: Conch always has someone to answer.

## Good to know

- Up to 50 agents. A name is up to 40 characters, what it's for 120, its own words on personality 2,000, and its instructions 8,000.
- Instructions are read before every answer, so long ones cost a little on every message. A few lines is plenty.
- Old links to **Settings → Personality** open **Settings → Agents**.
- Agents are kept in `~/.conch/agents`: `agents.json`, and their pictures in `avatars`.
