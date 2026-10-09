---
title: The app manifest
description: Every field of conch-app.json, including the provider and the chat app a Conch app can bring, with a small example of each.
---

A Conch app is a folder with `conch-app.json` in it. Conch makes it for you when you [make an app](../features/make-apps.md), [add any provider](../providers/any-provider.md) or [add any chat app](../channels/any-chat-app.md). This page is for reading one, or writing one by hand.

## The fields

| Field          | What it is                                                                               |
| -------------- | ---------------------------------------------------------------------------------------- |
| `conch`        | The format, `1`.                                                                         |
| `id`           | Lowercase letters, numbers and single dashes, 2 to 24 characters.                        |
| `name`         | At most 40 characters, in sentence case.                                                 |
| `tagline`      | What it does, at most 80 characters.                                                     |
| `description`  | At most 600 characters.                                                                  |
| `version`      | Like `1.0.0`.                                                                            |
| `icon`         | `{ "glyph", "color" }`, from Conch's own glyphs and colours.                             |
| `kind`         | Where it sits in Apps.                                                                   |
| `tools`        | Its code: tools, and a provider's or chat app's functions. Like `tools.mjs`.             |
| `pages`        | Up to 4 pages: `[{ "id", "title", "file" }]`.                                            |
| `reaches`      | The websites its code may reach: exact names, https only, at most 10. Shown on its card. |
| `settings`     | What it needs from you, like an API key, at most 8.                                      |
| `instructions` | For the assistant: when to use it.                                                       |
| `examples`     | Things you might say to use it.                                                          |
| `provider`     | A provider it brings: what answers chats. See below.                                     |
| `channel`      | A chat app it brings, for **Talk to me here**. See below.                                |

## A provider

Most companies need no code: an address, how the key travels, and the models.

```json
{
  "conch": 1,
  "id": "fireworks",
  "name": "Fireworks AI",
  "tagline": "Fast open models, in every chat",
  "version": "1.0.0",
  "icon": { "glyph": "zap", "color": "violet" },
  "reaches": ["api.fireworks.ai"],
  "provider": {
    "speaks": "openai",
    "address": "https://api.fireworks.ai/inference/v1",
    "key": { "label": "Fireworks API key", "link": "https://fireworks.ai/account/api-keys" },
    "models": [
      {
        "id": "accounts/fireworks/models/llama4-maverick-instruct-basic",
        "name": "Llama 4 Maverick",
        "price": { "input": 0.22, "output": 0.88 }
      }
    ]
  }
}
```

| Field     | What it is                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `speaks`  | `openai` (everything before `/chat/completions`), `anthropic` (before `/v1/messages`), or `code`.                   |
| `address` | Where it answers, over https. Its host must be in `reaches`. Not for `code`.                                        |
| `auth`    | `bearer` (the usual), `header` with `"header": "x-api-key"`, or `none`.                                             |
| `key`     | What you type: `label`, `help`, `link`, `pattern`, `optional`. Kept by Conch, never in the app.                     |
| `models`  | Its models, with `name`, `context`, `tools`, `images`, `thinking` and `price` per million tokens. Empty: read live. |
| `small`   | A cheap model of its own, for small jobs like naming chats.                                                         |

With `"speaks": "code"`, the app's code exports `provider.chat`. It gets the chat in OpenAI's shape and your key as `app.keys.key`, streams its answer with `app.emit`, and reaches only the sites in `reaches`.

## A chat app

A chat app is code: who the bot is, the messages it gets, and sending one.

```json
{
  "conch": 1,
  "id": "zulip",
  "name": "Zulip",
  "tagline": "Talk to your assistant on Zulip",
  "version": "1.0.0",
  "icon": { "glyph": "message-circle", "color": "teal" },
  "tools": "channel.mjs",
  "reaches": ["yourteam.zulipchat.com"],
  "channel": {
    "receives": "poll",
    "fields": [{ "key": "apiKey", "label": "The bot’s API key" }],
    "steps": ["In Zulip, open Personal settings → Bots and press Add a new bot."]
  }
}
```

| Field      | What it is                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `name`     | What the chat app is called, when it isn't the app's name.                                              |
| `receives` | `poll`: Conch asks for new messages from this computer. `webhook`: the app delivers to the public door. |
| `fields`   | What you type to connect it, at most 6. Secret unless `"secret": false`.                                |
| `steps`    | What to press in the chat app, one sentence each.                                                       |
| `buttons`  | `true` when it can show buttons; otherwise questions get numbered answers.                              |

Its code exports `channel.identify`, `channel.poll` (or `channel.receive`) and `channel.send`, and gets what you typed as `app.keys`. It can't read chats, use tools or see any other key.
