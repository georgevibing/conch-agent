# 0031 — Skill trust: what a skill may do, who made it, sealed in every provider

- Status: accepted
- Date: 2026-10-01
- Builds on: [ADR 0013](./0013-skills.md) (skills),
  [ADR 0028](./0028-safe-hands.md) (the guard, sealed commands, skills read first),
  [ADR 0016](./0016-getting-what-a-feature-needs.md) (needs, Repair everything)

## Context

ADR 0028 reads every skill before it steers anything and pins another app's
skill when it's turned on. Three gaps were left:

- **A skill could do anything the mode allowed.** A note-taking skill in a Full
  trust chat could run any command. Agent Skills already has a way to say what
  a skill needs (`allowed-tools: Bash(git:*) Read`), and Claude Code honours it,
  but only inside Claude Code, and nothing showed it to a person.
- **Nobody could say who made a skill.** Every update to another app's skill
  turned it off (the ClawHavoc defence), even when it came from someone you
  trust. Skills you share had no way to carry your name.
- **Only Claude Code's commands were sealed.** Codex followed its own sandbox,
  whatever **Seal commands** said. Windows had no sealing, and nothing said so
  per provider.

## Decision

### 1. What a skill may do, held to while it's in use

`skills/permissions.ts` reads either form from the front matter into one short
list of capabilities:

- **Agent Skills' `allowed-tools`.** `Bash(git:*)` means commands, only `git`.
  `Edit`/`Write` mean files in the work folder, `WebFetch`/`WebSearch` the web,
  `mcp__linear__…` that app.
- **Conch's own `permissions:`.** `commands`, `commands:git`, `files`,
  `files-anywhere`, `web`, `browser`, `apps`, `apps:notion`, `passwords`.

The list is shown in words: "This skill can: run commands (only `git`), change
files in your work folder". It is on the skill's page (`SkillPermissionList`)
and in the dialog when you turn on one from another app or from a signer you
don't trust.

**A skill that says nothing** gets the usual list: files in the work folder and
the web. The page says that's what happened. Reading, searching and
remembering are never limited.

