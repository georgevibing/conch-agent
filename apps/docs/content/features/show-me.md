---
title: Show me
description: Ask for a chart, a page, a document, a diagram or a table, and it opens beside the chat to use and keep.
order: 8
---

Some answers aren't a paragraph. Ask for a tip calculator, a chart of last week's numbers or a trip plan, and your assistant makes it as a thing of its own. It opens beside the chat, where you can use it, change it and come back to it.

## Ask for one

Say what you want: "chart my spending by month", "make me a tip calculator", "draw how the sign-in works". Your assistant picks the kind:

- **Page**: a small app, or a page you can use.
- **Document**: something to read and keep.
- **Chart** and **Table**: your numbers, drawn or in rows.
- **Diagram** and **Picture**: how something works, or a drawing.

A card appears in the chat and the panel opens beside it. On a phone it slides over the chat. Close the panel when you're done, and press **Open** on the card to bring it back.

The card for a chart, a table, a diagram or a picture shows a small picture of it, right in the chat, so you can see what was made without opening anything. It's only to look at: press anywhere on the card to open it beside the chat. Pages and documents open to be seen.

## Use it and change it

The panel has three tabs. **View** is the thing itself, called **Use** for a page. **Code** is its text. **Changes** shows what is different from the version before.

To change it, ask in the chat: "make the bars horizontal", "add a total row". Each change is a new version, and the version picker takes you back to any of them. Conch keeps up to 30 versions, the first one always.

## Change it yourself

Press **Edit**. The code opens beside the thing itself, which changes as you type. On a phone, or when the panel is narrow, switch between **Edit** and **Preview**.

- If something doesn't fit, it says what and where, like "Line 3 has 3 values, but the header has 2." **Save** waits until it's fixed.
- **Undo** and **Redo** are beside the code. <kbd>mod+s</kbd> saves, <kbd>esc</kbd> cancels.
- What you save is a new version marked **Edited by you**, with its **Changes**. Your assistant knows the newest version is yours, so its next change starts from it.
- Close the panel or go to another chat, and your unsaved edit waits for you. **Cancel** asks before throwing it away.
- If a newer version came in while you were editing, Conch says so. **Save mine as the newest** keeps yours.

A page you're editing runs sealed off too, exactly like a saved one.

## Live data

A page can show live numbers, like the weather, a price or whether a build passed. It says in its own code which sites it reads from. The first time it wants one, Conch asks: **Let "Weather now" read live data from api.open-meteo.com?** You see every address it reads there.

- It reads without your cookies or sign-ins. Where the address has a blank, the page can only pick from values it said in advance. It can't write in anything of its own.
- You're asked once per page and site. If a new version reads a different address, you're asked again.
- A site on this computer, like a program you're running, needs a second yes: **Let it read from this computer**.
- Above the page, the bar says when it last read: **Live · Updated 2 min ago**. **Update now** reads again. If a site doesn't answer, the bar says so and the page keeps what it had.
- **Reads from** lists the sites, and **Stop** takes one back. All of them are in **Settings → Security → Advanced → Live data in pages**.

A pinned app keeps showing live data.

At the top of the panel are **Copy**, **Download**, **Pin as an app** and **Full screen**. **Delete…** is under **More**. A chart switches between **Chart** and **Table**, so the numbers are one press away. A table sorts by any heading.

## Pin it as an app

**Pin as an app** puts it at the top of the sidebar under **Apps**, as an app tile on a page of its own, one press from anywhere. Right-click the tile, or press and hold it, to unpin it. Once you have more apps than fit, they're all behind **All apps** in the same place.

When the numbers have moved on, press **Refresh**. Your assistant gets fresh data and makes a new version. It does that in a chat of its own, which can only update that one thing. **Watch it refresh** opens that chat.

## Pages run sealed off

A page is code your assistant wrote, perhaps after reading a web page you don't trust. So Conch runs it sealed off:

- It can't see your cookies, your sign-ins or anything else in Conch.
- It can't load anything from the internet, or send anything there.
- It can't take you to another site. When a page wants to open a link, Conch shows the address and asks first.

A page with links or code that could take you elsewhere opens with its code off, until you press **Run it anyway**. Documents, charts, tables, diagrams and pictures are drawn by Conch itself, and load nothing from other sites. More in [Signing in and staying safe](../security/signing-in.md).

## Good to know

- <kbd>mod+k</kbd> finds anything made for you by name. See [Find anything](./find.md).
- **Activity** in the sidebar has a **Made** filter.
- A page never reaches the internet by itself. It reads only through Conch, from sites you allowed. **Refresh** still asks your assistant for a new version.
- Deleting one removes every version. The chat it was made in stays.
- They are in your [backups](../care/backups.md), with your chats.
