# 0153 — Access keys beside every way in

- Status: accepted
- Date: 2026-11-18
- Amends: [ADR 0008](./0008-access-and-hardening.md) (ways to sign in),
  [ADR 0024](./0024-approve-new-devices.md) (scripts with a key),
  [ADR 0065](./0065-passkeys-and-approving-from-your-devices.md) (passkeys beside other ways)
- Goes with: [ADR 0051](./0051-releases.md) § Data across versions, [ADR 0063](./0063-this-computer-is-proven.md)

## Context

An access key was one of the ways _people_ sign in (`method: 'key'`), so making one was a
switch of how Conch is protected. An agent on the owner's own computer needed Conch's API and
ran `conch key "Hermes handoff (temporary)"`. That one command:

1. switched sign-in to access keys, and signed out every browser (`POST /api/access/keys`
   compared the method to `'key'`, and `addKey` ended every other session);
2. erased the password, when there was one (`addKey` deleted `username` and `passwordHash`);
3. still had to be approved with `conch devices approve` before the key worked from another
   device, though it was made in the owner's own terminal;
4. could only be undone by revoking the key, which put the method back to passkeys, or to no
   sign-in at all when there were none (`revokeKey` set `method` to `'none'`: revoking a key
   could turn sign-in off).

Nothing in the output said any of this would happen. The opposite way was just as rough:
choosing a password deleted every access key (`setPassword` set `keys = []`), so a script
stopped working because its owner changed how they sign in.

Agents handing work to each other, for an hour, are now an everyday use. A key for them must be
something you add, not something that rearranges how everyone gets in.

## Decision

### Two kinds of key, one list in Settings

- **`method` stays how people sign in**: `none`, `password`, `passkey` or `key`. Only a
  person's explicit choice changes it: **How you sign in → Access key** in Settings
  (`CreateKeyBody.signIn`), `conch key --sign-in`, or `conch password`.
- **A key for scripts and agents** sits beside every method. Making one signs nobody out,
  erases nothing and leaves `method` as it is. It works as `Authorization: Bearer` only: it
  never signs a browser in and never confirms it's you (`AccessStore.verifyKey` with
  `signIn`, `Gatekeeper.checkSignInKey`), so it can't become a 30-day session that outlives it.
- **Keys people sign in with** exist only while `method` is `key`, and also work for scripts,
  as before.
- Choosing a password keeps every key: people stop signing in with keys, scripts keep using
  them. Other sessions end, as any change of password does (OWASP ASVS 5.0 V7.4.3).
- **With sign-in off**, a key works only for a request that looks like it's from this computer
  (`Gatekeeper.looksLocal`). That isn't trust (ADR 0063): the key is the proof. It only keeps
  "sign-in off means only this computer" true. From elsewhere the answer stays
  `setup-required`.

### Made in this computer's terminal, it's ready

