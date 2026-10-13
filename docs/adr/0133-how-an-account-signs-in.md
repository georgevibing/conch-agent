# 0133 — How an account signs in

- Status: accepted
- Date: 2026-10-13
- Builds on: [ADR 0025](./0025-passwords.md) (the vault, the managers you use, passkeys),
  [ADR 0130](./0130-passwords-in-the-browser.md) (filling in the browser),
  [ADR 0062](./0062-copy-to-another-password-manager.md) (Copy to)

## Context

Many accounts have no password. You press **Continue with Google**, use a passkey, sign in through
your company's single sign-on, or get a link by email. Password managers save these too, each in its
own way. Conch read every login as a username and a password. So in 1Password, a "Product Hunt"
item saved as _Sign in with Google_ showed an empty field called "password" (from 1Password's Login
template) that did nothing when pressed. Copy into Conch failed on it ("That field is empty"). The
Security check could call such an item weak or reused, and the browser had nothing to offer on a
page that only has a Google button.

How each manager keeps it, from its own source and documents (October 2026):

| Manager        | Sign in with another account                                                                                               | Passkey only                                                                                                                                                     | SSO  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1Password      | A "Sign in with" field linking the provider's own Login item; `op` shows `{label: "sign in with", type: "UNKNOWN"}` [1][2] | A Login item; the passkey isn't in `op`'s output, and desktop exports leave passkeys out [3][4]                                                                  | None |
| Bitwarden      | None [5]                                                                                                                   | `login.fido2Credentials[]` with `password: null`; `bw list items` includes the private key (`keyValue`, PKCS#8) [5][6]                                           | None |
| KeePassXC      | None                                                                                                                       | `KPEX_PASSKEY_*` attributes; an entry it makes is "&lt;site&gt; (Passkey)" with no password and a translated "Passkey" tag; the CSV export has no attributes [7] | None |
| Proton Pass    | None                                                                                                                       | `Login.passkeys[]` in `item view`; the key is MessagePack around a COSE key [8]                                                                                  | None |
| Keeper         | None                                                                                                                       | A `passkey` field whose `privateKey` is a JWK [9]                                                                                                                | None |
| Dashlane       | None                                                                                                                       | `dcli` doesn't read passkeys at all [10]                                                                                                                         | None |
| macOS Keychain | None                                                                                                                       | Passkeys are in the data protection keychain, which `security` can't reach [11]                                                                                  | None |

Two facts about `op` matter most:

- `op item get --format json` leaves an empty field's `value` out entirely, even with `--reveal`. An
  empty password still carries `password_details: {strength: "TERRIBLE"}`, but no `entropy`, which
  only appears with a value. In JSON, `--reveal` doesn't hide values: it only conceals them in the
  human-readable output (op 2.30) [12][13].
- 1Password's "Sign in with" supports Amazon, Apple, Discord, Facebook, GitHub, Google, Microsoft,
  Okta (saving only), Slack and X [1]. The `op` field doesn't name the provider.

## Decision

**An item knows how it signs in.** `VaultSignIn` (protocol): `via` is `provider` ("Sign in with
Google", with `provider` and the `account` at it), `passkey` (with `usable`: whether Conch holds
the key), `sso` (`name`: "Acme SSO") or `link` (a code or link sent by email). It's on
`VaultItemSummary.signIn`, so every list, ⌘K, the browser's `matching` and `fillPolicy` carry it.
Absent means a password, as before. `SIGN_IN_PROVIDERS` names each provider and the sites its
sign-in happens on.

### Reading it (`vault/sources.ts`, `vault/signin.ts`)

- **Natively where the manager says it.**
  - **1Password:** the "sign in with" field marks the item. The provider comes from the item it
    points at, when `op` gives its id (that item's sites, matched by `providerOfSites`), then from
    the item's own words. Otherwise it's "another account" (`provider: 'other'`).
  - **Passkeys:** Bitwarden's `fido2Credentials`, KeePassXC's "(Passkey)" entries, Proton Pass's
    `Login.passkeys` and Keeper's `passkey` field, each on a login with no password, make
    `via: 'passkey'`. `usable` is true only where `full()` gets a real ES256 key: Bitwarden
    (checked in the list), Keeper (its JWK) and KeePassXC (its PEM, read with `show -a` for Copy
    into Conch). Proton Pass passkeys aren't usable (COSE isn't read yet). 1Password's and the
    system's aren't reachable at all.
- **From the item's own words, conservatively** (`signInFrom` / `signInFromText`): only on a
  login that surely has **no password**, and only a phrase that says it outright ("Sign in with
  Google", "Continue with Apple", "GitHub login", "Okta SSO", "magic link", "passkey only").
  It reads the title, tags, notes, and the labels and values of fields that aren't concealed. A
  word on its own ("google" in a note, "Google account") is never enough. An unknown name after
  "Sign in with" is kept only when written as a name ("Steam"), never a plain word ("your
  email"). The account is the email the phrase names, or else the one the item shows. While a
  manager's list can't tell whether there's a password (1Password, Proton Pass, Keeper), nothing
  is guessed until the item is read. What the read learns is kept on the listed item, so the list
  says it from then on without asking the manager again.
- **No empty password is a field.** A concealed field 1Password keeps empty (`opEmpty`) is
  dropped. The others never listed one. The detail page no longer shows a password that does
  nothing.
- `list()` stays cheap and never prompts, and still carries no secret: Bitwarden's private keys
  only become a yes or no.

### Conch's own vault

- `ItemRecord.signIn` is saved, encrypted like the rest, and in passphrase backups with the rest.
- A save's body is the whole item, so leaving `signIn` out means a password login again.
- A login with passkeys and no password signs in with a passkey even when nobody said so.
- A passkey's `usable` is always the vault's to say (whether it holds a key), never the browser's.
- **Imports** (every format) set it the same way. A Bitwarden JSON login with only passkeys is no
  longer left out of an import. No CSV has a column for it; a line in the notes is read back.
- **Export** (Bitwarden-style CSV) and **Copy to** (1Password, Bitwarden; neither CLI can make a
  "Sign in with" item) put _Sign in with Google (ada@gmail.com)._ at the top of the notes, which
  Conch's import reads back.
- **Copy into Conch** carries it (`FullItem.signIn`, or the list's), so a "Sign in with Google"
  item copies as that, not as a login with an empty password. 1Password now has `full()`: one read
  an item instead of one per field, so the Copy no longer fails on an empty field. The fingerprint
  includes it, so a change syncs.

### The provider's own login (`VaultService.signInItemFor`, `VaultItemDetail.signInItem`)

For "Sign in with Google" as ada@gmail.com, `pickSignInItem` chooses the saved login on Google's
own sites (`SIGN_IN_PROVIDERS.google.domains`, through `match.ts`: exact, within or related, never
a look-alike, another tenant of a shared host, or a public suffix):

- It must be a login, not deleted, and not itself one that signs in through someone else.
- Its account must be `signIn.account`: the same, Gmail's dots and `googlemail.com` aside, or
  written short ("ada") when only one fits.
- With no account known, it's the one login for that provider, if there's exactly one.
- The closest site wins, then the one used last.

`detail()` returns its id as `signInItem`. `signInItemFor(summary)` answers from what Passwords last
listed: synchronous, cheap, and it never asks another app anything.

### Health and finding

- An item that signs in through a provider, SSO or a link is never weak, reused, in a breach or
  insecure: its old password, if it has one, isn't how it signs in, and it doesn't count towards
  another item's reuse either. A passkey-only item has no password to judge.
- `forAgent` (`passwords_find`) carries `signIn` and finds "google", "passkey" or "sso" by it.
- `fillPolicy` carries `signIn`, and an external item that signs in another way offers no
  `password` in `has`.

### The browser (another change, described here)

The browser follows the provider's sign-in with the provider's own item. On a page whose saved item
signs in with Google, Conch presses (or lets the agent press) **Continue with Google**. On
accounts.google.com it fills `signInItemFor(item)`, the Google login for that account, through the
same `fillPolicy` on Google's own page and the one question of ADR 0130. Nothing about a sign-in in
one site's item is ever filled on another site. A passkey Conch holds is used with
`browser_passkey`. A passkey Conch doesn't hold (`usable: false`, in 1Password or the system) is
handed to the person, who uses their own device. Conch then offers to make a Conch passkey for the
site, so it can sign in by itself next time.

### Passwords (another change, described here)

The item says _Sign in with Google · ada@gmail.com_ instead of an empty password, with the
provider's mark and a link to the Google login when there is one. Editing a login can choose how it
signs in. A passkey Conch can't use says where it's kept and offers to make one in Conch.

## Security

- **No new value leaves the gateway.** `signIn` is names and an account (an email), shown where
  the username already is. Detecting it reads only what `fields()` already read. Bitwarden's
  passkey keys in its list become a boolean, never kept. 1Password's emptiness is judged without
  `--reveal`, from a value's absence and the absence of `entropy`.
- **A prompt-injected agent or a crafted note** can at most make an item say it signs in with
  someone. That never fills anything anywhere new: `signInItem` is only a pointer to the
  provider's own item. Filling it still needs `fillPolicy` on that item's own sites, so a note
  saying "Sign in with Google" on an item for `evil.example` can't pull the Google password onto
  `evil.example`. A look-alike Google login is never picked (`match.ts`).
- **Never guess from weak evidence:** only a password-less login, and only an explicit phrase.
  1Password's native field outranks words; a native passkey outranks both.
- **A crafted program answer:** KeePassXC's PEM and Keeper's JWK become keys only through
  `isEs256Key`/`toPasskey`, and ids are checked before they reach a command line, as before.

Sources followed:

1. 1Password Support, "Use Sign in with to save and fill logins from providers" —
   https://support.1password.com/sign-in-with-provider/
2. 1Password/shell-plugins#600 (`op` 2.34 output with `"sign in with"`, type `UNKNOWN`) —
   https://github.com/1Password/shell-plugins/issues/600
3. 1Password Support, "Save and sign in with passkeys" — https://support.1password.com/save-use-passkeys/
4. 1Password Community, "Indicating unsupported fields in CLI" (a passkey-only login in `op` JSON) —
   https://www.1password.community/developers-69/indicating-unsupported-fields-in-cli-1651
5. Bitwarden `clients`: `libs/common/src/vault/models/view/fido2-credential.view.ts`,
   `apps/cli/src/models/response/login.response.ts` — https://github.com/bitwarden/clients
6. Bitwarden `apps/cli/src/commands/list.command.ts` (the list decrypts every item)
7. KeePassXC `src/core/EntryAttributes.cpp`, `src/browser/BrowserService.cpp`, `src/cli/Show.cpp`,
   `src/format/CsvExporter.cpp` — https://github.com/keepassxreboot/keepassxc
8. Proton Pass `pass-cli` (`commands/item/list.rs`, `view.rs`) and `proton-pass-common`
   (`proto/item_v1.proto`, `passkey/protonpasskey.rs`) — https://github.com/protonpass
9. Keeper Commander `keepercommander/record_types.py`, `recordv3.py` —
   https://github.com/Keeper-Security/Commander
10. Dashlane CLI `src/types.ts`, `src/command-handlers/passwords.ts` —
    https://github.com/Dashlane/dashlane-cli
11. Apple TN3137, "On Mac keychain APIs and implementations" —
    https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains
12. 1Password CLI release notes (2.30.0: concealed values in human-readable output only) —
    https://app-updates.agilebits.com/product_history/CLI2
13. 1Password Community, "Empty string passwords are snowflakes" and "op item get --format json
    returns concealed field values without --reveal" — https://www.1password.community/

Also: OWASP ASVS 5.0 V6 (authentication, passwordless and federated), NIST SP 800-63B-4 §3.1.7
(syncable authenticators) and §3.1.1.2, and the FIDO Alliance's passkey guidance on synced
credentials. Greshake et al. 2023 is the reason the agent's and a note's words never widen where
anything is filled.

Tests:

- `vault/signin.test.ts`: the phrases read and the words never taken as one; a password always
  wins; the notes line read back; the provider's own login by account, Gmail's dots, written
  short, the only one, and never a look-alike, another tenant, a deleted item or a login that
  itself signs in elsewhere.
- `vault/signin-managers.test.ts`, a fake program for each manager in its own JSON shapes:
  - 1Password: the empty template password gone, the "sign in with" field with and without the
    item it points at, a passkey-only login, a password `op` measured but didn't print kept,
    Copy into Conch in one read an item;
  - Bitwarden: a note saying so, passkeys only (usable), `signInItemFor`, `signInItem`,
    `fillPolicy` with no password, search by provider, and Copy into Conch keeping both;
  - KeePassXC: "(Passkey)" entries, their key read with `show -a` and made PKCS#8, with or
    without every attribute, and only ES256;
  - Proton Pass and Keeper: learned when read and kept in the list; Dashlane: from words not kept;
  - Conch's own vault: saved and cleared, health leaving them alone (and not counting their old
    password as reused), a passkey's `usable` from the vault, the export line and its import, and
    a passkey-only Bitwarden JSON login imported.

## Consequences

- Protocol: `VaultSignIn`, `SIGN_IN_PROVIDERS`, `signInName`, `VaultItemSummary.signIn`,
  `VaultItemDetail.signInItem` and `SaveVaultItemBody.signIn` (all optional; older clients ignore
  them). `FillPolicy` (gateway) gains `signIn`.
- Not done yet: importing 1Password's `.1pux` (Conch has no `.1pux` importer; its "Sign in with"
  isn't documented and its desktop export has no passkeys). Proton Pass passkeys (COSE). Passkeys
  through the FIDO Credential Exchange Protocol. Asking 1Password which provider a "Sign in with"
  item uses when `op` doesn't say (when 1Password's CLI does, `#linked` reads it).
