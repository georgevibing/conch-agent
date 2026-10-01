# 0025 — Passwords: a vault of your own, and the managers you already use

- Status: accepted
- Date: 2026-10-01

## Context

Conch acts for people: it signs in to sites, calls services with their keys,
and runs routines at night. Until now the only place a secret could live was a
provider key in `secrets.json` (owner-only, in plain text) or a 1Password
reference. Someone without 1Password had nowhere to keep a password, no way to
let the assistant sign in for them, and nothing in their backups.

How other agents do it (read in their code, October 2026):

- **Hermes Agent** keeps provider keys in a plain `~/.hermes/.env` (0600). It
  has a Fernet vault whose key sits in a file right next to it, which its own
  code admits makes the encryption only protect backups. Good ideas worth
  copying: the model only sees handles, logins are bound to a site, payment
  fills ask, and it redacts by exact value.
- **OpenClaw** keeps secrets in SQLite, and its docs say "not encrypted at
  rest". Worth copying: its `secrets` tool lets the agent _request_ a value
  through a card (with no way to write one itself), shows the site by host,
  and passes the agent stand-ins rather than keys.
- **Claude Code** uses the macOS Keychain (a 0600 file elsewhere). **Codex**
  uses an `auth.json` file by default, or the OS keyring.

Conch takes the good parts and closes the gaps:

- the key lives in the keychain, never next to the vault;
- names and sites are encrypted too;
- a real password lock;
- the agent's own file tools are kept out.

## Decision

**One list, every source.** Passwords (`/passwords`, ⌘K) shows Conch's own
vault and, when you turn them on, other password managers:

- 1Password, Bitwarden and KeePassXC;
- Proton Pass, Dashlane and Keeper;
- the macOS Keychain.

Each is read through its own program and its own unlock, read-only. It's copied
into Conch only when you choose to (§ Moving in). Apple Passwords, Safari's
iCloud Keychain, Chrome and the rest don't let other apps read them, so Conch
imports from them once.

**What you can keep** (`VAULT_TEMPLATES`): logins (username, password,
one-time code, websites), payment cards, identities, secure notes, API keys,
Wi-Fi, bank accounts, SSH keys, servers, databases, ID documents, software
licences and crypto wallets. Any item can add, rename or remove fields of any
kind (text, secret, one-time code, address, email, phone, date, PIN, several
lines, hidden text). There are also tags, favourites and notes, and the last
ten passwords an item had.

**Finding** is one search box matching every word you'd remember an item by
(name, account, site, tag, kind, where it's from), one filter at a time (all,
favourites, codes, each kind, each source, each tag, each problem, Recently
deleted) and three sorts. ↑/↓ move through the list; `/` goes to the search.

**The Security check** says what needs you, worst first, each a filter:

- in a data breach (Have I Been Pwned's range API: only five hex characters of
  each SHA-1 leave, with `Add-Padding`);
- reused (compared with a keyed fingerprint, never a plain hash);
- weak (`passwordScore`);
- expired cards and documents;
- logins for `http://` sites.

With nothing to say, it says the passwords look good.

**Deleting** goes to Recently deleted for 30 days (as Bitwarden, 1Password and
Apple do), with Undo; emptying it needs a recent sign-in.

