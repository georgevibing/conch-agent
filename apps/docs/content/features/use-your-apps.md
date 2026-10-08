---
title: Use your apps
description: Your assistant can look at your Mac's screen and click and type in the apps you let it, while a glowing edge shows it's working.
order: 5.5
---

Some things only happen in an app on your computer: a slide in Keynote, a list in Notes, a setting in an app with no website. Your assistant can do those for you. It looks at the screen, then clicks, types and scrolls like you would, while you watch.

It's off until you turn it on, and it works on a Mac for now.

## Turn it on

1. Open **Settings → This computer**.
2. Under **Use your apps**, turn on **Let Conch use your apps**.
3. macOS asks you to allow two things. Press **Open Screen Recording**, then turn on Conch in the list. Do the same with **Open Accessibility**.

Each row says **On** by itself once macOS allows it. You don't need to come back and press anything.

If you run Conch from a terminal instead of the Conch app, the rows say which app to turn on in the list (Terminal, for example).

## While it works

- A soft glowing edge goes around your screen, and a small card at the top says what it's doing.
- In the chat, a card shows what it last saw, and how many steps it has taken.
- Press **Stop** on the card at the top of the screen, **Stop** in the chat, or <kbd>mod+esc</kbd> from anywhere. It lets go at once.

The glowing edge and <kbd>mod+esc</kbd> come with the Conch app. In a browser, **Stop** is in the chat.

## What it asks, and what it never touches

- **Each app asks once per chat.** "Use Notes on your computer?" Choose **Always** and it won't ask about that app again, unless the chat has read something from the web or an email. Apps you always allow are listed under **Use your apps**, to take back any time.
- **It never touches** password managers, System Settings and the Mac's password prompts, terminals, banking and payment apps, or Conch itself. It doesn't see them either: they're covered over in what it looks at. When something needs one of them, it asks you to do that part.
- **Plan only** lets it look at the screen, but not click or type.
- **It stops to check in** after 60 steps in one go.
- **One chat at a time** uses the computer.
- **Nothing it sees is kept.** The last look at your screen stays in memory until the turn ends, then it's gone.

Something it reads on the screen could try to trick it, like a page or an email can. That's why it asks before using each app, and it's told to check with you before it sends, buys or deletes anything. Once it has looked at the screen, anything else that could send your things out asks first too.

## When something's off

**Settings → Health → Repair everything** says when macOS still needs one of the two switches, with a button that takes you to it.
