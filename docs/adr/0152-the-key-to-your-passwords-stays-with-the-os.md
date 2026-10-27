# 0152 — The key to your passwords stays with the operating system

- Status: accepted
- Date: 2026-10-27
- Builds on: [ADR 0025](./0025-passwords.md) (Passwords, the device key, `keystore.ts`),
  [ADR 0020](./0020-backups.md) (a backup never carries the device key),
  [ADR 0094](./0094-staying-responsive.md) (fix it before you ask)

## Context

Another agent on a person's Linux server opened Conch's Passwords without asking: it read
`~/.conch/vault/device.key`, read Conch's `crypto.ts`, and unwrapped the vault and Conch's sealed
secrets (a 1Password service account token among them) with a few lines of Node.

Conch already keeps the device key with the operating system where it can (ADR 0025): the login
Keychain on macOS, DPAPI on Windows, the Secret Service on Linux. That server had none reachable,
so the key was a 0600 file, and Settings → Health said "encrypted on this computer" as if that
were the whole story. Three things made the file stickier and the story vaguer than they should be:

- **A file key never moved.** Once a key was a file (a first start under a service manager with
  no session bus, a keyring set up later), it stayed one, even after the keyring came back.
- **The choice wasn't settled.** The keystore was picked afresh at each start. A gateway that
  once found the keyring and later didn't (the background launcher has no
  `DBUS_SESSION_BUS_ADDRESS`) made a new file key that opens nothing: "the key that opens them
  isn't the one here".
- **Linux missed the bus it had.** A systemd user service, or the background launcher, often runs
  without the variable even though the person's session bus is at `/run/user/<uid>/bus`.

## Decision

**One settled keystore** (`SettledKeystore` in `vault/keystore.ts`), the operating system's when
it's reachable, the file only when it isn't:

- **A file key moves into the keyring** the first time the keyring is reachable: stored there, read
  back and compared, checked against the vault it opens (`wrap` in `vault.json`), and only then is
  `device.key` removed. A small marker, `device.moved`, says the key now lives in the keyring. It
  holds no secret. Health notes it quietly: "Moved the key to your passwords into the keychain".
- **Never a new key in place of one that exists.** With the marker there and the keyring
  unreachable, Conch says the keyring can't be reached and tries again; it never makes a file key
  that would orphan the vault. When both a file and a keyring key exist and differ, the one that
  opens the vault wins.
- **Linux finds the session bus** at `/run/user/<uid>/bus` when the variable isn't set, and hands
  it to `secret-tool` only.
- **The same key, so everything sealed with it follows.** The vault's wrap, the Passwords lock's
  key derivation and every `deviceSealer` secret (service account tokens, channel secrets) read
  the one device key, so moving it moves their protection too. Nothing is re-encrypted.
- **Health says what the key is.** With the key in a file: "the key is a file on this computer, so
  any program running as you could open them; turn on the Passwords lock to need your password
  after a restart." That is a suggestion with one button, not a warning.

### What each place stops, honestly

| Where the key is | Stops | Doesn't stop |
| --- | --- | --- |
| macOS login Keychain | Reading the key off the disk, out of a backup, a disk image or a synced folder; other users | A program running as you: items made through `/usr/bin/security` trust that tool, so any process can call it |
| Windows DPAPI (CurrentUser) | The blob copied to another computer or read by another Windows user | A program running as you, which DPAPI unwraps for |
| Linux Secret Service | Reading the key off the disk or a backup; other users; a locked keyring after logout | A program running as you while the keyring is unlocked |
| A 0600 file | Other users | Anything running as you, a copy of the folder |
| **The Passwords lock** (any of the above) | **A program running as you after a restart**: the vault's key is wrapped with your password and the device key, and Conch keeps no unwrapped copy | A program running as you that reads Conch's memory while it's unlocked |

The operating system's store is the floor; the lock is the only thing that keeps another program
running as the same person out, and Health says so where the key is a file.

## Consequences

- An install that started without a keyring gets the keyring's protection by itself once one is
  there, with nothing for the person to do and nothing lost on the way.
- A person who wants no other program on their account to open Passwords turns on the lock and
  types its password once after each restart; the one button in Health takes them there.
- `device.moved` is new state in `vault/`; backups already leave `vault/device.*` out (ADR 0020).
- A headless server with no Secret Service keeps the file, as before, and now says so in plain
  words with the lock offered.
