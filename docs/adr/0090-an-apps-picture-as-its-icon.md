# 0090 — An app's picture as its icon

- Status: accepted
- Date: 2026-10-05
- Builds on: [ADR 0061](./0061-apps-you-make-share-and-add.md) (Conch apps, the
  package, the maker's tools, the quality bar), [ADR 0028](./0028-safe-hands.md)
  (the guard after reading), [ADR 0051](./0051-releases.md) (data across versions)
- Amends: ADR 0061 §1 — an app's folder may hold one picture.

## Context

A Conch app's icon is one of Nacre's glyphs on one of its colours. That keeps
every app looking like Conch and means nothing is ever fetched to draw one. But
an app made for one service (a calorie counter for one tracker, a timetable for
one railway) is recognised by that service's mark, and people ask for it: "use
the Yazio logo". A glyph can't say that.

A picture is someone else's bytes, though. An app comes from a model that may
have just read a hostile page, or from a stranger on GitHub, and its picture is
drawn inside Conch's own pages, where anything that runs would have the
person's session.

## Decision

### 1. One picture, inside the app, by name

An app may carry **one** picture at the top of its folder: `icon.png`,
`icon.jpg` or `icon.webp` (`APP_PICTURES` in `@conch/protocol`). When it has
one, it's drawn in the same rounded tile as the glyph, everywhere the app's icon
shows. Nothing else in an app may be a picture or any other binary file, and no
other name or place counts.

The manifest doesn't name it, and `icon: { glyph, color }` stays required. Both
are on purpose (ADR 0051 § Data across versions): `ConchAppManifest` is strict,
so a new field would make every earlier Conch refuse the manifest — and drop the
app's record, and every chat card that carries it. A file beside the manifest
changes nothing an earlier version reads; there, the app keeps its glyph (its
tools wait for Conch to be updated again, since that version doesn't know the
file), and nothing is lost.

### 2. Read from its bytes, never its name

`conchapps/picture.ts` reads a picture before anything else sees it, wherever
it came from (a draft, a folder, a `.conchapp`, GitHub):

- **The kind from the magic bytes**, and it must be the kind the name says
  (`icon.png` holding a JPEG is refused, with the right name in the message).
- **The whole structure walked**: every PNG chunk and its CRC, IHDR first and
  IEND last _and at the very end_; JPEG's markers to the scan and its end
  marker; WebP's RIFF size equal to the file and every chunk inside it. Nothing
  can hide after the picture (a PNG/HTML polyglot).
- **Still**: an animated PNG (`acTL`) or WebP is refused.
- **Limits** (`APP_LIMITS.picture`): at most 512 KB, 16 to 1024 pixels a side.
- **SVG is never a picture.** It is a document that can hold script and load
  things; sanitising it is a parser war Conch doesn't need to fight. Anything
  that starts like markup gets a sentence saying to find a PNG.

`readFiles` holds every package to this, so a picture that fails is a
**problem** (the app can't be offered or added), in words the model can act on.
The quality bar adds **warnings** for a picture that isn't square, one under 64
pixels, and an `icon.svg` that won't be drawn.

### 3. Served sealed, from Conch's own folder

`GET /api/conch-apps/:id/icon` (and `…/drafts/:draftId/icon`,
`…/packages/:packageId/:appId/icon`, `…/:id/update/icon` for what's being
offered) reads the file again on every request — a plain file, never a link or
a second name, under the cap — checks it as in §2, and serves it:

- with the `Content-Type` its bytes are, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: same-origin`, `Content-Disposition: inline`;
- behind the gateway's usual checks: signed in, same origin, Fetch Metadata;
- `private, max-age=86400`, with the app's hash in the address (`?v=`), so a
  new version is a new address.

Ids go through `Id`/`AppId`; the file names are fixed, joined with `pathIn`
(`safeJoin`), so a path can't be asked for. A file changed on disk after it was
added is simply not served. The web draws the address in an `<img>` inside the
tile (Nacre `AppIcon` `src`): the glyph shows until the picture has loaded and
stays if it fails, so nothing moves and nothing goes blank.

### 4. The maker's tool: `app_icon`

`app_write` writes text only; it refuses a picture's name. `app_icon` takes
exactly one of:

- **`url`**: an https address of the picture, fetched through the public web
  fetcher (`createFetcher`: live data's SSRF guard, no private addresses, no
  cookies, capped). "Use the Yazio logo" is the assistant finding the logo's
  address (a site's `apple-touch-icon.png`, or the picture in the browser) and
  passing it here;
- **`file`**: a picture in the chat's work folder or attachments, read with
  `fileBytes` (the same rules as every file tool: protected places, no links);
- **`base64`**; or **`remove: true`**.

The picture is kept under the name its bytes say, and any other picture goes.
The model is told what it is in words ("a 180 × 180 PNG"), never shown it.
Changing only the picture doesn't ask for every tool to be tried again
(`app_try` is remembered against the files without it), but the app still
passes `app_check` and the person still presses the card.

### 5. Whole Conch

- The picture lives in the app's folders under `conch-apps/` and
  `app-workshop/`, already covered by the backup manifest; no new file under
  `CONCH_HOME`.
- `.conchapp` files, GitHub publishing (the README shows it) and adding back
  carry it like any other file; the hash and the signature cover it.
- It isn't a power: it lets an app do nothing new, so it has no `appAbilities`
  words and no `BackupPower` line.
- ⌘K draws an app's picture where it draws its icon; nothing new to find.

## Threat model

| Who                               | What they try                                                         | What stops it                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A stranger's app                  | SVG or HTML named `icon.png`, run in Conch's origin                   | Magic bytes; markup refused; served as `image/*` with `nosniff`, a sandbox CSP; drawn only as `<img>`, which never runs script |
| A stranger's app                  | A polyglot: a real PNG with a page after it                           | The structure is walked to IEND, which must be the last byte                                                                   |
| A stranger's app                  | A huge or "decompression bomb" picture                                | 512 KB on the file, 1024 pixels a side read from the header before anything decodes it                                         |
| A stranger's app, or a later edit | A link or a second name for `icon.png` pointing at the person's files | Packages refuse links; the route reads only a plain file with one name, same inode as looked at                                |
| A prompt-injected model           | `app_icon` with an address that carries what the chat read            | It's the same way out as `web_fetch`: once the chat has read something from outside, such an address asks first (`sinkReason`) |
| A prompt-injected model           | `app_icon` with a path to the person's private file                   | `fileBytes`: only the work folder and the chat's attachments, never protected places; and only a real picture is kept          |
| Another site                      | Reading an app's picture, or fingerprinting which apps someone has    | Signed in, same origin, Fetch Metadata, `Cross-Origin-Resource-Policy: same-origin`                                            |

A picture can still show something misleading — someone else's logo on an app
that isn't theirs. That's the same as an app's name and words today: the card
says who it's from (signed or not, and where), and adding a stranger's app asks
that it's you. The guide tells the assistant to use a logo only for the service
the app is for.

## Consequences

- Apps for one service look like that service, and people find them at a
  glance.
- An app with a picture made on this version shows its glyph on an earlier
  Conch, and its tools there wait for an update; nothing is lost either way.
- A picture costs at most 512 KB of the app's 2 MB.
- Pages still can't show pictures from the app's folder; that's a different
  power (a sealed page loading its own files) and isn't part of this.

## Sources (reviewed 2026-10-05)

- OWASP File Upload Cheat Sheet: validate type by content, not extension or
  `Content-Type`; limit size; never serve uploads as active content.
- OWASP Cross-Site Scripting Prevention Cheat Sheet, and the long record of
  SVG-as-image XSS: SVG is a document, so it's refused rather than sanitised.
- WHATWG MIME Sniffing and Fetch (`X-Content-Type-Options: nosniff`), W3C CSP
  Level 3 (`sandbox`), and `Cross-Origin-Resource-Policy`: the response
  headers in §3.
- W3C PNG (Third Edition) for chunk layout, CRCs and `acTL`; ITU-T T.81 for
  JPEG markers; Google's WebP container specification for RIFF chunks.
- Greshake et al., 2023, "Not what you've signed up for" (indirect prompt
  injection): a fetch the model chooses is a way out, held like `web_fetch`.
