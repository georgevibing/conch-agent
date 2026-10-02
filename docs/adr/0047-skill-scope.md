# 0047 — Skill scope: held for the whole chat, and a signing key locked to this computer

- Status: accepted
- Date: 2026-10-02
- Builds on: [ADR 0031](./0031-skill-trust.md) (what a skill may do, signing),
  [ADR 0033](./0033-hand-it-off.md) (tasks and helpers),
  [ADR 0028](./0028-safe-hands.md) (the guard, Activity),
  [ADR 0025](./0025-passwords.md) (the device key, sealed key files),
  [ADR 0020](./0020-backups.md) (what's in a backup)

## Context

ADR 0031 left two gaps in its known limits.

- **A skill was held to its list only in the turn it was loaded in.** Its
  instructions stay in the chat after that: in Claude Code's and Codex's
  sessions, in an API provider's transcript, and in the replies it shaped. So
  a later turn could do what the skill never said it needed, steered by the
  same words. This is the indirect prompt injection pattern (Greshake et al.,
  2023): instructions that arrived once keep acting for as long as they're in
  context.
- **The signing key was a plain 0600 file.** Every other key Conch keeps is
  sealed under this computer's device key (ADR 0025). `skills.signing.json`
  wasn't, because `pnpm conch skills sign` runs without the gateway.

## Decision

### 1. A chat is held to every skill whose instructions are in it

**What starts it.** A `skill.used` event: a skill typed as `/name`, loaded with
`use_skill`, or carried in with work from another chat (`by: 'carried'`,
`from`). The event now records the skill's list as it was then
(`permissions`). That's the list the words in the chat were reviewed under, so
widening the skill later, or deleting it, changes nothing that's already in
the chat. Older logs without a list fall back to the skill's list now, or the
usual one when it's gone: never to nothing.

**What it means.** Every tool call goes through `mustAsk`
(`conversations/manager.ts`) as before: Claude Code's PreToolUse hook, the API
engines' permission broker and Conch's own tools (`ToolContext.restricted`).
`skillLimit` now looks at every hold, not only this turn's. A call that isn't
on a list asks first, whatever the mode, with no "always":

> This chat is held to the "Quick setup" skill's list, and it doesn't say it
> needs to run this command. So I'm checking first.

(In the turn the skill came in, the question still says "is in use".) A
provider that can't be asked mid-step (Codex, ADR 0031) runs tighter
(`TurnInput.tainted`) for as long as a hold that doesn't allow any command
stands.

**Several skills** are held together, the strictest way: a call must be on
every list. `git log` with "Quick setup" (commands: `git`) and "Weekly review"
(files and the web) held asks, because Weekly review doesn't run commands.

**Where it comes from.** `skillHolds(events)` in `@conch/protocol` folds the
log: the gateway and the web read the same events the same way, so a restart,
a reload and every device agree. Nothing else is stored.

**What ends it.**

- **You.** The line above the composer, "Held to Quick setup's list", has
  **Stop holding**, and ⌘K finds "Stop holding this chat to Quick setup's
  list". It asks once, saying the instructions are still in the chat. Then
  `POST /api/conversations/:id/skills/:skillId/stop-holding` writes
  `skill.hold.ended` (`reason: 'you'`). The chat and Activity both show it.
  - Only a person can do this. The assistant has no tool for it, and a
    script's access key gets 403 (`person-only`).
  - It can't happen while a turn runs, because the skill may be steering that
    turn right now.
- **A new chat.** Holds belong to a chat. A new one starts with nothing,
  unless it's work started from a held chat (below).

**What doesn't end it, on purpose.**

- **Compaction or a summary.** Claude Code compacts a long session into a
  summary, and Conch's API transcripts drop their oldest turns past a budget
  (`engines/api/session.ts` `trim`). Neither ends a hold:
  - The summary is the model's own words, written while the skill was
    steering it. It's meant to carry forward what the chat was doing, and
    Conch can't check that it left the skill's steps out.
  - Both are set off by how much is in the chat. A skill that wanted out of
    its limits would only have to fill the context, or tell the model to
    restate its steps in every reply before they're dropped.
- **Another provider joining.** The handoff (`conversations/handoff.ts`)
  carries the replies the skill shaped, even though it doesn't carry the
  skill's text itself.

A hold ends only on something Conch can verify: a person's action, or a chat
that never had the skill. The cost is that a long chat stays held. The line
says so, and one press ends it.

**Work started from a chat.** A background task or a `delegate` helper starts
held to what its chat is held to (`TurnExtras.skills`, ADR 0033), as it starts
as wary (taint). What a helper used itself comes back to the chat with its
result (`addHolds`), as what it read does. What it was handed doesn't come
back, so stopping a hold in the chat while a helper runs isn't undone when the
helper finishes. The helper's chat says "Held to the Quick setup skill, like
the chat it came from"; the parent's says "A helper used the Weekly review
skill, so this chat is held to it too".

**What you see.**

- Nacre `SkillHold` puts one quiet line per skill above the composer: its name
  opens the list, and **Stop holding** is disabled while an answer is being
  written.
- `SkillHoldEnded` is the line in the transcript where you stopped a hold.
- Activity has a `skill` kind: "Held to Quick setup's list", "You stopped
  holding this chat to Quick setup's list".

### 2. The signing key, locked with this computer's device key

`skills.signing.json` is sealed like `secrets.json` (`lib/sealed.ts`
`SEALED_FILES`):

- AES-256-GCM, under an HKDF-SHA256 subkey of the device key for this file's
  name (`conch-system/1 skills.signing.json`);
- the name as associated data, and a fresh nonce on every write.

The device key is the one the macOS Keychain, Windows DPAPI or the Secret
Service keeps (`vault/keystore.ts`). `SkillTrust` opens the key file itself
rather than through `readStore`, because `readStore` puts a damaged file aside
and goes back to the default. For a signing key the default is a new key, and
that would be a quiet new identity.

**The terminal opens the device key the same way the gateway does.**
`pnpm conch` registers the same sealer for its home (`deviceKeyFor`, with
`keystoreMode` shared with `Services`). The keystore is found only when a
sealed file is read, so commands that never open a key never touch the
keychain. On macOS both create and read the item through `/usr/bin/security`,
so its access list is the same and nothing prompts.

We considered asking the running gateway to sign, and rejected it:

- **Conch might not be running.** Signing a skill to share is a terminal job,
  and it has to work when Conch is stopped.
- **It would be a signing endpoint.** Anything that can reach the gateway
  could ask it to sign. On a computer without a password that includes the
  assistant's own shell. The endpoint would need its own authentication, and
  would add a surface without moving the boundary.
- **The boundary is the same either way.** The key opens for this operating
  system user, exactly as the gateway's keys do.

Registering the sealer in the CLI also fixes `pnpm conch import`. It used to
read a sealed `secrets.json` as damaged and put it aside.

**The assistant's shell runs as you too,** so having the terminal can't be the
only proof. `lib/protect.ts` `runsConchPower` matches the obvious spellings of
`pnpm conch skills sign|trust|forget|key`, including `cli.ts skills …`. The
guard denies them in every mode (`TurnInput.guard`, and `requestPermission`
for engines without a hook): the assistant is told to give the person the
command. It's a fence, not a box. The protected paths still keep the key file
itself away from the assistant's file and shell tools.

**A key in the clear is locked automatically and safely.** This covers a key
from an older Conch, or one a passphrase backup just restored.

- **When.** At start (`lockIfClear`, which leaves a sealed file alone, so a
  start never reaches for the keychain), the first time the key is used, and
  by Repair everything. A look without repair only warns.
- **How.** The key is checked first: the right shape, an Ed25519 PKCS#8 key
  whose public half is the one named. Then the sealed text is written to a
  temporary file and renamed over the plain one (`writeFileAtomic`). A crash
  leaves either the old file or the new one, never half of either. No copy is
  set aside, nothing goes to a backup, and the temporary file only ever held
  sealed bytes. The tests check every file under the home for the private key
  in five spellings, base64url, base64, hex, raw bytes and the bare seed, and
  find none.
- **Limit.** Rename unlinks the plain file, but on copy-on-write filesystems
  (APFS, btrfs) and SSDs the old blocks stay on the disk until they're reused,
  and overwriting them in place wouldn't reach them either. Full-disk
  encryption (FileVault, BitLocker, LUKS) is what covers that, so we don't
  pretend to shred.

**A key that can't be used fails closed, in words.** `SigningKeyError` has
three reasons. Each says "Nothing was signed." and the next step:

- **changed.** The seal doesn't open: the file was changed, or locked on
  another computer.
  > Your key for signing skills can't be opened: the file was changed, or it
  > was locked on another computer. Nothing was signed.
- **damaged.** A file in the clear that doesn't hold together.
- **keychain.** The keychain wouldn't give the device key: unlock it and run
  the command again.

The file is never replaced by itself. `pnpm conch skills key --new` makes a
new key, and only when the old one can't be opened:

- a sealed file is set aside, still sealed, as a broken copy (backups leave
  those out), in case the keychain comes back;
- a damaged one in the clear is removed, so no plain copy of a private key is
  left;
- the old key stays trusted as yours, so skills you signed with it still say
  "Verified" here.

**Backups are unchanged.** The file is still a `secret` (`backup/manifest.ts`):

- It's only in a passphrase-locked backup. The device key is this computer's,
  so the backup carries the key open inside its encrypted part (`contentOf`
  `unseal`).
- A restore writes the key, and the next start locks it with the new
  computer's key.
- A backup without a passphrase leaves it out, like every key.

**It joins the rest of Conch.**

- **Repair everything.** The `skill-signing` check (`skills/doctor.ts`) says
  nothing when you've never signed a skill, and "Locked with this computer's
  own key" when all is well. A key in the clear is a warning, which repair
  fixes. One that can't be opened needs you, with `pnpm conch skills key
--new` to copy, or a restore.
- **Passwords.** It lists "Key for signing skills" by its fingerprint. It
  can't be copied out: you share the public key instead.

## Consequences

- A skill's limits hold for as long as its words can steer the chat: every
  later turn, Codex's tighter sealing, helpers and tasks, and a restart. A
  person sees it in one line and ends it in one confirmed press. Activity
  records both.
- No provider's context handling (compaction, trimming, handoff) can release
  a skill from its list.
- The signing key is sealed at rest like every other key. A copied home folder
  doesn't carry a usable key to another computer. A tampered file stops
  signing rather than signing with something else.
- The assistant can't sign or trust skills through Conch's own terminal
  command.
- No new dependencies.

Sources followed: Greshake et al., "Not what you've signed up for" (2023), on
injected instructions that act for as long as they're in context; the OWASP
Cryptographic Storage and Key Management cheat sheets (a key kept encrypted
under a key-encryption key the platform's keystore holds, failing closed when
it can't be unwrapped); NIST SP 800-38D for AES-GCM nonces (a fresh random one
per write, under a per-file subkey).

## Known limits

- **A long chat stays held after the skill stops mattering.** That's the
  price of not trusting a summary. **Stop holding** is one press, and a new
  chat starts clear.
- **`skill.used` from before this change has no list of its own.** Those holds
  use the skill's list as it is now.
- **The CLI fence matches the usual ways to run the command.** An assistant
  that builds the command another way (a variable, `eval`, a script it
  writes) gets past the guard. The key is still a protected path, and sealed
  commands can't read the vault folder. On a file keystore (no keychain, as
  on a headless Linux server) the device key is a 0600 file next to the vault,
  and the seal is only as strong as that file's permissions, which
  **Passwords** already says.
- **Gateway and terminal could each make a device key at once.** That needs a
  home that has never made one, with both starting at the same moment. Both
  write through the keystore and read back, but one would win. Every other
  start finds the key that's already there.
