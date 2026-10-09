---
title: Add any provider
description: Any model company Conch doesn’t list, made with Conch from its name, typed as an address, or added from a link someone shared.
after: servers
---

Conch lists the providers most people use. For anyone else, add your own: a company's API, a model at work, a service a friend uses. It becomes a provider like the others, in the model picker and in **Settings → Providers**.

## Make one with Conch

1. Open **Settings → Providers**. Under **Add your own**, type its name in **Which provider?**, like “Fireworks AI”, and press **Make it with Conch**. Or say it in any chat: “add Fireworks as a provider”.
2. Conch opens a chat, reads the company's own API documentation, and makes it. Most companies speak OpenAI's or Anthropic's chat, so it's only a few lines with no code.
3. A card appears under the reply. It says where its key goes, its models and what they cost. Paste your key into the card and press **Test it**: the provider answers one short line, and you see its first words.
4. Press **Add**. Its models join the picker.

The assistant never sees your key. You type it into the card, and Conch keeps it with your other keys.

## Any OpenAI-compatible address

If you know its address, choose **Any OpenAI-compatible address** under **Add your own**. It's the same as [Another server](servers.md): type the address, and Conch says what answered before anything is added.

## Add one from a link

Someone shared one? Choose **Add from a link** and paste the GitHub address, or the address of a `.conchapp` file. Conch shows what it is, who made it and where its key would go. Paste your key, press **Test it**, then **Add**.

## Good to know

- **It's a Conch app.** A provider you add this way is an app in **Apps**, marked **Made by you** or **Added from a link**. Change it, share it on GitHub, or take it away there. Taking it away takes its key too.
- **Its key goes to its own address only.** Conch sends it only to the sites its card shows, over https, and never to this computer or your own network.
- **Spending counts.** A provider that says what its models cost, per million tokens, is counted in a chat's spend and your monthly budget like any other.
- **Code only when it must.** A company with its own chat shape gets a little code, run sealed off: no files, no programs, only the sites on its card.
- **When it stops working,** often because the company changed its API, **Repair everything** offers **Ask Conch to fix it**. Conch reads the docs again and shows a new card; nothing changes until you press **Update**.
- See [The app manifest](../reference/app-manifest.md) for every field.
