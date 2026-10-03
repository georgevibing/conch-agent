# 0065 — Passkeys, and approving new devices from your own

- Status: accepted
- Date: 2026-10-03
- Amends: [ADR 0008](./0008-access-and-hardening.md) (ways to sign in),
  [ADR 0024](./0024-approve-new-devices.md) (who may approve)
- Goes with: [ADR 0064](./0064-your-own-address.md)

## Context

Conch signs in with a password or an access key. Both are something to remember or keep, both
can be phished or leaked, and on a phone the key is something to paste. Meanwhile the computer
people open Conch on already knows them: Touch ID on a MacBook, Windows Hello on a PC, Face ID
on an iPhone. Passkeys (WebAuthn) turn that into a sign-in that can't be phished, reused or
guessed, with nothing to type.

ADR 0024 made approving a new device the job of "this computer": the terminal or Settings on
the computer running Conch. That fits a laptop. It doesn't fit a server (ADR 0064), where
nobody sits at that computer and the owner would have to SSH in each time a phone signs in.

Passkeys aren't for everyone, and not on every device: older browsers, a Mac without Touch ID in
Chrome, Linux desktops, a shared work computer, or a person who would rather have a password
they know. So a passkey must be the easy way, never the only way.

## Decision

### Passkeys sign in to Conch

- A new way to sign in, `passkey`, beside `password` and `key`. Passkeys can also sit beside a
  password: then either one works. Access keys stay what they are (and for scripts).
- Registered with `residentKey: 'required'` and `userVerification: 'required'`: the passkey
  lives on the device or in its password manager, and using it always takes the face, finger or
  PIN. No attestation is asked for (`'none'`): Conch doesn't care which company made it, only
  that it's the same one next time.
- Signing in needs no username: the browser offers the passkeys it has for this address
  (discoverable credentials). The password form also offers them as it's filled
  (conditional mediation), so a person who reaches for their password gets the passkey instead.
- The relying party is the address Conch is opened at (`localhost`, a Tailscale name, an
  address of your own). A passkey works where it was made; the list says where each one is for.
  An address that is an IP, or isn't HTTPS, can't use passkeys (browsers refuse them there), so
  Conch doesn't offer them.
