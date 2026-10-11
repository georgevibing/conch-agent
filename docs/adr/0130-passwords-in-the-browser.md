# 0130 — Passwords in the browser

- Status: accepted
- Date: 2026-10-11
- Builds on: [ADR 0025](./0025-passwords.md) (the vault, the managers you use, the fill),
  [ADR 0014](./0014-browser.md) and [ADR 0080](./0080-the-browser-does-what-you-do.md) (the
  browser, its live view, handoffs), [ADR 0065](./0065-passkeys-and-approving-from-your-devices.md)
- Keeps: [ADR 0117](./0117-auto-asks-about-what-matters.md),
  [ADR 0118](./0118-auto-judges-every-app-step.md) and
  [ADR 0128](./0128-auto-reads-what-you-asked-for.md) (what Auto asks); ADR 0028 (the guard
  after reading)
- Amends: ADR 0025 § The agent, points 2 and 3 (what a fill asks, and where it may happen)

## Context

ADR 0025 let `browser_type` fill a password field from Passwords. Walking real journeys in
Conch's browser showed where that stopped short of "it figures things out itself":

| Journey                                                        | What happened                                                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A sign-in page                                                 | The browser's prompt told every model to hand the field to the person ("never type one; call `browser_handoff`"), while the Passwords prompt said to use `browser_type`. Weaker models handed off. |
| Username on one page, password on the next (Google, Microsoft) | The username box isn't secret, so the model typed it, and it doesn't know it (`passwords_find` has no accounts). The password page asked again.                                                    |
| A sign-up or change-password form                              | A `new-password` box was treated as a sign-in: Conch offered the old saved password, or handed the box to the person to invent one. Nothing was saved.                                             |
| A two-step code                                                | Worked when one item matched. With several, the model was asked to choose, again, on every page. An item without a code asked first and then failed.                                               |
| Several saved accounts                                         | The list went to the model as text, with each account's subtitle (a card's last four too), and it was told to ask in prose.                                                                        |
| `accounts.google.com` saved, `mail.google.com` open            | No match (only the saved host and hosts under it matched): the person was asked to type it. A saved public suffix (`co.uk`) matched every site under it.                                           |
| A look-alike (`paypa1.com`, `paypal.com.account-check.io`)     | No match, so Conch handed the field to the person: it asked them to type their password into the fake page.                                                                                        |
| A card checkout                                                | One question per box: number, expiry, security code.                                                                                                                                               |
| An item in 1Password                                           | Filled, but `fillPolicy` listed 1Password again before Conch's own card, which could raise 1Password's prompt first. A username box could get the item's secret when it had no username field.     |
| You signing in by hand in the live view                        | No way to use Passwords: open Passwords, copy, paste.                                                                                                                                              |
| Read only mode                                                 | A fill ran: the secret path never went through the mode check.                                                                                                                                     |

## Decision

### Which box is which (`browser/fill.ts` `classify`)

Conch reads the box and its form in the page: each box's type, `autocomplete`, name, label and
whether `markSecrets` called it secret, and the form's buttons (names only, never a value). A
box alone says `username`, `current-password`, `new-password`, `one-time-code` or `cc-*`; the
form's shape says the rest:

- two password boxes and no "current" one are a sign-up and its confirmation;
- a box beside a "new" one is the current password when there are three, else the new one's twin;
- one plain password box is new when the form's button says _Create account_ or _Sign up_ (and
  not _Sign in_);
- a password box that says "code" is a one-time code.

### Which item belongs on the page (`vault/match.ts`)

`matchSite` ranks a saved site against the page's host: `exact` (`www.` aside), `within` (the
page is under the saved site, ADR 0025's rule) and `related` (the same registrable domain by the
Public Suffix List with its private part, as Chrome, 1Password and Bitwarden match). So
`alice.github.io` and `bob.github.io` are never related, and a saved public suffix matches
nothing but itself. `matching()` returns items closest first, then the one used last; cards are
apart (`cards()`). Items from other managers come from their last list, so a fill never raises
another app's prompt before Conch's own card.

A `related` match always asks, even for an item allowed without asking, and the card says where
it's saved. **Always** there adds that host to the item's sites.

### One question per sign-in

The first fill of a sign-in asks once: _Sign in as ada@example.com on example.com?_ (Nacre
`BrowserApproval`, `fill: 'sign-in'`). The person's OK is remembered on the chat's tab for that
item and site for ten minutes (`rememberSignIn`), so the username page, the password page and
the code page don't ask again. The item chosen is, in order: the one the model named, the
sign-in under way, the one whose account is already in the form, or the closest match.

- **Several accounts:** the card lists them, names only (`BrowserPermission.accounts`). A tap is
  the answer: `permission.respond` carries `choice`, and the question's `choose` takes it or
  makes the answer a no (`AskRequest.choose`, beside `edit`). A chat app's plain Allow picks the
  closest, most recently used one. "Always" isn't offered while choosing.
- **The username** fills from an empty `browser_type` on a username box, so the model never
  needs to know it.
- **A code** comes from the item's own code, made in the gateway (`totpNow`) or the manager's
  (`source.totp`). With no item that has a code, the person types it, and nothing asks first.
- **A card** always asks, and fills the form's card boxes together.
- **Always** is offered for sign-ins and codes only, and not in a chat that read something
  untrusted: the card carries the guard's note (ADR 0028), as other browser cards do.

### A new password

On a `new-password` box Conch asks each time (_Make a strong password for shop.example?_, no
Always): it makes one with the generator of ADR 0025 (20 characters, every class), saves it
**before** typing it (`VaultService.saveNewPassword`), then fills every new-password box and an
empty current-password box with the old one. An item it replaces keeps the old password in its
history; an item from another manager can't be written, so a new Conch login is made beside it.
The account comes from the form's username box, read in the gateway. Saving first means a
password a site accepted is never lost; if the site refuses it, the old one is in the history and
the model is told to say so.

