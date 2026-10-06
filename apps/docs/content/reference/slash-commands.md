---
title: Slash commands
description: Type / in any chat, in Conch or a chat app. Conch's own commands act on the app and never reach the model.
order: 3
---

<!-- conch:slash -->

## Finding one

Type `/` at the start of the message box. A list opens above it, grouped by what each command acts on: this chat, how it answers, and Conch. Keep typing to narrow it: a few letters of the name are enough (`/cpt` finds `/compact`), and other names work too (`/reset` finds `/clear`).

- <kbd>↑</kbd> and <kbd>↓</kbd> move, <kbd>tab</kbd> or <kbd>enter</kbd> chooses, <kbd>esc</kbd> closes.
- A command with choices goes on to them in the same list. `/effort` shows the thinking levels the model has, `/model` every model from every provider you connected, `/mode`, `/fast` and `/theme` theirs. The one in use is ticked and says **Current**. The arrow at the top goes back to every command.
- `/goal` and `/plan` take your own words. The list only suggests (**Clear the goal**, **Plan first**); <kbd>enter</kbd> sends what you typed.
- On a phone the list sits above the keyboard, with rows big enough for a thumb and **✕** to close it.

## Which command wins

A name can mean four things. Conch tries them in this order:

1. One of Conch's own commands, above.
2. One of your commands: a prompt you saved in **Settings → Commands**, where `{{input}}` is replaced by what you type after the name.
3. One of your [skills](../features/skills.md), by name.
4. One of the provider's own commands, sent as it is.

Conch's newer commands (`/goal`, `/plan`, `/retry`, `/export` and the others added since) give way to a command or skill of yours with the same name, so nothing you made stops working. Where a provider has a command of the same name, Conch's is the one listed, and it hands over to the provider's when that does the job better: `/compact`, `/review` and `/init` with Claude Code or Codex.

## Every provider

Conch's commands work the same whichever model answers, because Conch does them itself.

- **`/clear`** starts the chat afresh: from that line on, your assistant reads nothing said above it, with every provider, and each provider starts a new session. Every message stays for you. The chat's goal stays, and so does what the chat is held to and what it has read. **Undo**, on the line and in the note, puts it back until you send something. `/new` starts a new chat instead.
- **`/goal`** says what the chat is for, like `/goal get the release notes for 2.4 written`. Your assistant keeps it in mind in every reply, through `/clear` and whichever model answers. It shows as one quiet line above the message box: press it for **Edit** or **Clear goal**. `/goal` alone shows it, `/goal clear` takes it away. In a new chat, it goes with your first message.
- **`/plan`** turns plan mode on or off. Your assistant reads and plans, changes nothing, and shows you its plan with **Start** and **Keep planning**. **Start** ends plan mode and the work begins, in the mode you had before. `/plan tidy up this folder` turns it on and asks in one go. Claude Code asks with its own plan; every other provider that can use Conch's tools asks the same way through Conch.

## In chat apps

The same commands work when you write to your assistant from [a chat app](../channels/index.md): Telegram, Slack, WhatsApp, Signal, iMessage, email and the rest. They come from the same list as the web app's, so they mean the same, with every provider, and never reach the model as typed.

<!-- conch:chat-commands -->

- **Choices are buttons.** `/model` shows the models of the provider you use, the one in use ticked, and **Other providers** a step away; tap one and it's done. `/effort`, `/fast`, `/mode` and `/plan` work the same way. Where an app has no buttons (WhatsApp, Signal, iMessage, email, SMS), the choices are numbered: reply with the number.
- **Words after the name work too:** `/model opus`, `/effort high`, `/fast off`, `/goal get the 2.4 notes out`, `/plan tidy up this folder`.
- **`/clear` has an Undo** under it, and `/undo` does the same, until you send something. `/undo` in a chat app takes back a clear; to put back files, open the chat in Conch.
- **`/plan`** turns plan mode on or off. When the plan is ready, it arrives as a message with **Start** and **Keep planning** (or reply `1` or `2`, `yes` or `no`).
- **`/goal`** before your first message goes with it, as in Conch.
- **A mistyped command** hears what you probably meant, with a button for it: `/modle` → **/model**.
- **Commands only Conch has** (`/export`, `/folder`, `/theme`…) say so, and where to find them.
- **Who may use which.** Anyone you let in can start afresh, clear, retry and stop in their own chat. What changes how Conch works (model, effort, mode, goal, plan, settings) is yours alone, typed in your private chat: someone else, a forward or a group can't. In a group, only `/new`, `/stop` and `/help` work.
- **The app's own menu.** Telegram lists the commands when you type `/`, and Discord offers them as its own commands. Teams lists ten in its menu. Slack keeps `/` for itself, so there they go after `/conch`: `/conch model`.

## Thinking effort

`/effort` takes one of these. A model only offers the levels it has.

<!-- conch:efforts -->
