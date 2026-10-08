---
title: Use Conch from other apps
nav: Other apps
description: Let Claude Desktop, Cursor or VS Code use your memory, skills, apps and Conch's browser, each only what you choose, and asking you first.
order: 4.7
---

Conch can lend what it knows and what it can reach to the other apps you use. Claude Desktop, Cursor, VS Code, or any app that speaks MCP, can then search your memory, use your skills, work in your apps and use Conch's browser. Each app uses only what you tick, and anything that changes something asks you first, in Conch.

It's in **Settings → Other apps**.

## Connect an app in one press

1. Open **Settings → Other apps**. Claude Desktop, Cursor and VS Code are listed, and each says whether it's on this computer.
2. Press **Connect** beside the app.
3. Tick what it may use. It starts with your memory and your skills, which only look.
4. Press **Connect**, and confirm it's you. Conch adds itself to that app's settings, and keeps the old copy of the file beside it.
5. Quit the app and open it again. Conch is in its list of tools.

Nothing else in the app's settings changes, and no key is written there. If Conch can't read the file, it leaves it as it is and shows the lines to add yourself.

## Any other app

Press **Another app**, give it a name, tick what it may use, and press **Pair**. Conch shows the settings to paste into that app. They start Conch's launcher, which most apps can do.

An app that can only connect over HTTP gets a key instead. Turn on **It connects over HTTP, with a key** before you press **Pair**. Conch shows the key once, with the address to use.

## What an app may use

| Tick                              | What the app gets                                                             |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Search what Conch knows about you | Your memories, found by meaning.                                              |
| Suggest things to remember        | It can suggest one. It waits for your OK in **What Conch knows**.             |
| Use your skills                   | It can list your skills and read one. It follows the instructions itself.     |
| Use Conch's browser               | A tab of its own. It asks you before each new site, as your assistant does.   |
| One of your apps                  | That app's tools, as you set them in **Apps**. Tools you turned off stay off. |

An app gets nothing you didn't tick, and never your passwords, your files or your terminal. You can change what it may use at any time with **Change**.

## When it asks you

An app asks the way your assistant does. Sending, saving or changing something in one of your apps waits for your OK. So does opening a new site in the browser, and acting after it read something from the web.

The question appears in that app's own chat in Conch, and Conch tells you, on your devices too when notifications are on. The app waits while you decide. Most apps give up after a minute or so. Answer before then, or ask again in the app.

## See what it did

Each paired app has its own chat in Conch, **What it did**. It lists each thing the app used, what it asked you, and what you said. You can't write in it, because it's the app's log. Everything it did is in **Activity** too.

## Remove an app

Press **Remove** beside it. Conch takes itself out of the app's settings, and the app can't use Conch any more, at once.

## From another computer

An app on another computer can reach Conch only through [your own address](../start/server.md), and only if you allow it:

1. Turn on **Let apps you mark in through your address** in **Settings → Other apps → From your own address**.
2. Pair the app with **It connects over HTTP, with a key**, and turn on **It may come in through your address**.

Whoever has that app's key can then use what you let it use, from anywhere. Keep it like a password, and remove the app when you stop using it. Your security checkup says while this is on.

## Good to know

- Another agent you let talk to yours, in [Settings → Agents](./agents.md#let-another-agent-talk-to-yours), is listed here too, as **Talking to your agents**. It's paired the same way, and removed the same way.
- Conch has to be running for other apps to use it.
- The apps an app can use are the ones connected in Conch, so they work the same with every model that app runs.
- A backup doesn't carry paired apps. On a new computer, connect them again.
