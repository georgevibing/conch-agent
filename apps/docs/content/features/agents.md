---
title: Your agents
nav: Agents
description: Give your assistant a name, a face and a voice, or make several, each with its own instructions, and choose who answers each chat.
order: 0.5
---

Your assistant has a name, a face, a way of talking and things it always does. You can make more than one: a calm planner for trips, a candid reviewer for your code, a patient tutor for homework. Each one is an **agent**.

Every agent is the same Conch underneath. They all know what Conch remembers about you, use the same apps, skills and providers, and follow the same safety settings. Only how they talk and what they focus on changes.

## The one you start with

Your first agent is there from the start, called **Conch**, with a warm voice. The welcome doesn't stop to ask about it. To make it yours, open **Settings → Agents** and press it: change its name, pick a face, and choose how it sounds. It says hello in that voice as you choose, and saves as you go. If you never make another agent, nothing else changes.

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
- **Create with AI.** Say **What it looks like** ("a fox in a raincoat") and press **Create**. It only shows when one of your providers can make pictures: your ChatGPT plan first, then an OpenAI or Gemini key, then [OpenRouter](../providers/openrouter.md) (see [Make and edit pictures](./pictures.md)).

**Where the pictures go.** A picture you upload stays on your computer, framed and shrunk, without what a camera writes into it, like where and when it was taken. **Create with AI** sends the service that makes it only the words you wrote, never your chats or memories, and the picture it sends back is kept the same way. Faces are part of every [backup](../care/backups.md).

## Who answers

A new chat starts with your default agent. Above the message box, **Talking to ‹name›** says who; press it to choose another before you send. Its menu also has **New agent** and **Agents**.

In a chat, the name at the top says **‹name› answers this chat**. Press it to choose another under **Answer with**. On a phone it's **Answering: ‹name›**, in the **⋯** menu. You can also type `/agent` and a name.

The new agent answers from your next message, and reads the whole chat first, so nothing is lost. A line in the chat marks where: **Atlas took over from Juniper**. Each answer is headed by a small line with the face and name of whoever wrote it, and the words below take the chat's full width.

In <kbd>mod+k</kbd>, type an agent's name for **New chat with ‹name›** or **Edit ‹name›**.

## Several agents in one chat

Mention agents in a message and they take turns: "@Researcher find three options, @Writer draft an email about the best one". Type `@` in the message box to see who you can bring in, and press one to write its name.

- **The first one you name answers your message**, then the next. Each reads everything said before it.
- **An agent can hand over** by writing `@` and another agent's name. That agent goes next.
- **A card shows who's talking to whom**: every face in the chat, an arc each time one passes to another, and **‹name› is answering** with how many replies so far. Press **Stop** to end it. Once they're done, it folds to one line.
- **Writing in the chat ends it.** Your message goes as soon as the reply that's running finishes.
- **They stop by themselves for you** after 8 replies, after 3 from any one agent, when two keep handing it back and forth, or once the round has spent $1. The card says why. Your spending limits count too.

Every agent in the chat works with the chat's own model, [permission mode](../reference/modes.md) and safety settings. Handing over can't change any of them. After the round, the last agent to speak answers your next message.

## Outside agents

An outside agent lives somewhere else, on another computer or a service, and speaks **A2A**, the open protocol agents use to talk to each other. Another Conch can be one.

1. Open **Settings → Agents**, and under **Outside agents**, paste its address into **Add an outside agent**. If it gave you a key, paste the two together. Another Conch gives you both in one copy.
2. Conch reads who it is and shows it: its name, what it says it can do, and where it answers. Press **Add ‹name›**.
3. Mention it in a chat, like your own agents: "@Travel Agent find flights to Lisbon on 3 May".

