---
title: Use Conch from other apps
nav: Other apps
description: Let Claude Desktop, Cursor or VS Code use your memory, skills, apps and Conch's browser, each only what you choose, and asking you first.
order: 4.7
---

Claude Desktop, Cursor, VS Code or any MCP app can use your memory, skills, apps and
Conch's browser: only what you tick, asking you in Conch before changing anything. It's in **Settings →
Access → Advanced**: **Apps that use Conch**.

## Connect an app in one press

1. Press **Pair an app**. Claude Desktop, Cursor and VS Code say whether they're on
   this computer.
2. Press **Connect** beside the app.
3. Tick what it may use. It starts with your memory and skills, which only look.
4. Press **Connect** and confirm it's you. Conch adds itself to the app's settings,
   keeping the old file beside it, with no key written there.
5. Quit and reopen the app. Conch is in its list of tools.

If it can't read the file, Conch shows the lines to add yourself.

## Any other app

**Pair an app**, then **Another app**: name it, tick what it may use, press **Pair**,
and paste the settings Conch shows (they start Conch's launcher).

For an app that can't start Conch, turn on **Give it a key instead** before **Pair**.
Conch shows the key once, with the address (also under **For developers**).

## What an app may use

| Tick                              | What the app gets                                                             |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Search what Conch knows about you | Your memories, found by meaning.                                              |
| Suggest things to remember        | It can suggest one. It waits for your OK in **What Conch knows**.             |
| Use your skills                   | It can list your skills and read one. It follows the instructions itself.     |
| Use Conch's browser               | A tab of its own. It asks you before each new site, as your assistant does.   |
| One of your apps                  | That app's tools, as you set them in **Apps**. Tools you turned off stay off. |

Never your passwords, files or terminal. **Change** beside the app changes what it may
use.

## When it asks you

These wait for your OK:

- sending, saving or changing something in one of your apps;
- opening a new site in the browser;
- acting after it read something from the web.

The question appears in the app's chat in Conch, and in notifications when they're on.
Most apps give up after about a minute; answer before, or ask again.

## See what it did

**What it did** beside the app opens its read-only chat in Conch: what it used, asked
and was told. It's in **Activity** too.

## Remove an app

Press **Remove** twice. Conch leaves the app's settings and access ends at once.

## From another computer

An app elsewhere reaches Conch only through [your own address](../start/server.md),
and only if you allow it:

1. Under **Apps that use Conch**, open **For developers** and turn on **Let apps on
   other computers in**.
2. Pair the app with **Give it a key instead**, and turn on **Let it in from another
   computer**.

Whoever has the key can use what you allowed, from anywhere: keep it like a password,
and remove the app when done. Your security checkup flags this while it's on.

## Good to know

- Another agent you let talk to yours, in
  [Settings → Agents](./agents.md#let-another-agent-talk-to-yours), is listed here too,
  paired and removed the same way.
- Conch has to be running for other apps to use it.
- Your connected apps work the same with every model the other app runs.
- Backups don't carry paired apps; connect them again on a new computer.
