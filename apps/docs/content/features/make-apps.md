---
title: Make an app
description: Say what you want in your own words, and Conch builds it into an app that every model can use, that looks like Conch, and that you can share in one press.
order: 4.5
---

When none of your apps does what you need, ask Conch to make one. Say what it should do, in your own words: "remember when I water my plants", "check if my train is late", "keep a reading list". Conch builds it in a chat, shows it to you, and adds it to **Apps** when you say so.

An app you make is like any other app in Conch. Every model you use can use it. It can have a page of its own, which looks like Conch in light and dark. And you can give it to anyone with Conch.

## Make one

1. Open **Apps** and press **Add your own**. It opens on **Describe it**.
2. Write what it should do. A sentence is enough. The examples under the box fill it in for you.
3. Press **Build it**. A chat opens, and Conch starts building.

You can also ask in any chat: "can you make me an app that keeps track of what I spend on coffee?". Or type what you want in **Find an app**, and press **Make … with Conch** when nothing matches.

Conch builds first, and only asks what it can't sensibly guess. You see it write the app, check it and try each part of it. When it's ready, a card appears under the reply.

## Add it

The card says what the app does, and **what it can do** in plain words:

- **Keeps its own notes on this computer.** Each app has a place for its own data, and nothing else.
- **Reaches** and the names of websites, or **Reaches no websites**. These are the only places it can send or fetch anything.
- **Needs from you**, when it needs something only you have, such as an API key. Type it into the card. Your assistant never sees it.
- What it **looks up** and what it **changes**. Changes ask first, until you say otherwise.

Press **Open the page** to try its page first. Press **Add to my apps** when you're happy. The card then shows a few things to say to it, such as "I watered the fern", and **Open** with the app's name.

Nothing is added until you press the button. Your assistant can make an app and show it to you, but only you can add it.

## Use it

Talk to your assistant as you would anyway. It knows the apps you have and what each one is for, so "I watered the fern" goes to your plant diary without you naming it.

An app with a page has it in the sidebar, under **Pinned**, and on its page in **Apps**. Buttons in the page work at once when you press them. If a page tries to change something without a press, Conch asks you first.

Switched an app off? Ask for something it does, and the chat offers it back with **Turn on**, then carries on.

## Change it

Ask in the chat where you made it: "also remind me when a plant hasn't been watered for a week". Or press **Change it** on the app's page. Conch shows a new card with what's different, and **Update**. Until you press it, the app stays as it was.

Conch keeps the last three versions. To go back to one, open **Versions** on the app's page and press **Go back**.

## Share it

Press **Share** on the app's page, or ask in a chat: "put it on GitHub".

- **Publish on GitHub** puts the app in a public repository under your GitHub account, ready for anyone to add. The first time, Conch installs GitHub's app if it needs to, and shows you a short code to enter on GitHub. It carries on by itself once you have. Publish again after a change, and the new version goes up.
- **Save as a file** gives you a `.conchapp` file to send any way you like.

Either way, the app carries your signature, so whoever adds it sees it's from you, and later versions from you carry on. Only apps you made can go out under your name: to share one you added, share the address you added it from.

## Add one someone made

- **From a link.** Press **Add your own**, choose **From a link**, and paste the address of the app's page on GitHub, or of a `.conchapp` file. Or paste the address into a chat: "add the app at github.com/ada/plant-diary".
- **From a file.** Drop a `.conchapp` file on **Apps**, or choose **From a link → Choose a file…**.
- **From the community.** Type in **Find an app**. Apps people have shared on GitHub show under **From the community**. Press **Look**.

Before you add it, Conch shows what it does, what it can do, who made it, and why it can't be added if something is wrong. Adding it asks you to confirm it's you first, as Conch does before anything that brings someone else's code in. An app you didn't make starts at **Ask every time**, and its skills wait until you ask for them. If it takes the place of an app with the same name from someone else, the preview says so, and nothing of the old one (its settings, keys or notes) carries over.

A repository can hold several apps. Conch lists them all, and you choose.

When an app you added from GitHub has a new version, its card and its page say so, and so does **Settings → Updates** under **Apps you added**. Press **Look first** (or **See what changed**) to read what's different, with any new website first, then **Update**. Nothing updates by itself.

## How it stays safe

An app is something a model wrote, or something a stranger shared. So it runs sealed off, every time:

- It can read its own files and keep its own notes. It can't read your other files, your keys or your passwords.
- It can't run programs.
- It can only reach the websites the card showed you, and never your own network.
- Its page can't reach the internet, Conch or your data. It can only use its own app.

Everything else your apps follow applies to it too: **Ask before changes**, the switches under **What it does**, and the guard after reading something from outside. **Repair everything** checks that each app is still what you added, and backups keep your apps and their notes.

> [!NOTE]
> Sealing uses the permission system built into Node, the program Conch runs on. It keeps an app away from your files and programs. On today's Node it also keeps an app off the network by closing every way to it inside the app's process, rather than in the operating system. That's strong, but it isn't a wall the operating system holds.