**While a skill is in use, it's held to its list.** A skill is in use when it's
loaded with `use_skill` or typed as `/name`; a `skill.used` event marks it.
Since [ADR 0040](./0040-skill-scope.md) the chat stays held to it in every
later turn, until you stop holding it. Every tool call goes through `mustAsk` in `conversations/manager.ts`
(Claude Code's PreToolUse hook, the API engines' permission broker, the
browser's per-site check). `needs()` says what the call requires; if a skill in
use doesn't `allow()` it, the call asks first, whatever the mode:

> The "Weekly review" skill is in use, and it doesn't say it needs to run this
> command. So I'm checking first.

Like the guard after reading, the question offers no "always", and earlier
"always allow" answers don't skip it.

**Command lists are checked piece by piece.** A command is split at `&&`, `||`,
`;`, `|`, `&`, newlines, backticks, `$(`, `<(` and `>`. Every piece must start
with an allowed prefix. `git status && curl …` isn't `git`, and neither is
`git log > ~/.zshrc`.

### 2. Who made a skill, provably

A signed skill has a `SKILL.sig` next to its `SKILL.md` (`skills/signing.ts`):

```json
{
  "v": 1,
  "alg": "ed25519",
  "name": "weekly-review",
  "hash": "<sha256 of the folder>",
  "publisher": { "name": "Ada Lovelace", "key": "<raw 32-byte key, base64url>" },
  "signedAt": 1790875523564,
  "sig": "<64 bytes, base64url>"
}
```

- **What's signed.** The signature is Ed25519 (RFC 8032, `node:crypto`) over
  `conch-skill-signature/1\n<name>\n<hash>`. The hash is the same folder
  fingerprint the review pins (`skillHash`), leaving out `SKILL.sig` itself.
  The domain line means a signature made for anything else never verifies
  here. The name means a signature can't be moved onto another skill.
- **What's accepted.** Only a raw 32-byte Ed25519 key. RSA, X25519, short or
  long keys, other `alg` values and unreadable files are all `invalid`.
- **Trust is in keys, not names.** You trust a publisher by its key's
  fingerprint (`SHA-256(key)`, 16 hex digits in fours), on purpose. This is
  trust on first use, chosen by you: never automatic, never from a backup
  without the preview naming them.
- **What the page says.**
  - `verified`: "Verified: signed by Ada Lovelace".
  - `untrusted`: who signed it, the key, and **Trust this publisher…**. It
    needs a recent password or key (`POST /api/skills/:id/trust-publisher`).
    The key trusted is the one in the signature that held, never one sent in.
  - `lookalike`: another key giving a name you trust, with a warning that
    someone may be pretending.
  - `invalid`: the reason, and the skill is **off**: never offered, not usable
    by `/name`, and it can't be turned on. Repair everything lists it.
  - `unsigned`: still works. Your own skills don't say "Not signed".
- **Updates.** An update signed by the publisher you trusted when you turned it
  on carries on. Anyone else's change still turns it off, signed or not. A
  `danger` review still wins.
- **Signing your own.** `pnpm conch skills sign <folder> [--as name]` makes
  your key the first time (`skills.signing.json`, 0600, sealed since ADR 0040), trusts it, and writes
  `SKILL.sig`. `skills key` shows the public key to share. `skills trust <key>
--as name`, `skills trusted` and `skills forget <fingerprint>` manage the
  list from the terminal; having it is the proof that it's you.
- **Where it's kept.**
  - `skills.trust.json` is kept in backups (group `skills`). A restore's
    preview names the publishers it would trust (`trusted-publishers`).
  - `skills.signing.json` is a secret in backups. Since
    [ADR 0040](./0040-skill-scope.md) it's sealed under the device key like
    Conch's other keys; the terminal command opens the device key the same
    way the gateway does.
  - Both are protected paths: the assistant's file and shell tools can't read
    or change them. Otherwise an assistant could vouch for its own skills.

### 3. Sealed commands in every provider, honestly

- **Claude Code.** Unchanged (ADR 0028): Seatbelt on macOS, bubblewrap on
  Linux.
- **Codex** now follows **Seal commands**. `engines/codex/engine.ts` `sealFor`
  passes Conch's lists as config overrides:
  - `sandbox_workspace_write.writable_roots` (the caches) and `network_access`;
  - from Codex 0.159, a permission profile (`default_permissions="conch"`,
    `permissions.conch.filesystem` with `"deny"` for where keys live,
    `permissions.conch.network`).

  Under a seal, Full trust is `workspace-write` with the network on. Tainted,
  or with a skill in use that doesn't say it may run any command, the network
  is off (Codex can't ask mid-step, so it runs tighter). This was verified
  with Codex 0.159.1's own sandbox: reading `~/.ssh` was denied, writing to the
  home folder was blocked, the caches were writable and the network worked.
  Older Codex, or a build whose version can't be read, gets only the legacy
  keys. Its notice and **Settings → Security → Safety** say "partly sealed:
  can still read where keys live", and Repair everything offers **Update
  Codex**.

- **API providers** run no commands; Safety says so.
- **Windows** can't seal yet. Claude Code's sandbox isn't there. Running
  commands in Docker was considered and rejected: Claude Code runs `Bash` on
  the host, so a container would only seal what we routed into it, and say
  more than is true. Safety shows "Not sealed: this computer can't seal its
  commands yet". `TurnInput.sandbox` is only passed where sealing exists, so
  nothing claims otherwise.

`GET /api/safety` carries `providers: [{ id, label, state, note }]` with
`sealed`, `partly`, `not-sealed` or `no-commands`, and Nacre `SealCoverage`
shows it.

## Consequences

- A skill's power is visible before you turn it on and holds while it's in
  use, in every mode and provider that can ask. A skill that asks for little
  stays quiet. One that reaches further asks, with its name in the question.
- Publishers you trust can ship updates without them being turned off. A
  stranger's re-signed copy, a swapped file, a replayed signature or a
  look-alike name can't ride on that trust (`skills/signing.test.ts`,
  `skills/trust.test.ts`).
- **Known limits.**
  - A chat is held to a skill's list from the turn it was loaded in until a
    person stops holding it ([ADR 0040](./0040-skill-scope.md)). This ADR
    first held it for that one turn only, though its words stay in the chat.
    Now every later turn is held, and so are helpers and tasks started from
    the chat, and a restart. Compaction, trimming and a provider change don't
    end it.
  - Your signing key is sealed under the device key (ADR 0040). This ADR
    first left it a plain 0600 file, because the terminal command runs
    without the gateway. The terminal now opens the device key the same way
    the gateway does, and a changed key fails closed.
  - Command prefixes are a fence, not a box: `git` can run other programs
    (aliases, `-c core.pager=…`). Sealing is what stops reaching keys.
  - Codex can't be asked mid-step. Skill limits there are tighter sealing,
    not questions.
  - Signing proves who signed, not that it's safe. The review, the prompts
    and the seal still stand.
