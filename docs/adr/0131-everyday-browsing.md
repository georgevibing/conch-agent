# 0131 — Everyday browsing: the page's questions, long forms, long pages, bot checks, find, Stop

- Status: accepted
- Date: 2026-10-11
- Extends: [ADR 0014](./0014-browser.md) (the browser), [ADR 0080](./0080-the-browser-does-what-you-do.md)
  (what it does), [ADR 0096](./0096-bounded-browser-steps.md) (bounded steps)
- Keeps: the per-site question, high-stakes confirmation, the secrets rule, the guard after
  reading ([ADR 0028](./0028-safe-hands.md)), Auto's policy ([ADR 0117](./0117-auto-asks-about-what-matters.md))

## Context

We walked the everyday journeys: book something, compare prices across tabs, fill a long form,
read a long article, get past cookie banners and popups, a slow site, a site that checks for
bots, take over and hand back, watch from a phone. Five gaps mattered most.

- **The page's own dialogs were invisible.** Nothing listened for `alert`, `confirm`, `prompt`
  or "Leave site?", so Playwright cancelled every one. "Remove this item?" after a click came
  back Cancel, the page didn't change, and the agent heard only "nothing changed". The same
  happened to the person driving: their own `confirm` was cancelled under their hands. An
  unanswered dialog also freezes the page: a click, a snapshot or a screenshot waits as long
  as it shows.
- **Long forms took a step per field.** Each `browser_type` paid a pause, a settle and a page
  read. A twelve-field form was twelve steps.
- **Long pages had an unreachable end.** The snapshot covers the whole page, whatever is scrolled
  into view, and was cut at 16,000 characters with "use `find` or `browser_scroll`". Scrolling
  never reached the rest.
- **Bot checks read as the site.** Cloudflare's "Just a moment…" and its peers pass by
  themselves within seconds, but the agent read the interstitial as the page and gave up, or
  retried a site that refuses automated visits.
- **The person's side lacked two basics.** No find on page, and no Stop in the panel. On a phone
  the panel covers the chat, so Stop was out of reach while watching.

The bar is unchanged: few tools with plain schemas, every rule holds for every new way in, every
provider gets the same.

## Decision

### The page's own dialogs

`Tab` answers every dialog on every page it owns. Who answers depends on who drives.

- **The agent's step** (`Tab.answerer`, set for the step's duration):
  - A message (`alert`) is closed, and its words go into the agent's result.
  - "Leave site?" leaves: going was the agent's step.
  - A text box of the page's own (`prompt`) gets Cancel. Conch never types into one.
  - A question (`confirm`) answers the site, so it goes through `permit` like any act there.
    That means the site question, and high stakes when its words ask for a significant act
    anywhere in the sentence (`asksHighStakes`). A yes already given in this step covers the
    site's "Are you sure?" after it (`vouched`), so one decision is asked once. Read only mode
    answers Cancel. The question carries no thumbnail: a frozen page can't be pictured.
- **You, driving.** The dialog is in `BrowserTab.dialog`. The panel draws it over the page
  under the site's name (Nacre `PageDialog`), so its words can't pass for Conch's. You answer
  with `{ type: 'dialog' }`. Your input to the frozen page waits. Handing back, or the page
  closing, answers Cancel, and the agent hears so.
- **Nobody** (between steps): OK to a message, Cancel to a question, as the page's own default.
  The agent's next result says what was asked.

Every result says what the page asked and how it was answered (`Tab.dialogNotes`). An action
that waited behind a dialog (a click times out there) is not a failure once the dialog is
answered (`throughDialogs`). While a dialog waits, the tab's state uses the last title and
history it read, because asking a frozen page anything waits too.

### A long form in one step

`browser_form` fills text boxes, lists and checkboxes by ref in one step, and asks once.

- It never sends the form. The form's own button is the next click, judged like any click.
- Secret fields are skipped and named, and left to `browser_type`, which fills them from
  Passwords or hands them over. File boxes are left to `browser_upload`.
- A stale ref is skipped and named; the rest are filled.
- Its question is a `type` question. `carries` applies when any one value is long, as for
  `browser_type`, so Auto asks no more often than N calls to `browser_type` would. Ticking a box
  whose words are significant is high stakes.
- It is an act everywhere acts are listed: taint, skill `needs`, the MCP door's browser tools,
  `describeTool`.

### A long page in parts

`browser_read` takes `part`. The page is cut between lines into parts of at most 16,000
characters (`pageParts`), and each part says where the next one is and when it's the last.
`find` searches the whole page, as before.

### Bot checks

After `browser_open` (and a tab opened with an address), Conch looks for a check: the titles,
markers and words of Cloudflare, DDoS-Guard, PerimeterX and DataDome (`bot-check.ts`).