**Import** recognises Chrome/Edge/Brave, Safari/Apple Passwords, Firefox,
1Password CSV, Bitwarden CSV and JSON, LastPass, KeePassXC, Proton Pass and
Dashlane by their exact header rows (`importers.ts`; sources read in each
app's own exporter). It shows what's in the file and what's already here
before anything is saved, leaves duplicates out, and reminds you to delete the
export. **Export** is Bitwarden-style CSV, which every manager imports, behind
a recent sign-in and a plain warning.

**The generator** (shared by the browser and gateway, rejection-sampled CSPRNG):

- random: 20 characters with look-alikes left out (Proton Pass and KeePassXC
  defaults), every enabled class at least once;
- words: an EFF short-list passphrase (~10.3 bits a word, CC BY), with a digit;
- a PIN.

### Encryption (`vault/crypto.ts`, `node:crypto` only)

- A random 256-bit vault key (VK), wrapped with AES-256-GCM under a **device
  key** the operating system guards (`keystore.ts`):
  - macOS: the login Keychain via `/usr/bin/security -i`;
  - Windows: DPAPI CurrentUser via PowerShell;
  - Linux: the Secret Service via `secret-tool`.

  The device key always travels on stdin. Without a keychain (a headless
  server, tests), it's a 0600 file and Conch says so in plain words: in
  Passwords and in Repair everything.

- Each item has its own key, HKDF-SHA256(VK, salt = item id), so a nonce never
  repeats under one key (NIST SP 800-38D). Each item is AES-256-GCM with a
  random nonce, and its id and version as associated data.
- Everything but ids and versions is encrypted: names, sites, usernames and
  notes too (Bitwarden encrypts names; 1Password the overview). An HMAC over
  the item list catches one removed, duplicated or rolled back.
- A damaged item is kept as it is and reported, never dropped.

### The agent (§ The agent)

1. **The model never sees a value.** `passwords_find` returns names, kinds and
   sites only: no hint, no last four. No tool returns a value. The prompt tells
   the agent never to ask for a password in the chat.
2. **Conch fills, the person agrees.** On a password, one-time code or card
   field, `browser_type` looks for the item saved for that site. It asks
   (Nacre `BrowserApproval` kind `fill`: "Fill the password for “Netflix” on
   netflix.com?" — Not now / Always on this site / Fill), then types the value
   from the gateway straight into the page, and the username too. The model is
   told it happened.
3. **Only on the item's own site.** The host must equal a saved site or be a
   subdomain of it (`siteMatches`), never a lookalike (`netflix.com.evil.io`,
   `evilnetflix.com`). The field's frame must be the page's own (no
   cross-origin iframe) over https (or localhost). Anything else is refused
   with a sentence the model can act on.
4. **Per item:** "ask each time" (the default), "on its sites without asking"
   (also set by "Always"), or "never".
5. **Every use is recorded** (revealed, copied, filled, a code), shown as
   "Last used today".
6. **Redaction:** every secret value Conch has handled is replaced by `•••` in
   tool output and replies before they're logged or shown, in the forms a
   value travels in (as is, base64, base64url, URL-encoded, JSON-escaped,
   hex).

### Seeing a value

- From this computer, Show and Copy just work.
- From any other device, a value needs a sign-in from the last **five
  minutes** (tighter than the ten for other sensitive changes), with at most
  thirty values an hour per device.
- Responses are `no-store`.
- A revealed value hides again after 30 seconds or when the tab is hidden.
- A copied one is cleared from the clipboard after a minute, if it's still
  what's there.

### Backups (ADR 0020)

`vault/vault.json` is a **secret** file: it's only in a backup locked with a
passphrase, together with the vault key (`vault/key.json`). That file is never
written to disk here; it exists only inside the backup's encrypted part. On
restore it's moved into the new computer's keychain and deleted the moment the
vault opens. A plain backup never carries passwords; restoring one leaves
yours as they are. The device key (`vault/device.*`) never leaves the
computer. `vault/sources.json` (which managers to show, the KeePassXC file) is
a setting.

### Other password managers (AGENTS.md § Adding a password manager)

Each implements `PasswordSource` (`vault/sources.ts`):

- **1Password:** `op item list`, `op item get --reveal` for one use,
  `op item get --otp`; its app's own unlock.
- **Bitwarden:** `bw list items` and `bw get`. The master password goes in an
  environment variable, never argv. The session key is kept in memory only.
- **KeePassXC:** `keepassxc-cli` with the database password on stdin, kept in
  memory.
  - The values its list read already returns stay in memory beside it until
    it's locked, so Show and Copy answer at once: each run of the program
    derives the database key again, which takes a second or more.
  - The database is never typed. Conch offers the ones KeePassXC opened lately
    (its own settings file) and any `.kdbx` in the usual folders
    (`vault/keepass.ts`), plus the system's Open dialog (`POST /api/pick`, on
    this computer only).

- **Proton Pass:** `pass-cli`. You sign in once in a terminal; its session key
  stays in the system keychain, so Conch never handles the Proton password.
  `item list --output json` carries no secret by design (pass-cli's
  `ItemSummary`); one item is read with `item view`.
- **Dashlane:** `dcli`. You register the computer once (`dcli sync`), after
  which Dashlane keeps its master password in the keychain. If that's turned
  off, the master password goes in `DASHLANE_MASTER_PASSWORD`, in memory only.
  `dcli password` has no list without secrets, so Conch drops them while
  mapping and reads them again, one item at a time, when used.
- **Keeper:** Keeper Commander in `--batch-mode` with nothing on stdin, so it
  fails instead of prompting. Persistent login means no password here;
  otherwise it goes in `KEEPER_PASSWORD`.
- **macOS Keychain:** `security dump-keychain` without `-d` (attributes only),
  then `find-*-password -w` for one value. macOS asks you itself the first
  time. Conch's own device key and apps' own items are never listed. The data
  protection keychain (Safari, Passwords, iCloud) isn't reachable by any app.

One-time codes from Proton Pass, Dashlane and Keeper arrive as their setup; the
code is computed in the gateway, and the setup goes nowhere.

Each program is a need (ADR 0016: `op`, `bw`, `keepassxc`, `pass-cli`,
`dcli`, `keeper`) Conch can install or link to. Keeper Commander comes from
Keeper's own installers, and Proton's script is shown, never piped into a
shell.

### Moving in (`vault/transfer.ts`)

**Copy into Conch** (Passwords › Password managers) makes another manager's
items Conch's own, in the vault and in backups. It works in three steps:

1. **A preview.** It reads names only and says how many items there are, how
   many look like ones already here (the same site and account), and how many
   were copied before.
2. **The copy.** Each item's values come through the manager's own program
   (`full()`, or `value()` per field), one item at a time, and go straight into
   the encrypted vault. No export file ever exists. Duplicates (the same site,
   account and password) are left out by default. Progress is shown as it
   goes, it can be stopped, and items that couldn't be read are named.
3. **Optionally, kept up to date.** This is one way, from the manager into
   Conch:
   - It runs every 30 minutes. Managers that ask you something (Touch ID, the
     keychain's dialog) only sync while Passwords is open.
   - The manager's own modified date means unchanged items aren't read again.
     A keyed fingerprint (`fingerprint`) tells a real change from a re-save.
     Old passwords go to history.
   - An item edited in Conch is detached and left alone from then on.
   - Items gone from the manager go to Recently deleted, and only when its
     list came back non-empty.
   - Turning sync off keeps the copies.

Starting a copy, or turning on sync, needs a recent sign-in.

### Passkeys (`vault/passkeys.ts`, `browser/passkeys.ts`)

Logins can hold passkeys (`VaultPasskey`):

- what's stored: the credential id, the site (`rpId`), the user handle and
  name, the ES256 private key (PKCS#8) and the counter;
- the key is only accepted if it really is a P-256 private key;
- views show the site, the account and the last use, never the key, and the
  key is redacted from everything logged.

Passkeys come from:

- a Bitwarden JSON export (`fido2Credentials`; GUID ids become their 16
  bytes);
- Bitwarden and Keeper through Moving in (Keeper's JWK becomes PKCS#8);
- Conch's own browser when a site makes one.

1Password and Dashlane don't hand out private keys at all, and Proton Pass
packs them in MessagePack/COSE, which isn't read yet. Those passkeys stay in
their own app.

`browser_passkey` uses Chrome's WebAuthn virtual authenticator (DevTools
Protocol). A page only has one while it's armed for one thing, for three
minutes at most, and leaving the site ends it:

- **sign in:** the saved passkey whose site is the page's own (`siteMatches`,
  never a lookalike, https or this computer only) is put in after the person
  agrees (the fill card: "Sign in with the passkey for “GitHub”"). The
  site's next request is answered with it. The new counter is kept, and the
  passkey is taken out.
- **save:** after the person agrees, the site's next "create a passkey" is
  answered. The new passkey goes with the login for that site and account,
  or into a new login, and is taken out of the browser.

The browser enforces the rpId rule itself as well.

### Keys Conch uses

Provider keys, integration keys and sign-ins, and channel bot keys are what
keep Conch running unattended (a routine at 3am, a bot at noon). They must
open even while Passwords is locked, so they're a second tier:

- `secrets.json`, `integrations.secrets.json` and `channels.secrets.json` are
  sealed as one AES-256-GCM blob each, under a subkey of this computer's device
  key (`lib/sealed.ts`). The seal sits under `readStore`/`writeJson`, so no
  store changed.
- A plain file (an older Conch, a restored backup) is read, then sealed on the
  spot.
- Passphrase backups carry them unsealed inside their encrypted part, and
  they're sealed again where they're restored. Local copies stay sealed.
- They're listed in Passwords as **Keys Conch uses**. They're read-only:
  Show and Copy work with a recent sign-in, and "Open Providers",
  "Integrations" or "Channels" is where to change them.
- They're never offered to the agent.

### The lock

**Ask for a password to open Passwords** wraps VK under
HKDF(scrypt(password, N=2^17) ‖ device key), with no device-only wrap left.
So:

- a copied `~/.conch` can't be guessed at offline without this computer's
  keychain;
- unlocking keeps VK in memory only;
- the vault locks again after 5, 15, 30 (default), 60 or 240 minutes unused,
  or only when Conch stops;
- after five wrong passwords, each further try waits twice as long, up to 15
  minutes (NIST SP 800-63B-4 §3.2.2).

Nobody can reset it: a backup made with a passphrase is the only way back,
and the dialog says so. Restoring onto a new computer opens with that
computer's key; the lock is turned on again there. A passphrase backup made
while Passwords is locked says to unlock it first.

### Asking in the chat

- **Unlock:** when the agent needs Passwords while it's locked, the chat shows
  **Passwords is locked** with a password field. The task waits up to ten
  minutes, then carries on by itself once unlocked.
- **A credential:** `passwords_request` shows a card. It names the site by its
  real host, quotes the agent's reason, and has masked fields (with Show).
  What's typed is saved straight to the vault. The agent gets the item's id,
  never the value. There's no tool that saves a value the agent writes.
  "Not now" or the turn ending is final, and the agent is told not to ask in
  the chat.
- **A read:** `passwords_read` asks with **VaultApproval**: "Let Conch read
  the PIN of “Everyday Visa”?", the reason in its words, and for a secret,
  that it will see it. Don't / Always for this item / Allow once.
  - The value is then blanked from everything logged or shown (short PINs
    included).
  - "Never" items refuse.
  - Per item, _when it needs to read something itself_ is "ask each time" or
    "without asking".
- **Payment cards** fill into any real checkout, and always ask, whatever the
  item says.
- Routines (unattended runs) get none of these tools.

### The agent's own tools

The vault, the sealed key files and `access.json` are protected paths:

- Claude Code gets `Read`/`Edit`/`Write` deny rules for them, which hold in
  every mode, Full trust included.
- Any tool call naming them is refused with a sentence pointing at the
  Passwords tools.
- Codex's read-only sandbox can still read the user's files: the vault is
  encrypted and its key is in the keychain, which is why both matter.

## Security

Threat model:

- a stolen disk, backup or sync folder;
- another site or port calling the API;
- a stolen session on a phone;
- a prompt-injected agent asking for a password, or steering a fill to a
  lookalike site;
- a page asking for a passkey that isn't its own, or making passkeys unasked
  (the authenticator only exists while armed, for its own site);
- another manager's program answering with something crafted (ids are checked
  before they reach a command line; values are bounded and keys verified);
- a damaged or tampered vault file;
- an import file with formulas or odd encodings.

What this protects:

- Encryption protects the disk, backups and sync folders.
- The keychain protects against copying `~/.conch` to another machine.
- Information flow (no values in context, site-bound fills, approvals,
  redaction) is what protects against the agent. Same-user code with the
  vault unlocked can still reach it, as with every password manager; Conch
  says so.

Sources followed:

- OWASP ASVS 5.0 V13.3 and the Secrets Management and Cryptographic Storage
  cheat sheets;
- NIST SP 800-38D and SP 800-63B-4;
- RFC 4226, 6238 and 5869;
- the HIBP API v3;
- Greshake et al. 2023 (indirect prompt injection), CaMeL (Debenedetti et al. 2025) and AgentDojo (2024).

Tests:

- `vault/vault.test.ts`:
  - crypto binding, tampering and damage;
  - the wrong device key;
  - RFC test vectors and refused one-time code setups;
  - the generator, scoring and lookalike sites;
  - health;
  - the breach check's k-anonymity;
  - every import format, quoting and duplicates;
  - the agent sees no values and fills only on its own site;
  - external sources never put a secret in a list or on a command line;
  - Repair everything.
- `vault/routes.test.ts`: five minutes, cross-site, other ports, signed out,
  path tricks, no values in lists.
- `vault/sources.test.ts`:
  - Proton Pass, Dashlane, Keeper and the Keychain, each against a fake
    program written from its own source: no secret in a list or an argument,
    no prompt waited at, Conch's own key never listed;
  - passkeys: only ES256 kept, the Bitwarden id format, site-bound sign-ins,
    saving with the right login, redaction;
  - Moving in: the preview, duplicates, values through the program only,
    stopping part way, sync that leaves your edits alone and doesn't empty
    the vault when a manager lists nothing.
- `browser/passkeys.test.ts`: a real Chromium makes a passkey, Conch keeps it,
  and a later page signs in with it, with the counter carried back.
- `vault/backup.test.ts`: passwords move only with a passphrase and open on
  another computer, and the key file is gone.
- `e2e/passwords.spec.ts`.

## Consequences

- Proton Pass passkeys (MessagePack/COSE) and app-to-app transfer through the
  FIDO Credential Exchange Protocol (CXP, still a working draft) are next.
  AGENTS.md § Adding a password manager says how a new manager joins.
- Picking a saved item as a provider key (instead of pasting it again) would
  join the two tiers. It should stay a copy into the sealed tier, so a locked
  vault never stops Conch.
