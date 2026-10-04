# 0080 — The browser does what you do, where you choose

- Status: accepted
- Date: 2026-10-04
- Extends: [ADR 0014](./0014-browser.md) (the browser)
- Keeps: [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0031](./0031-skill-trust.md) (what a skill may do),
  [ADR 0025](./0025-passwords.md) (secrets never pass through the model)

## Context

The browser of ADR 0014 read pages and clicked, typed and chose by ref, in one tab per chat.
People do more than that, and so do the agents Conch is measured against (OpenClaw, Hermes):

- **Files.** Applying for a job, sending a form with a photo, filing an expense: the page wants
  a file. Conch had no way to put one there.
- **Tabs.** Links open new tabs and sign-ins open popups. They were folded into one stack the
  agent couldn't see, so it never knew a tab had opened, and couldn't go back to another.
- **Hands.** Menus that open on hover, lists you drag to reorder, double and right clicks,
  shortcuts like Control+Shift+K, and lists that scroll inside a panel.
- **Pages with no refs.** A canvas, a map, a control with no label: the accessibility
  snapshot has nothing to point at. Vision models can see the screenshot; they need a way to act
  on what they see.
- **Your turn, finished.** A handoff waited for "I’m done", even after the sign-in plainly went
  through.
- **Where it runs.** People want the agent in the browser they're already signed in to, and
  people running Conch on a small server want a browser in the cloud. Conch only ran a local
  Chromium.

The bar: weak models must still cope, so the tools stay few and their schemas plain. Every
existing safety rule must hold for every new way in.

## Decision

### The agent's hands (every engine)

Three tools join, and three grow, rather than a tool per gesture:

- **`browser_click`** takes `how`: `click`, `double`, `right`, `hover` or `drag` (onto `to`, a
  ref). It scrolls the element into view first, inside whatever list or panel holds it. Hovering
  changes nothing, so it asks nothing, like reading. Dragging checks the words of both ends.
- **`browser_press`** takes shortcuts (`Control+Shift+K`) and an optional `ref` to press on. A
  shortcut on a secret field is refused: pasting is typing.
- **`browser_scroll`** scrolls the page, brings a ref into view, or, with both, scrolls inside the
  list or panel around the ref (the nearest ancestor that scrolls that way, else the wheel over
  it). Left and right too.
- **`browser_tabs`** lists, opens (with an address or a search), switches and closes tabs. A link
  to a new tab or a popup becomes a tab by itself and comes into view; the agent's next result
  says "That opened a new tab, t2". Every result names the tabs once there are two. A chat keeps
  at most eight: a popup past that closes the tab unused longest (and says so), and the agent
  can't open a ninth. Closing a popup comes back to the tab that opened it.
- **`browser_click_at`** clicks at x,y in the last screenshot's pixels, for canvases and
  unlabelled controls. It hovers, double/right-clicks and drags like `browser_click`, and `text`
  types after the click. The screenshot says its size, and the point is scaled if the panel has
  changed the page's shape since.
- **`browser_upload`** puts files into a file box, by ref: a file input, or a button that opens
  the file picker (Conch answers the picker).

### Uploads: narrow, and asked every time

A file can come from three places only: a file the person attached **in this chat**, something
Conch **made in this chat**, or a file in the chat's **work folder**. In the work folder:

- the path is resolved through links first (a link out of the folder is refused);
- nothing hidden (`.env`, `.git/`), nothing key-shaped (`id_ed25519`, `*.pem`, `*.kdbx`,
  `credentials.json`, `.npmrc`…);
