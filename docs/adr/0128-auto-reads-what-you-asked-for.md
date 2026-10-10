# 0128 — Auto reads what you asked for

- Status: accepted
- Date: 2026-10-10
- Builds on: [ADR 0100](./0100-permission-modes-every-provider.md) (the ladder, Auto's risk
  policy, the second look), [ADR 0117](./0117-auto-asks-about-what-matters.md) (Auto asks about
  what matters; a push the person asked for), [ADR 0118](./0118-auto-judges-every-app-step.md)
  (Auto is Conch's own on every provider), [ADR 0119](./0119-four-modes-auto-by-default.md)
  (four modes, Auto by default), [ADR 0030](./0030-undo.md) (Undo keeps the work folder)
- Amends: ADR 0117's "`asked` takes away only the point for what the chat read" and "Severe
  steps still ask: a force-push, deleting a branch others share, a mirror"; ADR 0100's "the
  second look can only add a question", its tier for non-production infrastructure, a new
  remote, a pushed image and an assistant's own permission files; ADR 0100's row for Claude Code

## Context

An audit of Auto against the agents people compare it with (2026-10-10: Claude Code's auto
mode, Codex's approvals and reviewer, OpenClaw's exec approvals) found the baseline at least as
permissive as theirs, and the shape, deterministic rules first and a small model only after
reading, the same as Codex's and OpenClaw's. What it lacked was what people call intelligence:
Auto read the person's own words for two steps only, a push and a merge (ADR 0117). Claude Code
reads them for every soft block: "force-push this branch", "deploy to staging", "delete the old
stack" clear the block when the message names the action and the thing that makes it dangerous,
and "don't push" holds a push that would otherwise go, until a later message lifts it. Its
second stage clears a block for work that plainly serves the request. Its allow list includes
installs declared in the project's manifests. It checks `git status` before judging a command
that would discard changes. And it pauses auto mode after repeated blocks, offering to learn
the environment, which Conch had no answer to beyond Always allow for one chat.

Conch's scoring also let a few things through before reading that Claude Code blocks outright,
each scoring two: a non-production deploy or cluster change (severe but "undoable"), a new or
repointed remote, a pushed image, and writing another assistant's own permission files.

## Decision

### Every kind of step can be asked for, except the few that can't

Each risk now carries a **wish**: the words a person says to ask for that very step, and the
names their message must carry (`Risk.wish`, `Wish`). A rule names its own (`gitRisk`,
`infraRisk`, `installRisk`, `rmRisk`, `publishRisk`, the egress and tunnel rules, an app's step
that speaks for the person); every other risk takes its kind's words (`WISHES`). The names are
what Claude Code calls the specifics: the branch of a force-push or a deleted branch, the
package of an install, the host a `curl -d` or an `scp` sends to, the remote or its host, the
basename of a file deleted outside the work folder, and the word _production_ for anything
production (`PROD_WORDS`).

`wanted(risk, said)` reads the person's own messages (`RiskContext.said`, empty with someone
else's words in the chat, in a routine, or with nobody there), and the latest message that
mentions the act decides:

- said not to, or not yet ("don't push yet", "without deploying", "no deploys until I say"),
  and nothing about it since: the step is **held**;
- asked for in the latest message, with every name it needs: the step is **asked**;
- mentioned earlier only ("push it", then "now tidy the README"): neither. An approval is
  one message; a boundary lasts until a later message about the same act.

The score (`riskScore`) is now harm + lasting + what the chat read + a boundary stated (one
point each). **A step the person asked for scores two at most**, so it goes ahead before and
after reading, as Claude Code clears a soft block the person named. That lifts what ADR 0117
kept: a force-push of the branch the person named, a deleted branch they named, a mirror they
asked for. What no words ask for keeps its score (`NEVER`, `askable`): keys read or sent, a
project's `.env` or every setting leaving, code decoded from a blob, a key or a token sent to an
app, money, `authorized_keys` and sudoers, an assistant's own permission files, a look-alike
package name, a push anywhere but the repository's own remote, and the circuit breaker. A
download piped to a shell is the person's to ask for only when they named its host
("install it with the script at get.example.sh"); a page saying so is not them.

### The second look lifts a question too

The second look (`risk-look.ts`) answers as it is now (`judgeCommand`: risky with the card's
words, or not risky, or couldn't look). After reading, in Auto, when the rules would ask about
a command only because of what the chat read (the score is under three without that point), the
command goes to the look with the person's last words, and **not risky lifts the question**
(`serves` in the manager): the rubric already says routine work in service of the request is
never risky, and a send-out to a destination the person didn't name is. This is Claude Code's
second stage: its classifier clears a soft block for work the person asked for, judging the
action against the request with tool results stripped. The look still only ever adds a question
for a command the rules found nothing in. It never lifts a step that asks whatever was read, one
the person said not to do, or anything when nothing could look: without a small model, the
question stands.

### What the project declares is well known

`installRisk` reads the work folder's manifests (`packages.ts` `declared`: `package.json`,
`pyproject.toml`, requirements files, `Pipfile`, `Cargo.toml`, `go.mod`, `Gemfile`, `Brewfile`,
cached by modification time): a package the project lists installs without a word, before and
after reading, as Claude Code allows installs declared in the manifests. A look-alike name asks
whatever the manifest says.

### Someone else's systems ask before reading, unless named

Four kinds of step now score three before reading, so they ask unless the person asked for them
in their own words, as Claude Code blocks them unless named:

- a change to cloud infrastructure, a cluster or a deployed app, production or not
  (`terraform apply`, `kubectl apply`, `helm upgrade`, `gcloud run deploy`, `fly deploy`,
  `vercel`): lasting, since Conch can't take a deploy back;
- a new or repointed remote (`git remote add`, `set-url`): where pushes go;
- an image pushed to a registry (`docker push`): for others to pull;
- writing another assistant's own permission files (`.claude/settings.json`, `.mcp.json`,
  Codex's, Gemini's, Cursor's): no words lift this one. It is the one way an assistant raises
  its own powers by a file it writes, and it is rare enough in routine work to cost nothing.

### Nothing to lose, nothing to ask

Before judging `git reset --hard`, `git clean -f`, `git checkout .` or `git restore .`, the
manager asks git whether the repository (the work folder, or the one `git -C` names) has staged,
changed or untracked files (`tree.ts`, once per folder per turn, three seconds at most). A clean
tree is nothing to ask about, before or after reading. A dirty or unknown one is judged as
before: severe but undoable (Undo keeps the work folder's files), so it asks after reading
unless the person asked to discard.

### Always allow, in every chat

A class of step lifted with **Always allow** (ADR 0117) was one chat's. Now each lift is noted
(`lifts.ts`, `auto-lifts.json`, a derived file), and when a card asks about a class the person
already lifted in another chat, or asks for the third time in one turn, its button says
**Always allow, in every chat** (`permission.requested.always`). Pressing it keeps the class in
`preferences.autoAllowed`, which every chat honours (`lifted` in the manager), the restore
preview names (`auto-never-asks`, ADR 0020), and **Settings → Security → Safety** lists with an
× that makes Auto ask again. The third question of a turn is Conch's answer to Claude Code's
pause after repeated blocks: repeated questions mean the policy lacks context, and the person's
answer is the context. Only a person's press grants it; nothing is learned by itself.

### Housekeeping

ADR 0100's provider table said Claude Code used its own classifier beside Conch's hook; since
ADR 0118 it runs as `default` and Conch answers. The row now says so.

## Consequences

- "Force-push my branch", "deploy it with fly", "delete the old stack", "install nginx with
  sudo", "send it to the team" go ahead in Auto before and after reading, with no card. The
  person has to name the thing that makes it dangerous: "push it" doesn't force-push, "apply the
  terraform" doesn't apply to production, "push to the gh-pages branch" names the branch.
- "Don't push yet", "no deploys today", "never send anything" hold, before reading too, until
  a later message says otherwise. Said earlier in the chat, a boundary still holds.
- After reading, a step the rules would ask about for that reason alone goes ahead when the
  second look sees it serves the request. The look's misses are the cost; what asks whatever was
  read is never in its hands.
- A dependency the project already lists installs without a word.
- A non-production deploy, a new remote or a pushed image asks before reading now, unless the
  person asked for it. Writing another assistant's permission files always asks.
- `git reset --hard` on a clean tree never asks.
- The corpus (`test/riskCorpus.ts`) gains `NAMED`, `ASKED`, `HELD` and `UNLIFTABLE`: what goes
  when asked for, what holds, and what nobody's words lift. The routine corpus still passes at
  0.0% before and after reading.
- Stored data: `permission.resolved.kept` gains an optional `everywhere`; `permission.requested`
  an optional `always`; preferences an `autoAllowed` list with a default. An older Conch ignores
  them (ADR 0051).

## Sources

Read 2026-10-10:

- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes): approvals
  you state in conversation ("name the action and its specifics"; "you can force-push" clears
  nothing), boundaries you state in conversation (block until lifted), `git status` run before
  a command that would discard work, the fallback after 3 blocks in a row or 20 in a session,
  installs declared in manifests allowed by default, `git remote add` and third-party
  repositories blocked unless named, modifying the agent's own permissions blocked.
- [Configure auto mode](https://code.claude.com/docs/en/auto-mode-config): the four tiers
  (hard deny, soft deny, allow, explicit user intent), `/auto-mode-setup` learning the
  environment from recent sessions.
- [Anthropic, "Claude Code auto mode"](https://www.anthropic.com/engineering/claude-code-auto-mode):
  the two-stage classifier, stage two clearing most false positives; 0.4% false positives and
  17% misses on real traffic, which is why the look never lifts what asks whatever was read.
- [OpenClaw exec approvals](https://docs.openclaw.ai/tools/exec-approvals): allowlist matches
  run, misses go to a reviewer that allows, denies or escalates to a person; `askFallback`
  denies with no one to ask.
- [Codex agent approvals](https://developers.openai.com/codex/agent-approvals-security): a
  reviewer only for actions that already need approval; tool output as untrusted evidence.
