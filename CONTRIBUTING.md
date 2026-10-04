# Contributing to Conch

Thanks for helping. Bug reports, fixes, new providers and chat apps, docs and
translations of tricky error messages into plain words are all welcome.

## Before you start

- **Small fixes:** open a pull request straight away.
- **Anything bigger** (a feature, a new dependency, a change to how things fit
  together): open an issue first so we can agree on the approach. Architecture
  changes start as a decision record in [docs/adr](./docs/adr).
- **Security problems:** don't open an issue. Follow [SECURITY.md](./SECURITY.md).

## Set up

You need Node 24 or newer.

```bash
corepack enable
pnpm install
pnpm dev:mock     # the app with a scripted provider and pretend chat apps: no model usage
```

`pnpm dev` runs the same against real providers. The full command list is in
[AGENTS.md § Commands](./AGENTS.md#commands).

## Make the change

[AGENTS.md](./AGENTS.md) is the manual, for people and coding agents alike. The
rules that shape most changes:

- **Nacre first.** Screens are built from [Nacre](./packages/nacre) components.
  If one is missing, add it there with a story and a test.
- **Every provider.** A feature works with all of them, or steps aside on purpose
  and says so.
- **Fix it before you ask.** Foreseeable failures heal themselves; a person is
  asked only for approvals that matter.
- **The docs move with the code.** If a change makes a page in
  [apps/docs/content](./apps/docs/content) untrue, fix the page in the same change.
- **Security is a review, every time.** Conch runs commands as the person using
  it. See [AGENTS.md § Security engineering](./AGENTS.md#security-engineering).

## Check it

```bash
pnpm check        # format, lint, types and tests: must pass
pnpm e2e          # journeys in a real browser, when you changed one
pnpm eval         # real models on the eval tasks, when you changed how models are driven
```

`pnpm eval` spends money: it runs only the models whose keys are in your
environment (and Claude Code or Ollama when you have them), never as part of
`pnpm check`. `pnpm eval --list` shows what would run; `--smoke`, `--models` and
`--tasks` run less. The report lands in `.evals/report.html`, compared with your
last run. See [ADR 0071](./docs/adr/0071-evals-on-every-model.md).

For UI changes, look at the affected stories in light and dark mode
(`pnpm storybook`, or `node scripts/snap.mjs <story-id>`).

## Send it

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(web): …`, `fix(server): …`, `docs: …`. Write `feat` and `fix` subjects in
  the words of the person using Conch: they become the release notes.
- Put anything a person must do after updating in a `BREAKING CHANGE:` footer.
- Keep a pull request to one logical change, and say what it changes and why.

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