- Verification uses `@simplewebauthn/server` (a widely used, maintained implementation); the
  web app uses `@simplewebauthn/browser`. Challenges are 32 random bytes, kept in the gateway's
  memory for five minutes, single use, at most a hundred waiting, and bound to what they were
  for (signing in, adding one, confirming it's you, the hello link) and, where there is one, to
  the session or hello code that asked.
- `access.json` keeps each passkey's credential id, public key, signature counter, transports,
  the address it's for, a name, its AAGUID, and when it was made and last used: nothing secret.
  A counter that goes backwards (a cloned authenticator) refuses the sign-in. Synced passkeys
  report zero and are left alone, as WebAuthn says.
- The name is what a person recognises: the password manager's name from its AAGUID ("iCloud
  Keychain", "Google Password Manager", "Windows Hello", "1Password"…), otherwise the device's
  ("Passkey on Chrome on Windows"). It can be renamed.
- The last way in can't be removed: removing the only passkey while there's no password asks
  for a password or another passkey first. `conch reset` removes them all, as it removes
  passwords and keys.

### The button names what you have

Nobody sees the word "passkey" unless they look for it. The web app asks the browser whether
this device has a built-in authenticator
(`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`), and names the button
for it:

| Where                                                     | Button                                     |
| --------------------------------------------------------- | ------------------------------------------ |
| A Mac                                                     | **Use Touch ID**                           |
| Windows                                                   | **Use Windows Hello**                      |
| iPhone or iPad                                            | **Use Face ID**                            |
| Android                                                   | **Use your fingerprint**                   |
| No built-in authenticator, but passkeys work              | **Use your phone** (the browser's QR code) |
| Passkeys don't work here (no secure context, old browser) | nothing: the password is the way           |

Where there's no built-in authenticator, **Choose a password** (or **Sign in**) becomes the big
button, and **Use your phone instead** the small link, so nobody starts down a path that can't
finish.

### Confirming it's you

"Sudo mode" (ADR 0008) accepts a passkey too: **Confirm with Touch ID** in the same dialog that
asks for the password. A passkey proves more than a password, so it opens the same ten minutes.

### Approving new devices from your own devices

ADR 0024 kept approving to this computer, so a stolen session couldn't let its friends in. A
fresh confirmation does that job better, and works where nobody sits at the computer:

- A device may approve a waiting device when it is **itself approved** and **confirmed it's you
  in the last ten minutes** (passkey or password). This computer and its terminal still can, as
  before.
- **Turning approval off** stays on this computer (Settings there, or `conch devices off`): it
  only ever takes protection away, and on a server it needs the terminal.
- **A passkey approves its own device.** Signing in with a passkey is two things at once (the
  device that holds it, and the face, finger or PIN that unlocks it), so a new device that signs
  in with one isn't asked to wait (`approvedHow: 'passkey'`). A password or access key still
  waits.
- **The owner hears about it.** A device starting to wait already shows a toast on every
  signed-in screen; it now also sends a notification (ADR 0027) to approved devices that have
  notifications on: "A new device wants to sign in to Conch". The notification carries the
  device's name and where it's from, never the code; the code is matched on screen.
- The waiting screen says where to approve: "Open Conch on a device you've already signed in on,
  or on the computer running it". When this device could use a passkey, it offers that too, so
  the person can let themselves in.

| Action                      | From                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Approve a device            | This computer, its terminal, or **an approved device that just confirmed it's you** |
| Turn approval **on**        | Any signed-in device, after confirming it's you (unchanged)                         |
| Turn approval **off**       | This computer or its terminal (unchanged)                                           |
| Turn down, sign out, remove | Any signed-in device (unchanged)                                                    |

`approvedHow` gains `passkey`, `hello` (ADR 0064) and `device` (approved by another device,
whose name is kept beside it).

### Whole Conch

- **Security checkup:** passkeys are listed with sign-in; an address of your own with approval
  off is a warning (ADR 0064); a password with no passkey on an address of your own is an info
  that offers to add one.
- **Backups:** passkeys are credentials, so they ride with `access.json`'s backed-up form
  (passphrase-locked only), like the password hash. A restored backup keeps them for the same
  address.
- **⌘K:** "Passkeys", "Touch ID", "Windows Hello", "Face ID" open the section.

## Consequences

- On most computers, signing in to Conch is a touch. There's nothing to forget and nothing a
  fake page can collect.
- A server's owner never needs its terminal after setting it up: they let devices in from the
  laptop or phone they already use.
- A stolen session from an approved device can approve other devices only with the owner's
  passkey or password as well, which is the same bar as every other sensitive change.
- A synced passkey (iCloud Keychain, Google Password Manager) can sign in on a new device of the
  same account without approval. That's deliberate: the account's own protections stand behind
  it, and the device appears in Devices at once.
- Two new dependencies, `@simplewebauthn/server` and `@simplewebauthn/browser`, both MIT and
  maintained, rather than hand-written COSE and CBOR parsing.

## Sources

- W3C Web Authentication Level 3; FIDO Alliance passkey design and UX guidelines (naming the
  platform's own biometric, "use a phone" for cross-device sign-in).
- NIST SP 800-63B-4 and its supplement on syncable authenticators (synced passkeys at AAL2).
- OWASP ASVS 5.0 V6 (authentication, including phishing-resistant authenticators) and the
  OWASP Authentication Cheat Sheet (re-authentication before sensitive changes).
- SimpleWebAuthn's documentation (registration and authentication options, counter handling).
- The community AAGUID list (passkeydeveloper/passkey-authenticator-aaguids) for names.
