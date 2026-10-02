# 0052 — One app, one card

- Status: accepted
- Date: 2026-10-02
- Amends: [ADR 0009](./0009-integrations.md) (the Integrations page), [ADR 0018](./0018-channels.md)
  (the Channels page), [ADR 0025](./0025-passwords.md) (1Password as a source),
  [ADR 0034](./0034-show-me.md) (the sidebar's pinned apps), [ADR 0048](./0048-google-apps-and-gmail-app-password.md),
  [ADR 0049](./0049-every-app-works-with-every-model.md) (Slack's own routes)

## Context

The same real-world app showed up in several places, each with its own words:

- **Slack** was a channel (a bot you message, `channels/`, the Channels page) _and_ an app the
  assistant uses (`/integrations/slack`, its own `/api/slack` routes, `SlackCard`, `SlackDetail`).
- **Gmail** was an email channel (IMAP and an app password) _and_ the Gmail app (now IMAP and an
  app password too, sharing `channels/imap.ts`).
- **Teams** was a channel, while Zapier's example said "Send the summary to my team in Teams".
- **1Password** was a Passwords source (`vault/sources.ts`) _and_ the 1Password Environments
  integration, both called "1Password".
- Integrations and Channels were two sidebar entries, and the sidebar already had a group called
  "Apps" for pinned things the assistant made.

A person thinks "Slack", not "the Slack integration" and "the Slack channel". Two pages, two
cards and two setups for one app is the kind of thing Conch exists to remove.

## Decision

### Apps

Integrations is called **Apps** wherever a person reads it: the sidebar, the page, its routes
(`/apps`, `/apps/:id`), ⌘K, Repair everything's groups and buttons, errors that say where to fix
something, the prompt's section and its advice to the model, and the documentation. Internal names
stay (`IntegrationService`, `integrations.json`, `/api/integrations`), since renaming them would be
churn with nothing for anyone.

Old addresses keep working. `/integrations`, `/integrations/:id` and `/channels` lead to the same
place in Apps with everything they asked for (`?connect=`, `?setup=`, `?result=`, `?google=`), so
bookmarks, old notifications and ⌘K history land where they should. Sign-in returns go to `/apps`
directly. `/integrations/done` stays the sign-in window's own page, and the OAuth redirect address
(`/oauth/callback`) is unchanged, so registrations made before keep working.

An unconnected app's address opens setup only on a new visit. If an app that was
being viewed disappears from the live list, its page returns to Apps instead of
reopening sign-in. If another half remains, that half stays on the app's page.
This also holds when a deletion event arrives before disconnect navigation settles.

The sidebar's pinned group is called **Pinned**, and pinned things stay at `/apps/a_…`: an artifact
id always starts with `a_`, which no app id does, so `Shell` tells them apart without a second
route.

### One card per app

`joinApps` (web `features/integrations/apps.ts`) makes one item per app from the halves Conch
has: an integration (MCP or Conch's own), the chat apps that are its "Talk to me here", and, for
1Password, its Passwords source. The gateway says which app a channel belongs to (`Channel.app`:
`slack` for a Slack bot, `gmail` for an email channel on Gmail), worked out from its keys and never
stored, so existing `channels.json` files read unchanged. A half on its own is still its app's card
(a Slack bot with no Slack app is the Slack card); a chat app that belongs to no other app is a card
of its own in the same grid (Telegram, WhatsApp, Teams…).

A card sums up its halves: what's wrong comes first with its one fix; a hello to finish or someone
waiting is a calm next step (Nacre `IntegrationCard`'s `notice`), not a warning. The card's switch
is the whole app's: every half goes on or off together, and turning a way in back on still needs a
person who confirmed it's them.

### Channels is a filter of Apps

The Channels page is gone; it's **Talk to me here**, a filter of Apps beside Work, Files and the
rest, with the chat apps in the gallery and the "how it works" steps when none is connected yet.
With everything showing, the gallery is laid out by those same kinds, a heading over each (Work,
Talk to me here, Files, Passwords, Design, Business, Developer, Home), each app once under its
own kind; a filter or a search shows one flat list.
`/channels` opens it. A chat app's setup and detail pages keep their addresses (`/channels/new/:kind`,
`/channels/:id`), and lead back to Apps (or to the app they're a half of).

Why not keep two pages: then Slack's "Talk to me here" would be on Apps while Telegram's would be on
Channels, and a person would have to know which kind of app something is before knowing where to
find it. One page with a filter needs no such knowledge; the filter is there for whoever wants it.

### What it does, as switches

An app's page starts with **What it does** (Nacre `AppAbilities`): one switch for each thing it
does. Conch's own apps say it in their own words (Gmail: Read & search, Draft; Slack: Read &
search, Send (asks first); Calendar; Drive); any other app gets Look things up and Make changes.
A switch turns its tools off, or back to what the app's policy says; Allow · Ask · Off per tool
stays below for whoever needs it. An app that can talk to you has **Talk to me here**, and 1Password
has **Fill sign-ins from 1Password** and **Manage Environments**. A half that isn't set up has the
button that sets it up instead of a switch.

### Setting up one half offers the other

Always asked, never done by itself, and only where the security boundaries already drawn allow it:

- **Gmail ↔ email.** They can share a sign-in: both are IMAP with the same Google app password.
  ADR 0048 already offered the email channel's password to Gmail (**Use it for Gmail**). The
  other way is new: `GET/POST /api/channels/email/gmail` offer Gmail's app password for talking by
  email. The browser only learns the address; pressing it needs a recently verified session, like
  `/api/google/mail/reuse`; the channel signs in before anything is kept, and you're in at once
  (your own address is the hello, ADR 0044). This is a one-tap switch on Gmail's page, and a one-tap
  offer in Gmail's connect dialog.
- **Slack.** They can't share a sign-in. The app's user token (`xoxp-`) and the channel's bot token
  (`xoxb-`) and app-level token (`xapp-`) are different grants, and ADR 0049 deliberately never
  shares one for the other. So the offer is the shortest honest path: after connecting Slack as an
  app, **Talk to Conch in Slack too?** opens the channel's setup with the first step already done
  (`?with=app`: the app exists, made from Conch's manifest with both sets of scopes), leaving the two
  keys to copy. From a Slack bot's page, **Let Conch read and send in Slack too?** opens Slack's
  connect dialog, which offers the same app (**Use it**) and asks for the user token.

### Slack is a hosted app like Google's

`SlackApps` (`slack/apps.ts`) implements `HostedApps`, and `hostedApps()` (`integrations/hosted.ts`)
joins it with `GoogleApps`, so `IntegrationService` lists, opens, switches, checks and removes Slack,
Gmail, Calendar and Drive the same way, on the same page and card. Slack gains the app-wide policy
every app has (`slack.secrets.json` without one reads as **Ask before changes**, and per-tool
choices are kept); reads honour it, sending always asks. `GET/PATCH/DELETE /api/slack`,
`POST /api/slack/check`, the `slack.changed` event, `SlackStatus` on the wire, `SlackCard` and
`SlackDetail` are gone; Slack tells pages about itself with `integration.changed` and
`integration.deleted`. What setting it up needs stays: `POST /api/slack/connect` (answers with the
app) and `GET /api/slack/setup` (the Slack channel's app, by name only).

### Every password manager is an app

1Password had a card in Apps because it's in the catalog (below); Bitwarden, KeePassXC, Proton
Pass, Dashlane, Keeper and the macOS Keychain had none, though each does for a person exactly what
1Password's card says: it fills sign-ins. To a person that read as a mistake. Now each manager
Passwords can read is an app (`managerItem` in web `features/integrations/apps.ts`):

- One that's on has a card under **Connected** ("fills sign-ins"); its switch is the manager's own.
- The others are tiles in the gallery, under the kind **Passwords** (1Password's catalog entry is
  in that kind too). A tile opens the manager's page, `/apps/<id>`, which is one switch: **Fill
  sign-ins from <name>**, with where to unlock it or what it still needs.
- ⌘K finds each by name.
- One this computer can't run (`VaultSource.available: false`: the macOS Keychain off a Mac)
  isn't offered in Apps, in ⌘K or in Passwords' own list.

Nothing about how a manager is read changes (ADR 0025): the page's switch is the same
`PATCH /api/vault/sources/:id` that Passwords uses, unlocking still happens in Passwords, and
Apps asks for the list without `look`, so no manager's own approval window comes up from here.

### 1Password: one entry point, two clearly named halves

They're different features — one reads your logins through 1Password's command line for Passwords,
the other is 1Password's local MCP server for Environments — but one app to a person. The
1Password tile (Sign-ins and Environments) opens **its page**, whichever half is on, with **Fill
sign-ins from 1Password** (the Passwords source's switch; **Set up** opens the password managers in
Passwords when its program is missing) and **Manage Environments** (the integration; **Set up** is
its connect dialog). Merging the two into one integration was wrong: they need different programs,
different unlocks and different trust (Passwords' fill policy versus an MCP server's tools), and
each stays where its rules live. A 1Password card shows once either half is in use.

### Zapier's example

Teams is an app in Conch to _talk to the assistant from_, not one it posts to your team in, so
Zapier's example doesn't point at it; it's "Make a Trello card for this" now.

## Security

Nothing new can be reached, and no credential moves without a person:

- `POST /api/channels/email/gmail` is a trust decision (it opens a way in): it needs a recently
  verified session from any device, as `/api/google/mail/reuse` does, and is tested from another
  device with an old session (refused). The password stays on the gateway; only the address is ever
  said (`GET` answers `{ address }`, tested). The email channel it makes keeps every rule of ADR
  0044: only your own mail, checked by your provider's `Authentication-Results`.
- Slack's tokens stay apart (ADR 0049): no route or offer turns one into another.
- `Channel.app` is derived from the channel's keys on the gateway (the mail provider) and says
  nothing secret.
- The card's switch turning a channel back on goes through the same verified-session guard as the
  channel's own switch.
- Removing `/api/slack`'s routes removes surface; what remains (`connect`, `setup`) is unchanged in
  its checks (body limit, no-store, token never returned).

## Consequences

- New: `Channel.app`, `ChannelCatalogEntry.short` (a tile's few words), `SlackSetup`,
  `GET/POST /api/channels/email/gmail`, `GET /api/slack/setup`; Nacre `AppAbilities` and
  `IntegrationCard`'s `notice`.
- Gone: `/api/slack` (`GET`, `PATCH`, `DELETE`, `/check`), `slack.changed`, `SlackStatus`,
  `SlackUpdateBody`, `SlackTool` in the protocol; the Channels page and sidebar entry.
- Data: nothing to migrate. `slack.secrets.json` gains `policy` with a default; `channels.json` is
  read as before; old addresses redirect.
- Repair everything groups its checks under **Apps** and **Talk to me here**.
- The e2e journey `apps` (port 4369) connects Slack as an app, turns on Talk to me here with the
  same Slack app, and a message arrives; and turns on Gmail's Talk to me here in one tap.
