# 0014 — The browser

- Status: accepted
- Date: 2026-09-30
- Extended by: [ADR 0080](./0080-the-browser-does-what-you-do.md) (tabs, uploads, the
  person's gestures, clicking by position, handoffs that finish by themselves, your own Chrome
  and browsers in the cloud)

## Context

Browsing is the skill people expect from a personal agent. OpenClaw, Hermes, Manus,
ChatGPT agent (Operator) and Claude in Chrome all have it. What people complain
about is consistent (research, Sept 2026):

- **Setup is a project.** People install Playwright, download browsers, pick a
  CDP port, edit an MCP config, and fight profile locks when a crashed Chrome leaves
  `SingletonLock` behind. Conch's own catalog shipped the Playwright MCP server
  behind an `npx` command (ADR 0009), which is exactly this.
- **You can't see what it's doing**, or you see a screenshot after the fact. When it
  gets stuck on a sign-in page or a captcha, it gives up or asks you to paste a
  password into the chat.
- **Prompt injection is the headline risk.** A web page can carry instructions
  (Greshake et al., 2023; Unit 42, "Web-Based Indirect Prompt Injection Observed in
  the Wild", 2026). OpenAI says prompt injection in AI browsers "may never be fully
  patched" (Lockdown Mode, Feb 2026). The research consensus (WAInjectBench 2025;
  WARD 2026; Prismata, Villa et al., July 2026) is that no single filter is enough.
  Only architectural limits on what the agent can see and do hold up against an
  attacker who "moves second".
- The products that do it well share a shape. **Takeover** for credentials and
  payment, where the agent never sees what you type (Operator). **Confirmation**
  before significant actions such as ordering, sending or downloading (Operator,
  Claude in Chrome). **Per-site permission** with sensitive categories asked
  separately (Claude in Chrome).

## Decision

Conch has **a browser of its own**. The gateway runs it, every engine can use it, and
you can watch it and take the wheel from a panel in the chat.

### Zero setup, and it fixes itself

- **It uses the browser you already have.** Conch looks for Chrome, Edge, Brave or
  Chromium in their usual places (every Windows PC has Edge) and launches it
  headless with `playwright-core`. It already ships in the lockfile, so no new
  download is needed.
- **Nothing installed?** It downloads Chromium into Playwright’s usual cache the first time
  the agent needs it, with progress in the panel. It doesn't ask first. It only asks
  when that fails (offline, disk full), in plain words with one button.
- **A profile of its own**, `~/.conch/browser/profile`. Your own browser's cookies
  are never touched. Sites you sign in to inside Conch stay signed in, so you sign in
  once. "Sign out of everything" wipes it.
- **Self-healing.** Everything that commonly goes wrong is fixed before anyone is
  asked:
  - A browser left holding the profile (after a crash) is found by its command line
    and ended, and the stale locks are cleared. Conch looks for the process itself
    rather than trusting error text: on Windows a second browser hands over and quits
    without saying why.
  - A browser that crashed or quit is relaunched, and each chat's tab is restored.
  - A browser that won't launch falls back to the next one found, then to a
    download.
  - A navigation that times out is retried once with a lighter wait.
  - A click the page intercepts (a cookie banner, an overlay) is reported with the
    blocker's name so the agent can deal with it.
  - Common cookie banners are declined politely (reject or "necessary only") before
    the agent reads the page. You can turn this off.
  - It shuts down after 10 idle minutes and comes back on demand.
- **Health you can see.** Settings › Browser shows what's running and why. **Repair**
  runs every fix in turn. Wiping the profile is the last step, and only after you
  confirm, because it signs you out.

### What the agent gets (every engine)

One tool set, written once in `apps/server/src/browser/tools.ts`, reaches every
engine the way ADR 0009 reaches them:

- **native** engines (Claude Code) get an in-process SDK MCP server named
  `conch_browser`. The tools run inside the gateway, so no port or process is
  exposed.
- **bridge** engines (API providers, the mock) get the same tools as
  `bridgedTools`.

The tools are `browser_open`, `browser_read`, `browser_click`, `browser_type`,
`browser_press`, `browser_select`, `browser_scroll`, `browser_back`,
`browser_screenshot`, `browser_wait` and `browser_handoff`. Pages are read as
Playwright's AI accessibility snapshot, with element refs, so the agent acts on
`ref`s rather than guessing coordinates. Each action returns only what changed
since the agent last read the page, as a small diff; a new page, a big change or
`browser_read` returns it whole (ADR 0077).
`browser_handoff` asks you to take over (sign in, solve a captcha, pay) and waits
until you hand back. `browser_screenshot`'s picture reaches every engine that can
see it, in its own shape, and a model that can't gets it described by one that can
([ADR 0070](./0070-every-model-sees-the-page.md)); its text gives the viewport size.