### Look-alikes (`lookalikeOf`)

When nothing saved belongs on the page, Conch checks whether the page is dressed up as a site the
person keeps: its whole address in front of another (`paypal.com.account-check.io`), the same
name in other letters (`paypa1.com`, a Cyrillic `а` in punycode, Unicode UTS #39's confusables via
`memory/guard.ts` `skeleton`), one slip of the keyboard on a name of six letters or more (a letter
left out, added, doubled, or two swapped; not a letter changed, so `notion`/`motion` don't trip
it), or the name wrapped in words (`netflix-login.com`). Names under four letters are never
judged. Then nothing is filled and nothing is handed to the person: the model hears that the page
isn't that site and must tell them, and the live view says _This isn’t paypal.com._

### When you drive (the live view)

After your click, the gateway looks at the box you're in (`offerFor`): what's saved for the
site, by name, or why not (`BrowserFillOffer`: `lookalike`, `blocked: 'insecure' | 'frame'`,
`locked`). Nacre `BrowserFill` shows it under the toolbar while you have the wheel: an account to
press, or **Use a strong password**. Pressing it sends `{ type: 'fill', item | generate }`; the
gateway finds the focused box again and runs every check again (`personFill`): the offer the
page showed is never trusted. Your press is the OK, so nothing asks, and the sign-in is
remembered for the agent's next steps.

### The guards, for every fill

- Read only mode fills nothing.
- https, or this computer (`localhost`, `127.0.0.1`, `[::1]`) only.
- The box's frame must be the page's own **origin** (scheme, host and port), not only its host:
  a sign-in box from another origin is never filled, same site or not, and the person is told
  why if it's handed to them.
- A secret goes only into a box the masks cover (`data-conch-secret`), so it can't show in a
  screenshot a model looks at; a username goes anywhere.
- The vault's `fillPolicy` checks the site again for every value; an external item's username
  box never falls back to its secret.
- The model hears what was filled and from which item, never a value; values are remembered for
  redaction (ADR 0025 § Redaction), a generated one from the moment it's made.

### Every provider

The tools didn't change shape: `browser_type` with an empty `text` on the box. The browser's
prompt and the Passwords prompt now say the same thing to every engine (`BROWSER_PROMPT`,
`VaultService.promptSection`), and `browser_passkey` is in the browser's list of tools. Choices,
cards and the live view are Conch's own, so nothing depends on what a provider can do.

## Security

Threat model, beyond ADR 0025's:

- **A prompt-injected agent** steering a fill: it can choose the box and pass an `item`, never
  the site; the site check runs in the vault for every value; a look-alike gets nothing; a
  related site always asks; a new password always asks; Read only fills nothing.
- **A hostile page** reading what's filled: only its own origin's boxes; never a frame from
  another origin; never over plain http. A page can lie about a box's labels (the facts are read
  in the page), so a secret only goes into a masked box, and the role decides only which of the
  item's values goes where, on the item's own site.
- **The live view** (a signed-in device): the press is a person's action, like answering the
  card; the gateway re-derives the box, the role and the site, and refuses an item not saved for
  the page. A stolen session could already drive the browser; it still can't see a value.
- **A shared host** (`github.io`, `myshopify.com`): the private part of the Public Suffix List
  keeps tenants apart.

Sources followed: the WHATWG HTML autofill tokens (`username`, `current-password`,
`new-password`, `one-time-code`, `cc-*`); Chromium's password manager design (PSL matching, offer
not autofill on a related site, never into a cross-origin frame); the Public Suffix List and
its private section; Unicode UTS #39 (confusables); OWASP ASVS 5.0 V6 and V13.3; NIST SP
800-63B-4 §3.1.1.2 (let people use password managers and paste); Greshake et al. 2023 and
AgentDojo (2024) for the injected agent.

Tests:

- `vault/match.test.ts`: the three matches, shared hosting, public suffixes, this computer and
  addresses; every look-alike rule, and the near misses that must not trip it.
- `browser/fill.test.ts`: which box is which on sign-in, sign-up, change, code and card forms;
  where a fill may happen (http, frames from another origin, ports, `about:srcdoc`).
- `vault/vault.test.ts`: ranking, related sites asking, Always joining a host, what an item can
  fill, look-alikes, saving a new password and a changed one, a 1Password item read from its last
  list.
- `browser/browser.test.ts` (a real Chromium): one question for a username page, a password page
  and a code; picking one of two accounts (and a choice never offered refused); a sign-up's new
  password made, saved and filled twice; a change with the old one in its box and in history; a
  sign-in box from another origin never filled; Read only; the live view's offer, a press while
  the assistant drives, an item for another site refused, and the fill itself.
- Nacre `Browser.test.tsx`: the sign-in card, choosing an account, no Always for new passwords
  and cards, the bar's offers, its look-alike warning, and only while you drive (axe on each).

## Consequences

- Protocol: `BrowserPermission` gains `fill`, `accounts`, `savedFor`; `permission.respond`
  gains `choice`; the live view's `typing` event gains `fill`, and the live view takes
  `{ type: 'fill' }`. Older clients ignore them; an older gateway ignores `choice`.
- Not done yet: offering to save a password you typed by hand during a handoff or a takeover
  (Chrome's "Save password?"); addresses and identities (they still go to the person); card boxes
  inside a payment provider's frame (Stripe's are another origin, so the person types them);
  well-known groups of sites that share one account (`youtube.com` with `google.com`); a code
  from a text message or an email.
