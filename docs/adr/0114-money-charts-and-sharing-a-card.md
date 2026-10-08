# 0114 — Money, charts, and sharing a card

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0105](./0105-rich-cards-in-the-chat.md) (rich cards, pictures the chat's own),
  [ADR 0018](./0018-channels.md) (chat apps), [ADR 0028](./0028-safe-hands.md) (the guard after reading)

## Context

ADR 0105 drew what the assistant found as cards. Two kinds of answer were still text:
**money** (a share price, how a company is doing, two companies side by side) and
**any chart** a person asks for ("a pie chart of my spending"). And a card stayed in the
chat: there was no way to keep it as a picture or send it to the person's phone.

## Decision

### Money

Three host tools, every provider: `quote` (1–8 tickers, indexes, coins, currency pairs),
`price_history` (one symbol, 1W to MAX) and `fundamentals` (1–4 companies). They draw two
view kinds, `quotes` and `fundamentals` (`packages/protocol/src/views/finance.ts`).

Sources, all keyless:

- **Stooq** CSV for prices and daily closes.
- **Yahoo Finance's chart endpoint** only as a fallback. It's undocumented and can break;
  the card shows what it has without it.
- **SEC EDGAR** XBRL (`companyconcept`, `company_tickers.json`) for filed figures, with a
  User-Agent naming Conch as EDGAR asks. US filers only: anyone else gets a sentence, not
  numbers.

Honesty is in the schema: every price is `delayed` and carries `asOf` and its source; a
figure nobody fetched is absent, never zero; market cap and P/E are marked as worked out;
the day's state is `closed` only when a session provably ended. There's no rating or
target field, every money card ends "not financial advice", and the tools' descriptions
forbid buy, sell or hold.

The range switch asks `GET /api/finance/history`, authenticated like every `/api` route,
through the same cache the tools use (quotes 60 s, history 15 min, tickers 24 h, filings
12 h). A company name is matched against EDGAR's ticker list on this computer, so only a
ticker's shape or a CIK leaves it.

### Charts

`chart_show` takes the data and the form from the model and the chat draws it live: the
`chart` view kind (`packages/protocol/src/views/chart.ts`). It draws column, bar, line,
area, pie, donut and scatter; it refuses others it can't draw well (radar, treemap,
candlestick, …), naming an alternative. At most 8 series × 400 points (3 for scatter).
Numbers and plain words only, so no field can carry a link or markup. It reads nothing
and fetches nothing, so it isn't a taint source.

The chat card and `file_make`'s chart file share one colour order and one set of helpers
(`chartScale.ts`), so a chart in the chat and the same chart as a file look like one family.
`file_make` stays the way to a chart _file_; `chart_show` is for one to look at.

### Sharing a card

A card can carry a **share bar** (`CardShare`): Save as image, Copy, and Send.

- **The picture is made in the browser**, never on the gateway: the card's SVG (or its DOM
  in a `foreignObject` with its styles and fonts inlined) drawn to a canvas at 2×. No
  headless browser, no new dependency. An SVG image loads no subresources, so nothing
  remote can be in the picture; `img-src 'self' data: blob:` is unchanged. A blank or
  failed picture is an error, never a silent empty file.
- **Send** goes through `POST /api/cards/send`, which takes the picture (an attachment of
  this chat, or one not yet in any chat) and a short caption, and hands it to the channels
  service to send to **the person's own chat** in an app they already connected. The
  request has **no recipient**: no address, handle or number, so nothing a chat read can
  redirect it. No tool calls this route, so a model can't send through it; a person's
  press opens the menu, and a second press confirms the app by name.
- `GET /api/cards/apps` lists only the apps that could really be reached, the one last
  written from first.
- Asked in words ("send that chart to Telegram"), the model is told the truth: the card's
  own **Send** does it with no browser needed; to send one itself, it makes a chart file
  (`file_make`, SVG always, PNG with a browser set up) and attaches that to `message_user`.

Mounted on the weather, chart, quote and fundamentals cards.

## What leaves this computer

- **stooq.com** and, as a fallback, **query1.finance.yahoo.com**: a ticker.
- **sec.gov / data.sec.gov**: the ticker list and a company's CIK.
- **The person's own chat app**: a card's picture and its caption, only when they press
  Send and confirm.

All of it through the SSRF-guarded public fetcher, without cookies. `chart_show` sends
nothing anywhere.

## Consequences

- Stooq's symbol forms for foreign listings are a mapping table: a wrong suffix shows as
  "not found", never a wrong price. A non-US listing's currency is inferred from Stooq's
  country suffix.
- `fundamentals` can make about 20 EDGAR requests for four companies (cached, four at a time).
- The picture is checked by eye in Chromium; Firefox can't copy an image to the clipboard,
  so Copy falls back to the card's text there.
