# 0024 — Devices, and approving new ones

- Status: accepted
- Date: 2026-10-01
- Builds on: [ADR 0008](./0008-access-and-hardening.md) (sign-in, sessions, pairing)

## Context

Conch signs in with one thing a person knows or holds: a password, or an
access key. Anyone who gets that one thing gets everything Conch can do, which
is everything the person can do on their computer. Passwords get phished and
reused, and keys end up in a shell history or a screenshot. NIST SP 800-63B-4
counts a single factor as AAL1. Adding a second factor the usual way (TOTP,
passkeys) adds setup that non-technical people get wrong, and a recovery
problem.

Conch already has something an attacker almost never has: **the computer it
runs on**. Its terminal is the proof of ownership behind `pnpm conch reset`.
OpenClaw uses the same idea for its gateway:

- every client is a _device_, and a new one waits in a pairing list;
- `openclaw devices list | approve <id> | reject | remove | rename | clear`
  manage it on the host;
- the gateway's own machine is trusted on loopback.

People also asked what has actually signed in. Settings showed sessions,
which vanish at sign-out, so a device seen last week wasn't anywhere.

## Decision

### Devices

Every browser that signs in gets a **device cookie** (`conch_device`, or
`__Host-conch_device` over HTTPS). It is 256 random bits, `HttpOnly;
SameSite=Strict`, kept for 400 days (the browser maximum), and only its
SHA-256 is stored. A device outlives its sessions: signing out keeps it, so it
is recognised next time. Each device records:

- its name (from the User-Agent, or one the person gives it);
- its kind;
- when it was first and last seen;
- the address it last came from;
- how it last signed in;
- whether, when and how it was approved.

Sessions point to their device (`deviceId`). Sessions from before this change
are adopted on their next request: a device record is made, and its cookie is
sent with the response.

A device that was never approved and isn't signed in is forgotten 30 days
after it was last seen. At most 200 devices are kept.

### Approve new devices (off by default)

When it is on, the right password or key on a device that isn't approved yet
does **not** sign it in. Instead:

1. The browser gets a **waiting session**, which can do nothing but ask
   `GET /api/auth` whether it was approved. It also gets a **request** with a
   six-symbol code from a 32-symbol alphabet without look-alikes, shown as
   `K7M-Q2X`. The request lasts 10 minutes.
2. The waiting screen shows the code in large tiles and the one line to run:
   `pnpm conch devices approve K7M-Q2X`. It checks every 1.5 seconds, and
   whenever the tab comes back into view.
3. The person approves it on the computer running Conch, either:
   - in the terminal (`pnpm conch devices approve`); with no code it shows who
     is waiting and asks, or waits for the device to ask; or
   - in **Settings → Security → Devices**, after confirming it's them.

   The waiting session becomes a normal one, so the device is let in where it
   waits without signing in again.

4. A device turned down is told so. Its request stays until it runs out, so a
   mistake can still be approved. Signing in again asks anew.

The code is **not a credential**: knowing it grants nothing. It only lets the
person match the screen in front of them to the line in the terminal, so they
approve the device they mean when two are waiting.

**What approves itself:**

- **This computer.** A sign-in on loopback, with no proxy headers (the same
  `isLocal` test as everywhere), is approved as `this-computer`. The terminal
  that would approve it is right there.
- **A one-time sign-in link** (the QR code). Only a device already let in (or
  `pnpm conch pair` on this computer) can make one, so it approves the device
  that opens it as `link`.
- **Devices signed in when approval is turned on.** They already proved who
  they are, and the person sees them listed (in Settings, and from
  `pnpm conch devices on`) to remove any they don't recognise.

**Who may change what:**

| Action                          | From                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Turn approval **on**            | Any signed-in device, after confirming it's you (it only adds protection)        |
| Turn approval **off**           | This computer (Settings, after confirming) or the terminal; never another device |
| **Approve** a device            | This computer (Settings, after confirming) or the terminal; never another device |
| **Turn down**, sign out, remove | Any signed-in device (each only takes trust away)                                |

Otherwise anyone holding a stolen session could approve their own devices, or
switch the protection off. With approval on, a session from elsewhere counts
only while its device is approved. A removed device is signed out at once:
open sockets are checked against `access.json` every two seconds, because the
terminal changes it from another process.

**Scripts with an access key** (`Authorization: Bearer`) have no cookie. With
approval on, a key used from another device needs approval _as that key_, one
"device" named `Scripts using “<key>”`. Until then every call answers `403
approval-required` with the code and the command. Once approved, the key works
from anywhere until the device is removed or the key is revoked. Otherwise a
stolen key would skip approval through the API. On this computer a key needs
no approval.

**Limits:**

- At most 10 devices wait at once. More get `429` with the command to clear
  them, so nobody can bury the real request.
- Waiting doesn't count as a failed sign-in, but the wrong password still
  does, and it creates nothing: no device, no request.

### The terminal

`pnpm conch devices [list | approve | reject | remove | rename | on | off]`
follows OpenClaw's verbs. Where OpenClaw's `approve` with no id only shows the
newest request, Conch asks, because a person is at the keyboard. It also
accepts the code in any case or spacing, and takes a device id by its first
few characters. Without a terminal attached it never guesses, and says the
usage instead.

After approving, it reads `access.json` back from scratch: the gateway may
have saved at the same moment, so it approves again if the change didn't land.
`--json` prints the list for machines.

### Joining the whole-Conch features (working agreement 12)

- **Checkup:**
  - a device waiting is a `warn`, with `pnpm conch devices` and **Review**;
  - approval on is `ok`;
  - off while reachable from the network or Tailscale is an `info` that
    offers to turn it on.
- **Backups:** `access.json` is already `secret`. Its backed-up form is
  credentials only, so devices, approvals and requests are never backed up,
  like sessions. A restore can't bring back a device you removed.
- **⌘K:** "Devices" (approve, pending, trusted…) opens the section.
- **Live:** `access.changed` refreshes Settings. When a new device starts
  waiting, a quiet toast with **Review** appears on every signed-in screen.
  Only a person can say whether it's theirs, and if it isn't, it means
  someone knows the password.

## Consequences

- With approval on, a stolen password or key alone gets nowhere from another
  device. The attacker also needs the owner to approve them, on the owner's
  own computer, and the owner sees the attempt. It is turned down, and the
  terminal and Settings both say to change the password.
- One extra step, once per new device, for people who turn it on. Phones added
  with the QR code skip it.
- The device cookie is a bearer token. Anyone who can read the browser's
  cookie store can copy it, along with the session. `HttpOnly` keeps it away
  from page scripts, so a prompt-injected page can't take it.
  - **Not chosen:** binding devices to a non-extractable WebCrypto key pair
    (as OpenClaw's Ed25519 device identity does). It would resist cookie
    theft, but needs a signature on every request. It's the natural next
    step if that threat matters.
- A device approved once stays approved until removed. The list marks
  approved devices not seen in 90 days so they can be pruned.

Sources: NIST SP 800-63B-4 (authenticator assurance), OWASP ASVS 5.0 V6 and V7
(authentication, session management), OWASP Session Management Cheat Sheet
(cookie attributes, `__Host-`), RFC 6265bis (cookie lifetime cap), OpenClaw
`docs/cli/devices.md` (device pairing verbs).
