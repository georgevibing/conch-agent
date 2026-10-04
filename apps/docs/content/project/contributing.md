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
pnpm eval         # the same tasks on real models, side by side: costs money
```

`pnpm dev:mock` uses no model at all, so it's the place to work on screens.

## On every model

`pnpm eval` gives about ten real models the same tasks: fill a form, find something two pages into a site, use an app, remember something for a new chat, ask you a question, read a number drawn on a page, hand over a sign-in, upload a file, a thirty-step job, an app with a messy tool, and a chat that changes model halfway. Code checks every answer, and the report shows each model's passes, steps, tokens, cost and time, next to the run before, with anything that got worse at the top.

It runs only the models whose keys are in your environment (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` and the rest), plus Claude Code and a model on this computer if you have them, each in a throwaway Conch that never touches yours. `pnpm eval --list` says what would run, `pnpm eval --smoke` runs a cheap few, and `--models` and `--tasks` pick. It spends money, so it isn't part of `pnpm check`; it also runs every night. [Why it works this way](../../../../docs/adr/0071-evals-on-every-model.md).

## Where things are

| Folder                  | What's in it                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `apps/web`              | The app you chat in                                                  |
| `apps/server`           | Conch itself: providers, apps, the browser, channels and the rest    |
| `apps/docs`             | These pages, and the front page                                      |
| `packages/nacre`        | The design system, with its Storybook                                |
| `packages/protocol`     | Every message between the app and Conch, as schemas both sides check |
| `e2e`                   | Journeys run in a real browser                                       |
| `apps/server/src/evals` | The same tasks on real models (`pnpm eval`)                          |
| `docs/adr`              | Why things are the way they are                                      |

## The rules

[AGENTS.md](../../../../AGENTS.md) is the manual, for people and for coding agents alike. The ones that shape everything:

- **Nacre first.** A screen is made of [Nacre](./nacre.md) components. If one is missing, it's built there, with a story and a test.
- **Every provider.** A feature works with all of them, or steps aside on purpose and says so.
- **Fix it before you ask.** What can be foreseen heals itself. A person is asked only for approvals that matter.
- **Decisions are written down.** A change to the architecture starts as a record in [Decisions](./decisions.md).
- **Security is a review, every time.** Conch runs commands as you.

## Sending a change

Small fixes can go straight to a pull request. For anything bigger, open an issue first so the approach is agreed before the work. Commits follow Conventional Commits, and `feat` and `fix` subjects are written in the words of the person using Conch, because they become the release notes. [CONTRIBUTING.md](../../../../CONTRIBUTING.md) has the details, and contributions are under the [MIT License](../../../../LICENSE).

A security problem goes through [private reporting](../../../../SECURITY.md), never an issue.

## These pages

Guides are Markdown in `apps/docs/content`. Everything the code can list (providers, channels, commands, settings) is read from the code when the pages are built, so it can't fall behind. A test fails when a provider or channel has no page, or a link leads nowhere. [How to write a page](../README.md).
