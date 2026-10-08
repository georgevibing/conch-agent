# 0105 — Rich cards in the chat

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0060](./0060-the-chat-knows-conch.md) §7 (tool views),
  [ADR 0072](./0072-every-model-gets-its-tools.md) (host tools for every model),
  [ADR 0088](./0088-everyday-tools-for-every-model.md) (web research, the public fetcher),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0103](./0103-the-chat-tells-what-the-assistant-is-doing.md) (stories and their words)

## Context

When the assistant found something, the chat showed it as text, or as a plain list of
sources. Asking for a kettle, a song, a video, tomorrow's weather, a recipe, coffee
nearby or who someone was got the same paragraph any chat window would give. The
answer is often a thing to look at, press or play. It belongs in the chat as that
thing.

The obstacle is safety. The page's CSP allows no remote image, frame or media
(`img-src 'self'`), so a reply steered by a prompt injection can't leak what the chat
read through an image address. Rich cards have to keep that true.

## Decision

### One way for every card

Each family is a **host tool**, so every provider gets it the same way (ADR 0072). It
returns the model's text and a typed **`ToolView`** that the chat draws. These kinds
are added, each defined in `packages/protocol/src/views/`:

| Kind                                   | Tool(s)                                                        | Source (no keys)                                           |
| -------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `products`                             | `product_details` (1–8 shop pages)                             | The pages' schema.org `Product` / Open Graph tags          |
| `audio`                                | `music_search`                                                 | Apple's iTunes Search API                                  |
| `videos`                               | `video_search`, `video_details`                                | YouTube results page (Bing fallback), YouTube/Vimeo oEmbed |
| `weather`                              | `weather`                                                      | Open-Meteo forecast, geocoding, air quality                |
| `recipe`                               | `recipe` (1–3 pages)                                           | The pages' schema.org `Recipe`                             |
| `places`                               | `places`                                                       | OpenStreetMap: Nominatim, Overpass, standard tiles         |
| `knowledge`, `links`, `books`, `shows` | `knowledge_card`, `link_preview`, `book_search`, `show_search` | Wikipedia + Wikidata, the pages, Open Library, TVmaze      |

The new views stand alone under their story (`STANDALONE`, `telling.ts`): the card is
the answer, not a detail folded inside a step. Every tool's description tells the
model that the card already shows the items, so the reply adds a judgement (which to
pick and why), never a relisting.

### Pictures are the chat's own

`research/pageData.ts` reads a page's JSON-LD and card tags without running it.
`research/pictures.ts` (`capturePicture`) fetches a picture through the same
SSRF-guarded public fetcher as `web_fetch` (no cookies, no private addresses, every
redirect checked), keeps it only if its bytes are a raster image the attachment store
can read (PNG, JPEG, WebP, GIF; never SVG), and claims it for the chat. Views carry the
`Attachment`; the web draws it from `/api/attachments/…`. `img-src` stays `'self'`.
Map tiles are pictures like any other: a 3×2 mosaic, positioned by Web Mercator maths
on the page.

### Sound streams through Conch, on press

`GET /api/listen` plays a preview or a podcast episode only if a `music_search` card
in **that chat's log** carries the address: a model can't name a new one. Song
previews come only from Apple's preview hosts; episodes from the podcast's own public
https host. It's the same guarded fetch, audio only, with Range for scrubbing, size
and time limits, no cookies, and it stops when the page stops listening. `media-src`
stays `'self'`.

### Two video players, and only after a press

`frame-src` allows `'self'`, `https://www.youtube-nocookie.com` and
`https://player.vimeo.com`, nothing else. Until the person presses play, the card is a
poster the gateway kept and nothing loads from either site. The player's address is
built by Conch from an id checked against the site's own shape (11 characters for
YouTube, digits for Vimeo), never a link a model or a page supplied, so nothing from
the chat can ride in it. The frame is sandboxed (`allow-scripts allow-same-origin` is
the minimum that plays; presentation and popups for casting and "Watch on YouTube")
and cross-origin, so it can't read the page. YouTube's player refuses to play with no
referrer at all (error 153), so that one frame sends `strict-origin-when-cross-origin`:
Conch's origin, never a path. The page stays `no-referrer`.

### Taint and permissions

Every new tool reads someone else's words and marks the chat as having read the web,
as `web_fetch` does (ADR 0028). After reading, a tool whose input could carry what was
read asks first: page addresses that look like they carry data (`product_details`,
`recipe`, `link_preview`), and catalogue or place searches longer than 120
characters, matching Auto's short-search rule (ADR 0100). Skills need the `web`
capability for all of them.

## What leaves this computer

Only what each lookup needs, from this computer, through the public fetcher:

- **Shop, recipe and link pages** the model chose, and their image hosts: one
  cookieless GET each.
- **Apple** (itunes.apple.com): the music query, kind and a country from this
  computer's locale (else US); covers from Apple's image servers; a preview or episode
  only when played.
- **YouTube / Vimeo**: the video query or links; thumbnails; the player only on press.
- **Open-Meteo**: a place name (and language) or coordinates, units, `timezone=auto`.
- **OpenStreetMap** (Nominatim, Overpass, tiles): the place and what's looked for, with
  a User-Agent naming Conch; Nominatim at most one request per 1.1 s, Overpass one at a
  time, answers cached for minutes and tiles for a day; attribution always shown.
- **Wikipedia / Wikidata, Open Library, TVmaze**: the name or query.

No new dependency was added.

## Consequences

- Cards play, scrub, compare and tick off in place, with the panel motion (glint) for
  anything that comes and goes, lustre, spring tokens, reduced motion respected, axe
  tests in light and dark.
- Pictures count toward a chat's attachments and go with it (retention, backups).
- Lookups that depend on a page's layout (YouTube's results page) can break when the
  site changes; Bing is the fallback.
- Open-Meteo's free API has no alerts; the card draws them only if a source gives them.
- Recipe timers, shortlists and checked ingredients live in the page for the session;
  the gateway keeps no state for them.
