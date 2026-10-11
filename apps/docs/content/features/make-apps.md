---
title: Make an app
description: Say what you want, and Conch builds an app every model can use, that looks like Conch, and that you can share in one press.
order: 4.5
---

Ask Conch for an app in your own words, like "remember when I water my plants". It builds one in a chat and adds it to **Apps** when you say so. Every model can use it, and you can give it to anyone with Conch.

## Make one

1. Open **Apps** and press **Add your own**. It opens on **Describe it**.
2. Write what it should do in a sentence, or press an example under the box.
3. Press **Build it**. A chat opens and Conch starts building.

Or ask in any chat, or press **Make … with Conch** when **Find an app** finds nothing. Conch asks only what it can't guess; you watch it write, check and try each part, then a card appears under the reply.

## Add it

The card says what the app does and **what it can do**:

- **Keeps its own notes on this computer**, in its own data space only.
- **Reaches** and a list of websites, or **Reaches no websites**: the only places it can send to or fetch from.
- **Needs from you**: something only you have, like an API key, typed into the card. Your assistant never sees it.
- What it **looks up** and what it **changes**. Changes ask first until you say otherwise. In **Auto** they go ahead, even after the chat read something from outside, except paying, sending to other people or deleting, which still ask ([Permission modes](../reference/modes.md#auto)).

**Open the page** tries its page. **Add to my apps** adds it; only you can, never your assistant. The card then shows things to say to it, like "I watered the fern", and **Open** with the app's name.

## Use it

Talk as usual: "I watered the fern" goes to your plant diary without naming it.

- An app's page is a tile at the top of the sidebar and on its page in **Apps**. The top of the window shows where you are, like **Apps › Plant diary › Plants**; the app's name goes back to its page.
- Page buttons work when you press them. A page changing something without a press asks you first.
- Ask for something a switched-off app does, and the chat offers **Turn on**, then carries on.

## Why its page looks like Conch

Every app's page gets Conch's type, cards, light, dark and your colour, and can't opt out, so apps from different models look alike.

- It opens with its icon, name and one-line purpose on one line, however long the name.
- Conch draws every box you type in, choose from, tick or slide: lists get Conch's arrow, **Choose a file** is a Conch button, a colour is a Conch swatch.
- One column, the same on a phone and a desk.
- No browser-drawn or fake controls, so the keyboard, VoiceOver and your phone's pickers work.

Conch checks each page against these rules when it makes one. If one looks out of place, say so in the chat ("the heading sits oddly") and Conch fixes it.

## Give it a logo or a picture

An app's icon starts as a symbol on a colour. Ask in the chat for a logo ("use the Strava logo as its icon") or attach a picture ("make this its icon"). Conch finds the logo or uses your picture and shows it on a new card; press **Update** to keep it.

- It shows wherever the app does: its card in **Apps**, its page, the sidebar tiles and <kbd>mod+k</kbd>.
- PNG, JPEG or WebP, up to 512 KB; a square about 256 pixels across looks best. No SVG or moving pictures. If it can't be shown, the symbol is used.
- It's kept inside the app, so it goes along when you share.

## Change it

Ask in the chat where you made it ("also remind me when a plant hasn't been watered for a week") or press **Change it** on the app's page. A new card shows what's different; the app stays as it was until you press **Update**.

Conch keeps the last three versions: **Versions** on the app's page, then **Go back**.

## Share it

Press **Share** on the app's page, or ask in a chat: "put it on GitHub".

- **Publish on GitHub** puts it in a public repository under your account for anyone to add. The first time, Conch installs GitHub's app if needed and shows a short code to enter on GitHub. Publish again to send a new version.
- **Save as a file** gives you a `.conchapp` file to send any way.

Either way it carries your signature, so whoever adds it sees it's from you, and your later versions carry on. Only apps you made go out under your name; to share one you added, share the address you got it from.

## Add one someone made

- **From a link.** **Add your own → From a link**, then paste its GitHub page or `.conchapp` address. Or paste it in a chat: "add the app at github.com/ada/plant-diary".
- **From a file.** Drop a `.conchapp` file on **Apps**, or **From a link → Choose a file…**.
- **From the community.** Type in **Find an app**; apps shared on GitHub show under **From the community**. Press **Look**.

A repository with several apps lists them for you to choose. The preview shows what it does, what it can do, who made it, and why it can't be added if something is wrong.

- Adding asks you to confirm it's you, as for anything bringing in someone else's code.
- An app you didn't make starts at **Ask every time**, and its skills wait until you ask for them.
- If it replaces someone else's app of the same name, the preview says so, and none of the old one's settings, keys or notes carry over.

New versions of apps from GitHub show on their card and page, and in **Settings → Health → Updates** under **Apps you added**. **Look first** (or **See what changed**) shows what's different, any new website first, then **Update**. Nothing updates by itself.

## A provider or a chat app

An app can also bring a provider to answer your chats, or a chat app to talk on. Ask by name ("add Fireworks as a provider"); its card asks for the key and tests it first. See [Add any provider](../providers/any-provider.md) and [Add any chat app](../channels/any-chat-app.md).

## How it stays safe

A model wrote it, or a stranger shared it, so it always runs sealed off ([ADR 0061](../../../../docs/adr/0061-apps-you-make-share-and-add.md)):

- It reads its own files and notes, never your other files, keys or passwords.
- It can't run programs.
- It reaches only the websites the card showed, never your own network.
- Its page can't reach the internet, Conch or your data, only its own app.

Your other apps' rules apply too: **Ask before changes**, the switches under **What it does**, and the guard after reading something from outside. **Repair everything** checks each app is still what you added, and backups keep apps and their notes.

> [!NOTE]
> Sealing uses Node's built-in permissions (Node is what Conch runs on) to keep an app from your files and programs. The network is closed inside the app's process, not by the operating system: strong, but not an operating-system wall.

## Pages that remember and refresh

**Page preferences.** With `pageState: true` in the manifest, the card says the app remembers page preferences on this computer.

- `await conch.state.get('selected-day')`, `set(key, value)` and `delete(key)` store small JSON view state, not records or secrets.
- At most 64 KB a value; preferences and query results share 2 MB.
- They survive closing the page and restarting Conch. Changing account settings clears them.

**Cached reads.** A read-only tool (no `app.data` writes) can declare `cache: { maxAge: 60 }` (seconds, 15 to 86,400), and Conch saves its successful result.

- `await conch.query('read_diary', { date, section: 'summary' })` returns the usual tool result plus `at` (a timestamp in milliseconds) and `stale`.
- `{ mode: 'peek' }` reads saved data without fetching; `{ mode: 'refresh' }` forces a refresh.

For a page that loads by itself:

```js
const diary = conch.observe('read_diary', { date, section: 'summary' }, { every: 60 }, (result) => {
  if (!result.ok) {
    status.textContent = result.message;
    return;
  }
  render(result.json);
  status.textContent = result.error || (result.refreshing ? 'Updating…' : 'Up to date.');
});
// A refresh button calls diary.refresh(). Before selecting another date:
// diary.stop(); then observe the new input.
```

The observer shows saved results at once and refreshes stale ones, pauses while hidden and refreshes on return, updates when a changing tool (from the page or chat) invalidates its query, keeps the last good result and retries with backoff if a refresh fails, and stops when the page closes.

Use explicit dates for day-based queries, and update the observed input when the local day changes.

Lasting records belong in `app.data`. Writing them, sending messages or editing another service still needs an honest `changes: true` tool and its approval policy. Page storage can't reach another app's data, your files or the network.

## Testing with fake service responses

Write `fixtures.json` in the app folder:

```json
{
  "fixtures": {
    "today": {
      "settings": { "api_key": "pretend" },
      "responses": [
        {
          "url": "https://api.example.com/diary?date=2026-10-05",
          "method": "GET",
          "status": 200,
          "json": { "energy": 357 }
        }
      ]
    }
  }
}
```

Then call `app_try` with `fixture: "today"` and a realistic input for the tool.

- The test gets only those fake settings and exact responses, on fresh scratch data, never the network. An unmatched URL, method or body fails.
- Add cases for offline errors, missing records and invalid input. "Setup required" alone doesn't pass.
- Never put real credentials in fixtures.
