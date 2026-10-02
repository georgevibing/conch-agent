---
title: Working on Conch
description: Run it from a checkout, change it, and check your work. The rules are few, and tests enforce them.
order: 4
---

## Run it

You need Node 24 or newer.

```bash
corepack enable
pnpm install
pnpm dev          # the app on :5173 with hot reload, Conch on :4317
pnpm dev:mock     # the same, with a scripted provider and pretend chat apps
pnpm storybook    # every Nacre component, on :6006
pnpm docs:dev     # these pages and the front page, on :4400
pnpm check        # format, lint, types and tests: before every commit
pnpm e2e          # whole journeys in a real browser
```

`pnpm dev:mock` uses no model at all, so it's the place to work on screens.

## Where things are

| Folder              | What's in it                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `apps/web`          | The app you chat in                                                  |
| `apps/server`       | Conch itself: providers, apps, the browser, channels and the rest    |
| `apps/docs`         | These pages, and the front page                                      |
| `packages/nacre`    | The design system, with its Storybook                                |
| `packages/protocol` | Every message between the app and Conch, as schemas both sides check |
| `e2e`               | Journeys run in a real browser                                       |
| `docs/adr`          | Why things are the way they are                                      |

## The rules

[AGENTS.md](../../../../AGENTS.md) is the manual, for people and for coding agents alike. The ones that shape everything:

- **Nacre first.** A screen is made of [Nacre](./nacre.md) components. If one is missing, it's built there, with a story and a test.
- **Every provider.** A feature works with all of them, or steps aside on purpose and says so.
- **Fix it before you ask.** What can be foreseen heals itself. A person is asked only for approvals that matter.
- **Decisions are written down.** A change to the architecture starts as a record in [Decisions](./decisions.md).
- **Security is a review, every time.** Conch runs commands as you.

## These pages

Guides are Markdown in `apps/docs/content`. Everything the code can list (providers, channels, commands, settings) is read from the code when the pages are built, so it can't fall behind. A test fails when a provider or channel has no page, or a link leads nowhere. [How to write a page](../README.md).
