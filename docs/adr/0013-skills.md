# 0013 — Skills

- Status: accepted
- Date: 2026-09-29

## Context

People teach their agents the same things over and over: how they like a
weekly review, the checklist for a release, the tone of a status update.
Custom commands (`~/.conch/commands`) cover "a prompt I reuse"; they don't
cover "something you should know how to do, and notice when it's needed".

The industry has settled on one answer: **Agent Skills** (agentskills.io) — a
folder with a `SKILL.md` whose YAML front matter carries a `name` and a
`description`, and whose Markdown body holds the instructions, with optional
`scripts/`, `references/` and `assets/`. Claude Code, Codex, OpenClaw and
Hermes Agent all read it (research, Sept 2026):

- **agentskills.io** — `name` (1–64 chars, `a-z0-9` and single hyphens, equal to
  the folder name), `description` (≤ 1024, "what it does and when to use it"),
  optional `license`, `compatibility`, `metadata`, `allowed-tools`. Only name and
  description are loaded up front; the body is read when the skill is used.
- **OpenClaw** — the same, plus `user-invocable` and `disable-model-invocation`,
  `metadata.openclaw` gates, a `{baseDir}` placeholder, and descriptions kept to
  one line under 160 characters. Reads `~/.agents/skills`, `<workspace>/skills`
  and its own managed folders; injects `<available_skills>` into the prompt.
- **Hermes Agent** — the same core, `metadata.hermes.*` extras, a `# Title` as
  the body's first line, `${HERMES_SKILL_DIR}`, and category folders
  (`~/.hermes/skills/<category>/<name>/SKILL.md`).

So one file can serve every product, as long as we write the common core and
leave everyone else's extras alone.

## Decision

**Skills** are Agent Skills folders that Conch lets you create, find and use
with every provider.

### The format is the standard one, written conservatively

- Conch's own skills live in `~/.conch/skills/<name>/SKILL.md`.
- Front matter carries `name` and `description` only, plus
  `disable-model-invocation: true` for a skill you only want when you ask.
  The description is one line of at most 160 characters, which satisfies the
  strictest reader (OpenClaw). The title is the body's first `# Heading`, as
  Hermes writes it; without one it's derived from the name.
- Editing a skill rewrites only the keys Conch owns, line by line, and keeps
  every other key, comment and nested block exactly as it was — so a skill
  copied from OpenClaw or Hermes keeps its `metadata`. No YAML library: the
  keys we read are top-level scalars (plain, quoted, or `|`/`>` blocks), and a
  partial parser that preserves text is safer here than a parse-and-dump.
- `{baseDir}`, `${HERMES_SKILL_DIR}`, `${CLAUDE_SKILL_DIR}` and `${SKILL_DIR}`
  become the skill's folder when it's loaded.

### Writing one takes a paragraph

You write what the skill should do, in your own words. Conch writes the title
and the description — on the default provider's cheapest model, the same way it
names chats — in a fixed shape (1–4 word title in sentence case; "Does X. Use
when Y." in ≤ 160 characters) so every skill in the list reads alike. Both are
shown as they're written and can be changed; once you've edited a field Conch
never overwrites it. With no provider able to write them, Conch falls back to
the first line and first sentence, and says nothing went wrong.

### Skills you already have elsewhere

Conch also lists skills from the places other agents keep them:
`~/.agents/skills` (the shared folder), `~/.claude/skills`, `~/.openclaw/skills`
(+ `workspace/skills`) and `~/.hermes/skills`. They are read-only in Conch;
"Make a copy" puts one in `~/.conch/skills` to edit. `CONCH_SKILL_SOURCES=off`
turns discovery off (tests and E2E do).

### Using them, with any provider

Every skill has a mode: **Automatically** (the model may pick it when a request
matches), **When I ask** (only by name), or **Off**.

- Automatic skills are listed in the system prompt as `<available_skills>`
  (name + description, within a budget). Engines that run Conch's tools load a
  skill with the `use_skill` host tool, which returns its instructions and the
  files it has (and can read one of them, inside the folder only); engines that
  can't (Codex) are given each skill's `SKILL.md` path to read themselves.
- `/name` in the composer, or picking a skill in ⌘K, uses it explicitly: the
  gateway expands the message into the skill's instructions plus what you
  typed, so it works the same for routines and every provider.
- Either way the chat shows a quiet "Used skill" pill (`skill.used`).
- A provider that loads a folder natively (Claude Code reads `~/.claude/skills`)
  isn't told about those skills twice.

## Security

A skill is persistent instructions, so it is treated like the persona and
custom commands, never like tool output:

- **Only a person creates or changes skills.** There is no agent tool that
  writes one (AGENTS.md security rule 7).
- **Skills found in other apps start Off.** Registries have shipped malicious
  skills (341 on ClawHub, Feb 2026); a folder appearing on disk must not start
  steering every chat. You read it in Conch and turn it on.
- **Paths are closed.** Names match the Agent Skills pattern before they become
  folders, every path goes through `safeJoin`, `use_skill` resolves a file with
  `realpath` and refuses anything outside the skill's folder (symlinks
  included), and reads are size-capped (256 KB for `SKILL.md`, 128 KB per file).
- Discovery is bounded: two folder levels, 500 skills per source, dot-folders
  skipped, and a broken `SKILL.md` is listed with its problem instead of failing
  the page.

## Consequences

- New: `~/.conch/skills/` and `~/.conch/skills.json` (modes for skills Conch
  doesn't own), routes under `/api/skills`, the `skills.changed` event, the
  `skill.used` conversation event, the `use_skill` host tool, and a Skills
  page (`/skills`, `/skills/new`, `/skills/:id`) reachable from the sidebar,
  `/skills` and ⌘K.
- Slash resolution becomes Conch → your commands → skills → the provider's own.