- A check that passes by itself within 15 seconds is waited out, and the agent hears that it
  passed.
- A check that stays tells the agent to call `browser_handoff`. The handoff already ends by
  itself once the captcha's token lands (ADR 0080).
- A refusal ("Access denied", or a 403 or 429 with almost nothing on the page) is said plainly,
  with "don't retry it over and over" and what to try instead.

Conch does not try to look less like a bot. A check is the site's decision. Getting past it is
the person's to do, through **Your turn**.

### Find on page, and Stop

- **Find on page.** <kbd>⌘F</kbd> or <kbd>Ctrl+F</kbd> in the panel, or **Find on the page** in
  ⌘K, opens Nacre `FindBar`. `{ type: 'find', text, direction }` runs the browser's own
  `window.find`: it selects and scrolls to the match. The gateway counts the matches and which
  one shows, and sends back `{ type: 'found' }`. It works only for you, not the agent, and not
  while the agent is mid-step. Finding scrolls the page, so the agent's next result says you
  used it.
- **Stop.** While the chat's turn runs, the panel's toolbar has Stop, which interrupts the turn,
  as the composer's Stop does.

## Consequences

- Protocol (additive, `PROTOCOL_VERSION` unchanged): `BrowserPageDialog`, `BrowserTab.dialog`,
  the live commands `dialog` and `find`, and the live event `found`. An older panel ignores
  `found` and `dialog`. An older gateway answers the new commands with "Invalid command".
- New tool `browser_form`. New `browser_read` argument `part`. The browser prompt says both in
  one line.
- New server module `browser/bot-check.ts`, and `risk.ts` `asksHighStakes`. No new dependency.
- Tested in a real browser (`everyday.test.ts`): an everyday question answered OK, a message
  closed, a significant question asked while the click times out behind it, a no that cancels, a
  yes that covers the site's "Are you sure?", a prompt cancelled, Read only, the person's own
  dialog in the panel (input held, answered, handed back), a form in one step with secret and
  file fields left alone and a stale ref, a long page read part by part, a check that passes, a
  check that stays, a refusal, and find with its count, wrapping and clearing. Nacre tests cover
  `PageDialog`, `FindBar`, ⌘F and Stop, with axe.
- Residual risk: a site's question is the site's words. Conch shows it under the site's name and
  judges its words, but a question that hides its meaning ("Continue?") is answered OK on a site
  the person allowed. That is no different from the click that raised it, which was judged
  already.

## Addendum, 2026-10-27

A site's "Book", "Subscribe", "Cancel membership" or "Accept invitation" now goes through Auto's
review like "Send" (ADR 0014, addendum of this date): the resolved label and the page are the
evidence, and the page must not change before the click. Paying keeps its card unless the
person named a limit the page's own total is inside.

Later the same day, from scoring Auto against scenarios:

- **Paying by another name.** A plan's "$9.99/month", "€20 deposit" or "then $12.99" on the
  page makes a reviewable "Subscribe" or "Book" paying (`showsCharge`), so it keeps its card;
  before, only a line labelled total did, and a paid plan's Subscribe could pass the review.
  Renew, upgrade, add funds, start or activate a plan are significant and paying.
- **A site named is a sign-in asked for.** The person's own words naming the site's brand as a
  word, or its address ("order the ink on Amazon"), lift the sign-in card (`namesSite`). Plain
  labels (account, login, mail, shop…) name nothing; the fill still goes only to the item's own
  site over https, and a lookalike is refused before any of this.
- **Someone to answer, not someone in the chat.** A task from the chat and the owner's own chat
  app (`ToolContext.attended`, ADR 0151) browse and settle cards as the chat does; a routine
  doesn't.
- **Your details, from Passwords** (round four). `browser_type` with `details: true` and an
  empty text fills a form from a saved identity, passport or licence (`identityFill`): which
  box is which by `autocomplete`, then the box's words (`identityRoleOf`); one card for the
  whole form that names the item and the site, never "Always"; a yes covers that form on that
  page for ten minutes. Only a secure page's own form (no frames from elsewhere), only that
  item's fields, only boxes that ask for them, and every box filled stays masked in what the
  model reads of the page. The person naming the item, or Full trust, needs no card; several
  items and none named, the card asks which.
- **A named site's sign-in through Google, Apple or Microsoft.** On the provider's page, in a
  sign-in the named site started in that tab (ADR 0133's chain), the person's words naming that
  site lift the card ("export my Notion workspace"); the fill still goes only to the provider's
  own page.
- **Brands that are everyday words, and banks.** "Chase down the invoice" isn't "sign in to
  Chase": for chase, target, discover, square, apple, box, notion and the common banks, naming
  the brand lifts a sign-in only beside a word for signing in, or the item's own title.
