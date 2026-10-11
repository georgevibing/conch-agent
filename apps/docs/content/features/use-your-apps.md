---
title: Use your apps
description: Your assistant can look at your Mac's screen and click and type in the apps you let it, while a glowing edge shows it's working.
order: 5.5
---

Some things only happen in an app: a slide in Keynote, a list in Notes. Your assistant can look at the screen, then click, type and scroll while you watch. It's off until you turn it on, and Mac only for now.

## Turn it on

1. Open **Settings → This computer**.
2. Under **Use your apps**, turn on **Let Conch use your apps** (your agent's name in place of Conch).
3. Press **Open Screen Recording** and turn on Conch. Do the same with **Open Accessibility**.

Each row says **On** once macOS allows it. Running from a terminal? The rows name the app to allow instead. An old **node** entry in these lists can go.

## While it works

- A glowing edge goes around your screen, and a card at the top says what it's doing.
- The chat shows what it last saw and its step count.
- **Stop** on either card, or <kbd>mod+esc</kbd> anywhere, takes back control at once. In a browser, without the Conch app, **Stop** is in the chat only.

## What it asks, and what it never touches

- **Each app asks once per chat.** **Always** skips that app's question from then on, as does **Full trust**, unless the chat read something from the web or an email. Undo **Always** under **Use your apps**.
- **Never touched, and covered over in what it sees:** password managers, System Settings and security prompts, terminals, banking, payment and crypto apps, and Conch itself. It asks you to do those parts.
- **Read only** lets it look but not click or type.
- **Only while you're there.** Routines, background tasks and chats from your chat apps can't use it.
- **It checks in** after 60 steps. One chat uses the computer at a time.
- **Nothing it sees is kept** past the turn.

Text on screen could try to trick it, so it checks with you before it sends, buys or deletes anything. After it has looked at the screen, anything that could send your things out asks first too.

## When something's off

**Settings → Health → Repair everything** says when macOS still needs a switch, with a button to it.