`conch key` runs where approving happens: the terminal on the computer running Conch, which is
already the proof that it's you (ADR 0024, 0063). So the key comes with its "device"
(`Scripts using “<name>”`) approved, `approvedHow: 'terminal'`. Made in a browser proven to be
this computer, the same, as `settings`. A key made anywhere else (a browser on another device,
even one that's let in) still waits for approval the first time a script uses it from another
device, exactly as before.

### Keys that stop by themselves

`conch key <name> --for 1h` (or `30m`, `2 days`, `1w`; 5 minutes to a year,
`readKeyLifetime`) and the **Works** choice in Settings → Access → Access keys make a key with
`expiresAt`. Once it's passed, the key stops at once (every check compares the time), the
sessions it signed in end, and within 30 seconds `Services.expireKeys` forgets it, disconnects
what it signed in and ends the terminals it opened. A key people sign in with can't run out:
that would lock them out when it did.

### Revoking never changes how anyone else signs in

Revoking ends only what used that key. The one exception is the last key people sign in with:
with passkeys, they carry on as the way in (`method` becomes `passkey`; nobody signs in any
differently); without them, Conch refuses, as it refuses to remove the last passkey, and says
to choose a password or add a passkey first. Revoking a key never turns sign-in off any more.

### A key can't change who may sign in

With keys working beside a password or passkeys, a key handed to an agent for an hour mustn't
be able to change them. With `Authorization: Bearer`, these answer `403 person-only`: making a
key (`POST /api/access/keys`; otherwise one made for an hour could make itself one that lasts),
choosing a password (`PUT /api/access/password`), turning sign-in off (`DELETE /api/access`) and
making a sign-in link (`POST /api/access/pairing`, a 30-day session for any device). Adding a
passkey and approving a device already were person-only. Revoking a key, signing a device out
and turning approval on only take trust away, and stay open to keys (§ Security engineering 7).

### What it says

`conch key` says how long the key works, what it can do ("what you can do in Conch, through its
API… It can't change how you sign in, sign a device in, or make more keys"), that it needs no approving, how you sign in
now and that nobody was signed out, and the exact `conch revoke <id>`. `--sign-in` says first
that access keys are now how you sign in and that every other device was signed out. Settings
gives keys a section of their own, **Access keys**, with the same words.

### Data across versions

New keys for scripts go in a new field of `access.json`, `scriptKeys`, never in `keys`. The
version before reads `keys` as "keys are how people sign in", and its `revokeKey` sets the
method to `none` when that list empties. A script key in `keys` on a password Conch would let
that version turn sign-in off by revoking it. In `scriptKeys` it is unknown to that version:
the key doesn't work there (fail closed), and it's dropped when that version writes the file
(fail closed again), so a rollback only ever takes keys away, and a key made for an hour can't
come back as one without its time. `keys` keeps its old meaning, so a key-sign-in Conch reads
the same in both versions. `tidy` holds the line: `keys` is non-empty only while `method` is
`key`; keys left there under another method move to `scriptKeys`. Keys for scripts are never in
a backup (`backup/format.ts` keeps credentials only), and a restore keeps this Conch's own.

## Consequences

- `conch key` is safe to run from an agent's shell on your own computer: the worst it does is
  add a key you can see in `conch keys`, Settings and the checkup, and revoke.
- The checkup lists keys for scripts (`script-keys`) with what they can do, and counts them
  among stale keys. Its sign-in line now says "Protected by your passkeys" for passkeys only
  (it said "access keys").
- Revoking the last key you sign in with, with no passkey, now asks for another way in first
  instead of turning sign-in off. `conch reset` is still the way to start over.
- A rollback forgets keys for scripts (they stop working). Making them again is one command.

## Considered and not done

- **Scoped keys** (read-only, chats only). They need every route to say which scope it is, and
  a review of each; a key that's short-lived and plainly described covers the handoff case now.
  A later ADR can add `scope` beside `expiresAt` in `scriptKeys`.
- **Approving keys made from another, approved device without asking.** Approved devices can
  already approve others (ADR 0065), but a key from a stolen session would then skip the one
  check that holds when the session alone is stolen. They keep asking.
- **A separate file for keys.** It would survive a rollback, but the version before couldn't
  revoke what it can't see, and the keys would come back to life on the way forward.

## Sources

- OWASP ASVS 5.0: V6.4 (authentication factor lifecycle and recovery: no factor replaced or
  removed except by the person, recovery no weaker than sign-in), V7.4.3 (other sessions end
  when a factor changes), V11.4 (secrets stored only as hashes), V16.5 (errors fail closed).
- NIST SP 800-63B-4, authenticator lifecycle management (binding, expiry and revocation of
  authenticators); OWASP Secrets Management Cheat Sheet (short-lived credentials that expire by
  themselves, least privilege for automation).
- Greshake et al., 2023, indirect prompt injection: an agent's own actions are untrusted input,
  so a key can't mint keys.
