---
title: Your agents
nav: Agents
description: Give your assistant a name, a face and a voice. Make several, each with its own instructions, and choose who answers each chat.
order: 0.5
---

An **agent** is your assistant's name, face, voice and standing instructions. Make several, like a calm trip planner or a candid code reviewer: the same Conch underneath, each with its own focus ([What they share](#what-they-share)).

## The one you start with

Your first agent is **Conch**, with a warm voice. Press it in **Settings → Agents** to change its name, face and voice; it says hello in each voice as you choose.

## Make another

1. In **Settings → Agents**, under **Your assistant**, press **New agent** (or find it with <kbd>mod+k</kbd>).
2. Give it a **Name**, up to 40 characters. The dice, **Another name**, suggests one with a matching face.
3. Choose a **Face** ([A face](#a-face)).
4. Choose **How it sounds**: **Warm**, **Concise**, **Playful**, **Precise**, **Calm**, **Formal** or **Candid**.
5. Press **Create ‹name›**. It says **‹name› is ready**, with **Add instructions** and **Chat with ‹name›**.

## Its page

Press an agent's face in **Settings → Agents**. It saves as you go (**Saving…**, then **Saved**).

- **Name**, **Face**, and **What it's for**: one line shown when you choose an agent, like "Plans trips and keeps the bookings".
- **Personality**: its tone, plus **In your own words**, like "Dry humour, never gushes".
- **Instructions**: what it does in every chat. **Start from** offers **Coding**, **Research**, **Writing**, **Personal assistant** or **Tutor**; once it has instructions, it's **Start again from…**.
- **Its chats start with**: **A model and mode of ‹name›'s own** starts its new chats with that model and [permission mode](../reference/modes.md). **Full trust** is never offered; you choose that per chat.

**Chat with ‹name›**, **Make default** and **Delete** do what they say. Changes count from its next answer, in every chat.

## A face

Shown above every answer, in pickers and in Settings.

- **One of Conch's faces.** Eighteen, like a fox or a little robot.
- **Upload a picture.** PNG, JPEG or WebP. In **Frame the picture**, drag and zoom, then press **Use this picture**.
- **Create with AI.** Describe **What it looks like** ("a fox in a raincoat") and press **Create**. Needs a provider that makes pictures: your ChatGPT plan first, then an OpenAI or Gemini key, then [OpenRouter](../providers/openrouter.md) ([pictures](./pictures.md)).

Uploads stay on your computer, framed, shrunk and stripped of camera details like place and time. **Create with AI** sends only your description. Faces are in every [backup](../care/backups.md).

## Who answers

New chats start with your default agent, named in **Talking to ‹name›** above the message box. Press it to choose another; its menu also has **New agent** and **Agents**.

To switch mid-chat, press **‹name› answers this chat** at the top and choose under **Answer with** (on a phone, **Answering: ‹name›** in the **⋯** menu), or type `/agent` and a name. The new agent reads the whole chat and answers from your next message, marked by a line like **Atlas took over from Juniper**.

In <kbd>mod+k</kbd>, type an agent's name for **New chat with ‹name›** or **Edit ‹name›**.

## Several agents in one chat

Mention agents (type `@` to pick) and they take turns: "@Researcher find three options, @Writer draft an email about the best one".

- **The first one named answers first**, each reading everything before it. An agent hands over by writing `@` and another's name.
- **A card shows who's talking to whom**: faces, an arc per handover, and **‹name› is answering** with the reply count. **Stop** ends it; when done, it folds to one line.
- **Writing in the chat ends the round**, once the running reply finishes.
- **They stop by themselves** after 8 replies, 3 from one agent, two agents handing back and forth, or $1 in the round, and the card says why. Your spending limits count too.

All use the chat's model, [permission mode](../reference/modes.md) and safety settings; handing over can't change them. The last to speak answers your next message.

## Outside agents

An outside agent (on another computer, a service, another Conch) speaks **A2A**, the open protocol agents talk to each other with.

1. In **Settings → Agents**, under **Outside agents**, paste its address (and any key; another Conch gives both in one copy) into **Add an outside agent**.
2. Check its name, what it says it can do and where it answers, then press **Add ‹name›**.
3. Mention it in a chat: "@Travel Agent find flights to Lisbon on 3 May".

- It gets only the message you mention it in. Your agents can't message it; if one tries, the chat says only you can.
- Its answer appears framed under **Outside agent**, read by your agents as someone else's words, never as instructions.
- Conch is more careful for the rest of the chat, as after reading a web page ([Auto](../reference/modes.md#auto)).

Its row says if it didn't answer last time; **Repair everything** in **Settings → Health** retries. **Remove** forgets it and its key.

## Let another agent talk to yours

No one else's agent reaches yours until you let it in.

1. In **Settings → Agents**, under **Agents that can talk to yours**, press **Let another agent in**.
2. Fill in **Whose agent is it?** and tick which of your agents it may talk to. For one on another computer, turn on **It's on another computer** (needs [your own address](../start/server.md)).
3. Press **Let it in** and confirm it's you. Copy **Its address and key**, shown once, and give it to the other agent.

- It gets words only, in your agent's name and voice: no tools, apps, instructions or anything Conch knows about you. Nothing it says grants a permission.
- Each key sends a few messages a minute, and its answers cost at most $1 a day.
- **What it did** shows the conversation; **Remove** shuts it out at once. It also shows in [Other apps](./other-apps.md).

## In chat apps

In [Telegram, WhatsApp, Slack](../channels/index.md) and the others, send `/agent` to list your agents (the one answering ticked), then tap one or reply with its number; `/agent atlas` chooses by name. Or in Conch, open the chat app from **Apps** and press **Answered by** under **Settings**; **Default agent** follows your default. The choice stays for that chat app, from your next message.

Only you can change agents, in your private chat with Conch. A bot [brought from OpenClaw or Hermes](../care/come-home.md) keeps answering as the agent it was there.

## Tasks and routines

- **A task** [sent to the background](./tasks.md), or **a routine** asked for in a chat, is done by that chat's agent.
- **A routine** made on the Routines page uses your default. **Answered by** in its editor picks another, or **Default agent** for whichever is default when it runs. Results come in that agent's voice; if it's deleted, the default takes over. See [Routines](./routines.md).

## What they share

Beyond its name, face, personality, instructions and starting model and mode, everything is shared:

- [Memory](./memory.md) and About you: tell one agent you're vegetarian and the others know.
- Your apps, skills and providers.
- Your chats: any agent can [look through earlier chats](./memory.md#your-earlier-chats), whoever was in them.

## What an agent can't change

Personality and instructions can't lift a permission, turn off a safety check or skip asking you. Conch's rules come first, and the assistant can't edit an agent.

## Every agent keeps going

On an error, an agent works out why, tries another way and checks the result. If it can't finish, it says what it tried and the one thing it needs from you ([how Conch works on a problem](./working-on-a-problem.md)).

## Bring them from OpenClaw or Hermes

Agents come over with names, faces (their picture or a matching Conch face), personalities, instructions, models, the default, and the bots they answered in. Bringing them again updates them.

Instructions come over whole; if an earlier Conch kept only the start, Conch brings the rest in by itself. If you've changed the file there since, the agent's page says **The end of its instructions stayed in OpenClaw**, with **Bring the rest in**. If the rest asks for keys or passwords, sending things away or turning safety checks off, **Take a look** opens Come home so you read it first. See [Coming from another assistant](../care/come-home.md#what-comes-over).

## Order and delete

Drag faces in **Settings → Agents** to order every picker. Each face's menu, **More for ‹name›**, has **Edit**, **Make default**, **Move earlier**, **Move later** and **Delete**.

Deleting says **‹name› deleted**, with **Undo**. Its chats continue with your default; memories stay. Delete your default and the first in your order takes over. Your last agent can't be deleted.

## Good to know

- Up to 50 agents. Name 40 characters, what it's for 120, personality in your own words 2,000, instructions 100,000.
- Instructions are read before every answer, so long ones cost a little each message; the page shows their size and names any model they crowd. They're never cut, but a model that reads little at once (often one on this computer) may see only the start. The chat says so once, and the model tells you when it matters.
- Old links to **Settings → Personality** open **Settings → Agents**.
- Agents live in `~/.conch/agents`: `agents.json`, pictures in `avatars`, outside agents in `outside.json`. Outside agents' keys are sealed in `~/.conch/a2a.secrets.json` and come back only from a backup with a passphrase.
