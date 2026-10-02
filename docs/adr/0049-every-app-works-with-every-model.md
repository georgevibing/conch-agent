# 0049 — Every app works with every model

- Status: accepted
- Date: 2026-10-02
- Amends: [ADR 0009](./0009-integrations.md) (Gmail, Calendar, Drive and Slack through a
  provider's account; "Also set up in the engine"), [ADR 0012](./0012-every-provider-at-once.md)
  (account services that say which provider brings them; **From your providers**),
  [ADR 0021](./0021-connect-from-chat.md) (offers through Zapier)
- Builds on: [ADR 0037](./0037-direct-google-accounts.md) (Google as Conch's own),
  [ADR 0018](./0018-channels.md) (the Slack channel), [ADR 0028](./0028-safe-hands.md) (the guard
  after reading)

## Context

The promise of the Integrations page is that what you connect works with every model you pick.
Two things broke it:

- **Slack** was `auth: 'account'`: it only worked through the claude.ai connectors, with Claude
  Code signed in on a subscription. Every other model got "Only with … models" or a Zapier
  detour. Meanwhile Conch already had a Slack _channel_, built on a Slack app the person makes in
  their own workspace.
- **From your providers** put servers a provider set up by itself on the main page. They only
  work with that provider, and the ones Conch could connect itself (a catalog app, a plain web
  address) waited for a click on "Use with every model".

## Decision

### Nothing in the gallery depends on the provider

`CatalogAuth` loses `account`. Every catalog entry is something Conch connects itself: an MCP
server (`blueprint`) or one of Conch's own tool families with its own sign-in (`google`,
`slack`, `HOST_FAMILIES`). `catalog.test.ts` fails, with the fix in its message, on an entry
that is neither. An engine's account connectors (`EngineIntegrations.account`) shrink to a label
and an address: they only say where one of its servers came from. Suggestions never go through
Zapier any more, and the `via` field of an offer is gone.

### Slack is Conch's own

One user token (`xoxp-…`) from the person's own Slack app, kept in `slack.secrets.json`
(sealed, `secret` in backups, protected from agent tools, listed in Passwords).

- **Setup.** The Slack app manifest Conch fills in (`features/channels/guides.ts`) now carries
  user scopes (`SLACK_USER_SCOPES`) beside the channel's bot scopes, so one app does both jobs.
  The connect dialog makes the app from a link, or — when a Slack channel is connected, and only
  after the person presses **Use it** — points at that same app's Install App page. The person
  pastes the **User OAuth Token**; Conch checks it with `auth.test`, refuses a bot or app-level
  token in words, and names the permissions an older app is missing, with the settings that fix
  it. The channel's keys are never shared with it: the bot token can't read your channels or
  search, and the user token is a separate grant the person makes on purpose.
- **Tools** every provider gets (`slack/tools.ts`): `slack_channels`, `slack_search`,
  `slack_read_channel` and `slack_send_message`. Reads go by themselves unless the person chose
  Ask (per tool Allow · Ask · Off), taint the chat (`taintFrom`: Slack messages) and carry a
  note that they're other people's words. Sending always asks with the exact words and the
  channel, carries the guard-after-reading and skill-limit reasons on the same card (the generic
  preflight skips it, as for Gmail drafts), refuses when the sign-in changed while it waited, and
  can be turned off but never set to Allow. A send whose answer was lost is _ambiguous_, never
  reported as failed, so the model doesn't send twice.
- **Wire.** One fixed origin (`https://slack.com/api`; only tests and the pretend Slack point
  elsewhere), an allowlist of methods, POST bodies (the token never in a URL), no redirects, a
  15 s timeout, answers bounded to 2 MB, and the token scrubbed from every error.
- **Health.** Checked at start-up, every half hour and from Repair everything. A refused token
  needs you (the tools stop being offered, and the prompt says so); Slack being away is retried
  with backoff and leaves a "fixed on its own" note when it comes back. Disconnect asks Slack to
  revoke the token too.

Why not OAuth: Slack's OAuth needs the app's client secret, which a self-hosted Conch can't ship
and the person would have to copy anyway, plus an HTTPS redirect. The Install App page already
shows the token; one paste is the shortest honest path.

### What a provider set up comes in by itself

`IntegrationService.external()` (at start-up, every half hour, and whenever the list is asked
for) brings in what Conch can connect itself, without a click:

- a server that matches a catalog app Conch connects with nothing for you to type (an `oauth`
  or `none` web server, no required fields) — including a provider account's own connector for
  it;
- a server at a web address with nothing secret in it (`adoptableUrl`), unless it's a provider
  account's own (its address belongs to the provider and may carry its sign-in).

OAuth ones arrive waiting for a sign-in; no sign-in page is opened by itself. Each leaves one
`services.healed.note` sentence.

**Found, not connected** (amended the day this was accepted, after the first real use: a
provider's plugin brought eight servers, which arrived as eight warning cards under
**Connected** saying **Sign in again**, counted in the sidebar, half of them unable to sign in
at all). What Conch brings in keeps where it was found (`Integration.from`: the provider, the
source, the plugin) and, when its name is exactly an app Conch knows, that app's name and logo
(`likeness`, `Integration.brand`). Until it has worked once it is an offer, not a problem
(`awaitsSignIn` in the protocol, shared by both sides):

- Apps shows it in its own section, **Found in <provider>**, last on the page, below what
  Conch offers (the page reads: connected, the gallery by kind, what was found): one sentence
  on where they came from, then one small tile each with **Sign in** and a way to leave it out.
  No switch, no status, no warning colour.
- It isn't counted in the sidebar, and Repair everything doesn't list it.
- A sign-in left half-way or one that didn't start keeps it there; pressing the button starts
  again.
- Once it has worked it is an ordinary card. A sign-in that later runs out is a problem to fix
  (**Sign in again**), because `health.okAt` is kept across every change of state.

**Only what Conch can really connect.** Signing in to a server starts with Conch registering as
a new app (RFC 7591). Some services only take apps they already know; a provider's plugin ships
as one. Before an address comes in, `OAuthFlows.canSignIn` reads the service's public sign-in
metadata (RFC 9728, RFC 8414, through the guarded fetch) and brings it in only when it can
register, or nothing there asks for a sign-in. One brought in earlier that can't is let go on the
next look, with a note. These stay with their provider. Not knowing (the service didn't answer)
means not now. The SSRF guard (`integrations/net.ts`) applies
before anything is stored. Nothing comes in twice (same catalog app or same address), and
nothing you disconnected comes back: `integrations.json` keeps `removed`, `catalog:<id>` or
`url:<sha-256 of the address>` (never the address). Connecting it again yourself clears it.

What's left — programs in a provider's settings, plugins, account connectors with no app of
their own, services that take no new apps — only works with that provider, so it moves off the Integrations page to **Settings
→ Providers → Set up inside a provider**, folded. Things you disconnected wait there with **Use
with every model** (`POST /api/integrations/adopt`, still looked up by name on the gateway, so
a forged request can only bring in what the provider really has).

## Threat model

- **The agent** may be steered by what it reads in Slack (Greshake et al., 2023; OWASP LLM01
  and LLM06, 2025). It can read freely but can't send without the person seeing the exact words;
  it can't change the tools' policies (the Integrations page is a person's action), and
  `slack.secrets.json` is a protected path.
- **A web page or another origin** can't reach `/api/slack` (the gateway's Host, Origin and
  session checks). The token only comes in once, in a body, and is never returned.
- **A provider's settings** are not trusted to choose where Conch connects: adopted addresses go
  through the SSRF guard, and an address with a credential in it is never adopted.
- Not covered: someone with the same OS account can read the sealed file's runtime copy in
  memory, as for every other key (ADR 0025).

## Consequences

- New data: `slack.secrets.json`; `integrations.json` gains `removed`.
- New routes `GET/PATCH/DELETE /api/slack`, `POST /api/slack/connect`, `POST /api/slack/check`,
  and the socket message `slack.changed`.
- `IntegrationProvider.account` loses `ready`/`hint`; `ExternalIntegration.adoptable` now means
  "you disconnected it; bring it back".
- Anyone with an older Slack channel app needs to update its manifest once to use Slack with
  every model; the dialog shows how.

## Sources (reviewed 2026-10-02)

- [Slack: tokens](https://docs.slack.dev/authentication/tokens), [user scopes in app
  manifests](https://docs.slack.dev/reference/app-manifest), [auth.test](https://docs.slack.dev/reference/methods/auth.test),
  [auth.revoke](https://docs.slack.dev/reference/methods/auth.revoke), [search.messages](https://docs.slack.dev/reference/methods/search.messages),
  [rate limits](https://docs.slack.dev/apis/web-api/rate-limits)
- [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- Greshake et al., _Not what you've signed up for: Compromising Real-World LLM-Integrated
  Applications with Indirect Prompt Injection_ (2023)
