# 0039 — Edit by hand and live data: closing what Show me left open

- Status: accepted
- Date: 2026-10-02
- Builds on: [ADR 0034](./0034-show-me.md) (Show me: the sealed page, the panel, pinned apps),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0014](./0014-browser.md) (where Conch's requests may land),
  [ADR 0020](./0020-backups.md) (what a restore names first)

## Context

ADR 0034 left two things out. You couldn't change what the assistant made
yourself: fixing one number in a chart meant asking for it in words and hoping.
And a page that needed live data (the weather, a price, a build status) couldn't
have any, because a sealed page has no network. It had to ask the assistant to
refresh it.

Both have traps.

- **Editing.** The assistant must know the newest version is yours. Otherwise
  its next change starts from the version it remembers and quietly undoes your
  edit. A page's live preview must not be a weaker seal than a saved page's.
- **Live data.** The page is code a model wrote, maybe after reading something
  hostile. If it can fetch, it can send. The classic leak is a request whose
  address spells out what the page knows: `https://evil.example/?d=<your data>`.
  A gateway that fetches for it is also a way inward (SSRF) to this computer,
  the local network, cloud metadata and Conch itself.

Sharing outside Conch is not wanted, and isn't done.

## Decision

### 1. Edit by hand

Every kind can be edited in the panel: page, document, chart, table, picture
and diagram. **Edit** opens the code beside a preview (or **Edit** / **Preview**,
one at a time, when the panel is narrow or on a phone).

- **The preview follows as you type**, 300 ms after you stop. Charts, tables,
  documents, pictures and diagrams are drawn by Conch from the text, as before.
  A chart or table that doesn't read keeps showing the last version that did.
- **A page's preview is sealed exactly like a saved one.** The text goes to
  `PUT /api/artifacts/:id/draft`, kept in memory only (20 drafts, never written
  to disk). The preview is `…/versions/draft/frame?rev=n`: the same route, the
  same `frameHeaders`, the same `navigates` rule and the same `SealedFrame`.
  Each change is a new address, so the stop-a-second-load rule still holds. It
  is never `srcdoc`, which would take this page's CSP rather than the seal's.
- **Mistakes in plain words.** `artifactProblem` (in `@conch/protocol`, so the
  editor and the gateway say the same thing) gives the line and what to fix:
  "The chart's JSON has a mistake on line 4, near column 3: look for a missing
  comma, quote or bracket.", "Value 2 of series 1 isn't a number.", "Line 3 has
  3 values, but the header has 2.", "A quote on line 2 is never closed." Save
  waits until it's fixed.
- **Undo and redo**, ⌘S saves and Esc cancels, from anywhere in the editor.
  They're caught on the window before anything else, so Esc cancels the edit
  instead of closing the phone's sheet, and ⌘S never saves twice. Tab moves
  on, as everywhere else: the editor never traps the keyboard.
- **Nothing is lost by accident.** An edit lives in a store, not in the panel.
  Closing the panel or going to another chat keeps it, and it's back when you
  return ("Your unsaved edit is back"). **Cancel** with changes asks first, and
  so does leaving the page.
- **Saving** is `POST /api/artifacts/:id/versions` with `base`, the version
  that was newest when you started. If a newer one came in meanwhile, it's
  refused (409) and the editor says so, offering **Save mine as the newest**.
  The version is marked `edited` ("Edited by you") with its own **Changes**
  view, and the chat gets an `artifact` event with `action: 'edited'`. Activity
  says "You edited …".
- **The assistant sees your edit.** The prompt context now has the chat's id
  (`ConversationDeps.context(engine, conversationId)`). While the newest
  version of something made in that chat is yours, the next turn carries it
  under "Edited by the user", with the content, and is told to build on it.
  `artifact_update` refuses to write over your version unless it passes
  `base` equal to it, and the refusal says what to do. A refresh passes `base`
  too. Providers without tools read the same section.
- **It works where artifacts are**: beside the chat, in the phone's sheet, on
  a pinned app's own page, and from ⌘K ("edit the budget").

**The editor is CodeMirror 6.**

- **Why it.** It is the only maintained browser editor that is accessible: a
  labelled `role="textbox"`, screen-reader friendly, keyboard-first. It is
  modular, so only six small languages are loaded: html (with its CSS and JS),
  markdown, json, xml (for svg), and csv and mermaid, which are short
  `StreamLanguage` parsers of our own. Its theme can be pure CSS variables, so
  it takes the same Nacre palette as `CodeBlock` and follows light, dark and
  the accent without rebuilding.
- **Not Monaco.** It weighs megabytes, needs web workers (the frame's CSP
  forbids them, and the app's would have to allow them), and handles a phone
  poorly.
- **Not a plain textarea.** It has no highlighting and no real undo.
- **It loads when it's needed.** It's a lazy chunk of its own (about 185 KB
  gzipped), loaded the first time an editor opens. If it can't load, a plain
  text box takes its place.

### 2. Live data

A page declares where it reads from, in the page itself:

```html
<script type="application/conch-data">
  {
    "weather": {
      "url": "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m",
      "params": { "lat": { "min": -90, "max": 90, "step": 0.01 }, "lon": { "min": -180, "max": 180, "step": 0.01 } },
      "every": 600
    }
  }
</script>
```

It asks for one with `await conch.data("weather", { lat: 52.52, lon: 13.4 })`,
or `conch.watch(…, callback)` to be called now and on every refresh. The bridge
in `frame.ts` posts the request to the panel. `SealedFrame` passes it on only
from its own frame (`event.source`), and only as a name and short values. The
panel asks the gateway (`POST …/versions/:n/live-data`), and the answer goes back
by `postMessage` to that same window, and only while it's still the page that
loaded. **The page still has no network of its own:** its CSP is unchanged.
Conch-provided feeds, like your calendar, are not offered. They would carry your
own data into a page a model wrote, which this design exists to avoid.

**Where a request may land** (`artifacts/live.ts`, `fetchLive`). This follows
the OWASP SSRF Prevention Cheat Sheet (allowlist, no unvalidated redirects, DNS
pinning) and ASVS 5.0's SSRF controls:

- **Only GET**, with no cookies, no credentials and no headers from the page.
  `agent: false`, so no connection is shared.
- **At most 1 MB**, by `content-length` and while reading, after decompressing
  (no zip bombs). **At most 10 seconds** for the whole chain. **Text only:**
  JSON, CSV, XML and `text/*`. Anything else is "a file, not data".
- **Every address is checked as it connects.** Requests use `node:http(s)`
  with a custom `lookup`, so the address checked is the address dialled, with
  no gap for DNS rebinding. An IP written in the address is checked before.
  Every redirect is checked again (at most 3), and is followed only to a host
  this page may read from.
  - Never: link-local, cloud metadata (169.254.169.254, `fd00:ec2::254`),
    `0.0.0.0/8`, multicast, and IPv4 hidden in IPv6 (NAT64, 6to4, Teredo).
  - Never your network: RFC 1918, CGNAT, ULA and benchmarking.
  - This computer (loopback) only when you said so for that page, and never
    Conch's own port.
  - https only, except plain http to this computer.

**Your OK, per page and host** (`artifacts/access.json`). The first request
to a host you haven't allowed returns `needs-approval`, and the panel asks
**Let "Weather now" read live data from api.open-meteo.com?**, showing every
address it reads there.

- **This computer takes a second, explicit yes** ("Let it read from this
  computer"). The security checkup then warns until you take it back, and so
  does Repair everything.
- **Only a person in the web app gives an OK.** The assistant has no tool for
  it. The route is behind sign-in, origin and Fetch-Metadata checks, so the
  frame's own opaque origin (`Origin: null`) can't reach it.
- **Taking an OK back is one press:** **Reads from → Stop** on the page, or
  **Settings → Security → Live data in pages → Take back**. Deleting a page
  takes its OKs with it.
- **Repair everything** tidies away OKs that no page uses any more.
- **Backups keep them** (`kept`, the chats group). A restore names them first
  (`page-data-sites`), so an old backup can't quietly bring back a site you
  took back.

**What a page could send, and why it can't send much.** A page that can choose
what to read can encode what it knows in the choice. The measures:

- **The host is fixed at approval.** It's written out in the address. The
  page can't fill it in (`{h}` in the host is refused), and a redirect can't
  carry the request elsewhere.
- **The addresses are fixed at approval.** An OK covers exactly the addresses
  you saw. A new version with a different address on the same host asks again
  ("now reads a different address"). This covers the assistant writing your
  data into a new address in a later version.
- **Query templates, not strings.** The page fills in only the `{name}`s it
  declared. Each is one of a list (at most 50 choices of 64 characters) or a
  number in a range, rounded to its step. A range may have at most 10,000
  steps. Free text, an extra parameter or a missing one is refused.
- **Length caps.** A template is at most 300 characters, the filled-in
  address at most 1,024, and a page declares at most 8 sources.
- **Few and seldom.** At most 30 different addresses an hour per page. The
  same address is answered from the last read for 15 seconds. Together these
  cap what even an allowed host could learn from the choices at a few hundred
  bits an hour, at worst.
- **Tainted chats.** If the chat that made the page has read something
  untrusted, the question says so in the guard's words (ADR 0028): "This chat
  read evil.example, which could be trying to steer me. Only allow a site you
  know." What a page reads goes only to the page, never to the assistant, so
  it doesn't taint the chat.

**Refresh, calm failure, pinned apps.** A page may say `every` (one minute at
the least). The panel reads again on that schedule while it's on screen, and
**Update now** reads at once.

- **The bar says** "Live · Updated 2 min ago · every 10 min".
- **A failure is calm:** "Couldn't update: api.example.com took too long to
  answer. Showing what it had from 12 min ago." The page keeps what it had,
  and a non-2xx answer counts as a failure, as in `fetch`.
- **Pinned apps** are the same panel, so they keep showing live data.
- **⌘K finds Live data in pages.**

## Consequences

- People can fix what the assistant made with their own hands, see it at once,
  and trust that the next change builds on theirs. Pages can show the world as
  it is now without a model in the loop, and without a network of their own.
- **Abuse cases are tested**:
  - `live.test.ts`: SSRF by name, by number, by rebinding and by redirect;
    unapproved hosts; changed addresses; oversized, endless, slow and binary
    answers; rate limits; a damaged list; Repair.
  - `artifacts.test.ts`: the data route refusing `Origin: null`, other sites
    and no sign-in; drafts served with the seal's exact CSP; conflicts; the
    assistant refused over your edit.
  - Nacre `Editing.test.tsx`: messages from the wrong window, malformed
    requests, a frame that loaded again.
  - `e2e/canvas.spec.ts`, from inside a real frame: no fetch to Conch or to
    the site, an undeclared source, free text, a redirect to metadata, and
    postMessages from the wrong window.
- **Residual risk.** An allowed host learns that the page was opened, when,
  and the declared choices it made. That is bounded by the caps above, and it
  is the host you said yes to. Timing is a channel too, a slow one. The answer
  to a page is posted with target `*`, because a sealed page's origin is
  opaque. It goes only to the window that asked, while it's still the page
  that loaded, and it carries only what the allowed site sent.
- **New dependencies** (Nacre): `@codemirror/state`, `view`, `commands`,
  `language`, `lang-html`, `lang-markdown`, `lang-json`, `lang-xml` and
  `@lezer/highlight`, loaded only when an editor opens.
- **Not done:** sharing outside Conch (not wanted); feeds from Conch's own
  data; a page reading anything but text; methods other than GET.