- nothing under Conch's own folder, unless the work folder itself is inside it (the default);
- nothing where keys live (`protectedPaths`, `secretPlaces`, the browser's profile), even when
  the work folder is the whole home folder;
- ten files and 50 MB at most.

Every upload asks, whatever the mode (Full trust included), with the files and where they come
from: "Upload “cv.pdf” (attached in this chat) to jobs.example?". There is no "always". In a
chat that read something untrusted, the card carries the guard's note (ADR 0028). Files go to the
browser as bytes, so a cloud browser gets them too.

### Clicking by position keeps every rule

- Plan only refuses it, like every act.
- The site question is asked the same way.
- **High stakes are read from the page, not the agent:** Conch finds what's under the point
  (through frames, cross-origin ones included) and checks its own words (`Place order`), plus the
  agent's description. A canvas with a painted "Buy" button is the residual risk: its words
  aren't in the page, so only the site question and the agent's own description stand guard.
- **Secrets:** typing at a point that lands in a password, code or card field hands the field to
  the person, as `browser_type` does. After the click, the focused field (in any frame) is
  checked again before a key is sent. Text fields are replaced; a canvas just takes the keys.
- The taint guard covers all new tools (`taintFrom`), and skills hold them (`needs`):
  `browser_tabs` is reading, `browser_click_at` and `browser_upload` are acting.

### Your turn, finished by itself

A handoff that starts at a gate (a password or code field showing, or a captcha frame) is
watched every second. It ends by itself when the gate is behind you: the page moved on with no
password, code or captcha showing (a two-step code page is still a gate), a sign-in popup came and
went, or the captcha left its token in the page. It waits for two looks in a row, and for your
hands to be off the page for a moment, so it never takes the wheel mid-typing. A handoff for
anything else (a payment, your details) still waits for **I’m done**. The card says "You got
through, so Conch carried on". The phone's notification opens the chat with the browser in
front (`?browser=1`) and has **Take over**; the chat apps' message says it carries on by itself.

### Where it runs

`BrowserSettings.backend`: `local` (Conch's own, the default), `chrome` (your own Chrome),
`browserbase` and `steel` (in the cloud), or `cdp` (any browser at a DevTools address). All are
reached through the DevTools protocol (`chromium.connectOverCDP`), so the tools don't change.

- **Chosen in Settings only**, with `PUT /api/browser/backend`: anything but `local` needs a
  recent sign-in. A `PATCH` of the settings can't change it. Keys and addresses go into
  `browser.secrets.json`, sealed like every key Conch uses, `secret` in backups, protected from
  the agent's own tools, listed in Passwords, and never sent back (the settings show only that a
  key is saved, and an address's host).
- **Falls back** to Conch's own browser when the chosen one can't be reached: Settings and the
  health check say why in a sentence; Repair everything connects again. A cloud session is let go
  of when the browser idles (ten minutes), so it isn't billed for nothing.
- **Browserbase:** a session made with the key (`POST /v1/sessions`), then its address.
  **Steel:** its address with the key. Browser Use Cloud was left out: its API couldn't be checked
  against a real account here, and a guess isn't Conch's bar.

### Your own Chrome: the threat model

Attaching to the browser you're signed in to gives the agent your sessions: mail, bank, work.
That is the most a browser can give. Who could abuse it, and what holds:

| Who                                | What they'd try                                    | What holds                                                                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A page the agent reads (injection) | Steer it to act on another of your signed-in sites | Every site asks once per chat, **always**: Full trust and "always allowed" sites don't skip it, and "Always" is never offered or kept. High stakes still confirm. A tainted chat says why on the card.                                         |
| The same page                      | Read your other tabs                               | Conch touches only pages it opened (and their popups): it never lists, reads or closes yours. Its tabs carry a badge, "Conch is using this tab", hidden from what the agent reads.                                                             |
| The same page                      | Reach Conch, or your network, from Conch's tab     | Each of Conch's pages goes past the guard on its own (`page.route`, `routeWebSocket`); it is never installed on your tabs. Conch's gateway keeps its own defences (ADR 0008).                                                                  |
| The agent itself                   | Turn this on, or keep it on                        | Only the settings page turns it on, after a recent sign-in. The security checkup flags it with a one-press way back; a backup that has it says so before it's restored (`browser-own-chrome`).                                                 |
| The agent                          | See or type your passwords                         | Unchanged: secret fields are masked and handed to you; Passwords fills them without the model seeing them.                                                                                                                                     |
| Another program on this computer   | Use the same door                                  | Chrome's own **Allow remote debugging** (chrome://inspect/#remote-debugging, Chrome 144+) is yours to turn on, and Chrome asks you to allow each new connection. Conch reads where Chrome listens from Chrome's own profile, on loopback only. |
| Anyone, after you stop             | Find Conch still attached                          | Letting go closes only Conch's tabs and disconnects; Chrome and your tabs stay. Idle for ten minutes, it lets go by itself.                                                                                                                    |

Chrome 136 stopped `--remote-debugging-port` from working on your default profile, on purpose,
to stop cookie theft by any local program. Conch doesn't work around that: it uses the consented
door Chrome added instead, and never launches your Chrome with switches, copies your profile, or
reads your cookies. An extension (OpenClaw's other way) was set aside: it would be a second
program with broad host permissions to install, update and trust, for the same reach.

The residual risk, said in Settings and the checkup: a site you allow in your Chrome could still
steer the agent within that site, with your real account. That is why the default stays Conch's
own browser.

## Consequences

- Protocol: `BrowserActionKind` gains `hover`, `drag`, `upload`, `tab`; `BrowserPermission.kind`
  gains `upload` and `ownChrome`; `BrowserTab` gains `tabs` and `backend`; the live view takes
  `{ type: 'tab' }`; `BrowserHandoff.auto`; `BrowserSettings.backend`; `BrowserStatus.backend`.
  An older Conch reading a newer log drops the steps it doesn't know.
- New file: `~/.conch/browser.secrets.json` (sealed, `secret` in backups, protected).
- New checkup item `browser-own-chrome`, fix `browser-own-chrome-off`; backup power
  `browser-own-chrome`; health check `browser-backend`.
- No new dependency: `playwright-core` already speaks CDP.
- Tested against a real browser: tabs, popups, the limit, hover, drag, double and right clicks,
  shortcuts, scrolling inside a list, clicking a canvas by position (scaled), high stakes and
  secrets by position, uploads and their refusals (traversal, links, hidden and key files,
  Conch's own folder, keys elsewhere), a handoff ending by itself (and one that doesn't), your
  Chrome stood in for by a browser started with remote debugging, Browserbase through a pretend
  API, a DevTools address, and falling back.