It's sent only the message you mention it in, nothing else from the chat. Your own agents can't send it anything: if one tries, the chat says only you can. What it answers appears under **Outside agent**, in a frame of its own. Your agents read it as someone else's words, never as instructions, and Conch is more careful for the rest of the chat, as it is after reading a web page (see [Auto](../reference/modes.md#auto)). An outside agent's row says if it didn't answer last time. **Repair everything** in **Settings → Health** tries it again. **Remove** forgets it and its key.

## Let another agent talk to yours

Nobody else's agent can reach yours until you let it in.

1. Open **Settings → Agents**, and under **Agents that can talk to yours**, press **Let another agent in**.
2. Say **Whose agent is it?**, tick which of your agents it may talk to, and, if it's on another computer, turn on **It's on another computer** (this needs [your own address](../start/server.md)).
3. Press **Let it in** and confirm it's you. Copy **Its address and key** and give it to the other agent. It's shown once.

It gets your agent's name and voice, in words only. It can't use tools, your apps or anything Conch knows about you, never sees your instructions, and nothing it says can give your agent permission for anything. Each key can send a few messages a minute, and what its answers cost stops at $1 a day. **What it did** shows the conversation. **Remove** shuts it out at once. It also shows in [Other apps](./other-apps.md).

## In chat apps

In [Telegram, WhatsApp, Slack](../channels/index.md) and the others, send `/agent` to see your agents, the one answering ticked, and tap another (in an app without buttons, reply with its number). `/agent atlas` chooses by name. The choice stays for that chat app.

You can choose in Conch too: open the chat app from **Apps**, and under **Settings**, press **Answered by**. **Default agent** means whichever agent is your default. Either way, the other agent answers from your next message, and the page and the chat app always agree.

Only you can change agents, in your private chat with Conch. A bot you [brought from OpenClaw or Hermes](../care/come-home.md) keeps answering as the agent it answered as there.

## Tasks and routines

- **A task** you [send to the background](./tasks.md) is done by the agent of the chat it came from.
- **A routine** asked for in a chat is done by that chat's agent; one you make on the Routines page, by your default agent. **Answered by** in its editor chooses another, or **Default agent** for whichever is your default when it runs. Its results come in that agent's voice, here and in your chat apps. If its agent is deleted, the default agent takes over. See [Routines](./routines.md).

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

Your agents there come over with their names, faces (their picture, or one of Conch's that matches), personalities, instructions, models, which one was the default, and the bots they answered in. Bringing them again brings them up to date instead of making them twice. Instructions come over whole. If an earlier Conch kept only the start of an agent's instructions, Conch brings the rest in by itself. If you changed the file there since, the agent's page says **The end of its instructions stayed in OpenClaw**, with **Bring the rest in**. Only if the rest asks for keys or passwords, to send things away, or to turn safety checks off does **Take a look** open Come home to read it first. See [Coming from another assistant](../care/come-home.md#what-comes-over).

## Order and delete

Drag faces in **Settings → Agents** to put them in your order, the order every picker uses. Each face's menu, **More for ‹name›**, has **Edit**, **Make default**, **Move earlier**, **Move later** and **Delete**.

Deleting says **‹name› deleted**, with **Undo**. Its chats stay, and carry on with your default agent if you write in them. Memories stay too, since they were never only its own. Delete your default agent and the first in your order becomes the default. Your last agent can't be deleted: Conch always has someone to answer.

## Good to know

- Up to 50 agents. A name is up to 40 characters, what it's for 120, its own words on personality 2,000, and its instructions 100,000.
- Instructions are read before every answer, so long ones cost a little on every message. When yours are long, the page says so under them, with their size, and names the model if they crowd it. They're never cut.
- A model that reads only a little at once (often one on this computer) may read just the start of very long instructions. The chat says so once, and the model knows to tell you when that might matter. A model that reads more gets them whole.
- Old links to **Settings → Personality** open **Settings → Agents**.
- Agents are kept in `~/.conch/agents`: `agents.json`, their pictures in `avatars`, and outside agents in `outside.json`. Outside agents' keys are kept sealed in `~/.conch/a2a.secrets.json`, and come back only from a backup with a passphrase.