### Every engine, or an honest no

Codex CLI has no host tools yet (`hostTools: false`), so it doesn't get the browser.
Its turns are told nothing about one, and the panel still works for you. The API
engines' "you can't browse" note is only there when the browser tools aren't.

### Watch it, take the wheel

- The chat's **browser panel** slides in the first time the agent browses. It
  streams the page (CDP `Page.startScreencast`, JPEG, only while someone is
  watching, latest-frame-wins) over its own WebSocket, `/api/browser/live`.
- An iridescent **agent cursor** shows where the agent points and clicks. A caption
  says what it's doing ("Typing in _Search_"), and the transcript gets a card with a
  thumbnail for every action.
- **The page takes the panel's shape.** The panel reports its size, and the tab's
  viewport becomes desktop-wide (about 1.6× the panel, 960–1440 px) and as tall as
  the panel. Nothing is letterboxed, and a wider panel gives bigger text.
  Thumbnails are cut from the view around whatever a question is about.
- **Take over** by clicking into the page, or with the button. The agent is paused:
  its next browser action waits until you hand back. Your keystrokes go straight to
  the browser over CDP `Input.*` and are never recorded or shown to the model. The
  screen is a button (pointer) plus a hidden text field (keys), as remote-desktop
  clients do, so input methods and phone keyboards work and jsx-a11y strict holds.

### Permissions: few questions, the right ones

The browser applies its own rules inside the gateway, so they're identical for every
engine. The engine-level permission for its tools is always "allow".

- **Reading** (open, read, scroll, screenshot, wait) doesn't ask.
- **Acting on a site** (click, type, select, press) asks once per site, meaning its
  registrable domain, per chat: "Let Conch use _booking.com_?" The choices are
  **This chat** and **Always**. "Always" is stored in `~/.conch/browser.json`, needs
  the UI (never the agent), and can be revoked in Settings.
- **High-stakes actions always confirm**, in every mode, with the element shown:
  controls named like buy/pay/order/checkout/send/post/publish/delete/transfer, and
  downloads.
- **Secrets never pass through the model.** The agent can't type into password,
  one-time-code or payment fields (by type, `autocomplete` or label). It's told to
  hand off instead. Those fields are masked in snapshots and in screenshots sent to
  the model (Playwright `mask`). The spike showed that raw AI snapshots include
  password values.
- **Plan only** mode can read but not act. **Full trust** skips the per-site question
  but not the high-stakes confirmations or the secrets rule.

### Containment

The agent's browser runs as you on your machine, so it is treated as untrusted:

- **Never Conch itself.** Every request, WebSocket and navigation to the gateway's own
  address is blocked (Playwright `context.route` and `routeWebSocket`, with service
  workers blocked so nothing slips past). The gateway trusts loopback (ADR 0008), so
  without this block a page could make the agent approve its own permissions.
- **Not your network, by default.** Loopback, private (RFC 1918, ULA), link-local and
  cloud-metadata addresses are blocked, by IP literal and after DNS resolution
  (`integrations/net.ts`). **Let it open local apps** (localhost) is an explicit
  setting, flagged by the security checkup. The gateway's port stays blocked even
  then.
- Only `http(s)` and `about:blank`. No `file:`, `chrome:`, `javascript:` or
  `data:` navigations from the agent.
- Page text reaches the model wrapped as untrusted data, with a line reminding it
  that instructions on a page are not the user's (spotlighting; Hines et al., 2024).
- Downloads land in `<workspace>/Downloads` only after confirmation, via `safeJoin`.

## Consequences

- New runtime dependencies (gateway), both already in the lockfile:
  - `playwright-core`, the same version as the e2e tooling. It is Apache-2.0 and
    bundles no browser.
  - `tldts` (MIT), the Public Suffix List for per-site permissions.
- `PROTOCOL_VERSION` 5: the `browser.step` and `browser.handoff` log events,
  `permission.requested.browser`, and `browser.status`.
- New data: `~/.conch/browser.json` (settings, sites you always allow, the user
  agent learned per browser), `~/.conch/browser/profile/` and
  `~/.conch/browser/shots/`.
- The catalog's "Web browser (Playwright MCP)" entry is retired in favour of the
  built-in browser. An already-connected one keeps working.
- Residual risk, documented in the UI: an approved site could still inject
  instructions that make the agent act _within that site_. A page can also leak what
  the agent read on it through URLs it navigates to. Per-site approval,
  high-stakes confirmation and the secrets rule limit the blast radius. They don't
  remove it.
