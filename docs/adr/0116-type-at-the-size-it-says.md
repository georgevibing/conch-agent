# 0116 — Type at the size it says, and a reading size for the chat

- Status: accepted
- Date: 2026-10-08

## Context

People said the chat's words felt a little small, and that Conch looked better at
110% browser zoom. Measuring the computed sizes showed why. `base.css` set the body
size (`--nc-text-md`, `0.875rem`) on `[data-nacre-root]`, and `NacreProvider` puts
that attribute on `<html>`. So the root was 14px, and every `rem` in Conch was 14px
instead of 16px. Every token was an eighth smaller than written:

| Token                        | Written as | Shipped as |
| ---------------------------- | ---------: | ---------: |
| `--nc-text-xs` (meta lines)  |       12px |     10.5px |
| `--nc-text-sm` (tool rows)   |       13px |    11.38px |
| `--nc-text-md` (UI, replies) |       14px |    12.25px |
| `--nc-text-lg` (composer)    |       16px |       14px |
| `--nc-control-lg` (touch)    |       44px |     38.5px |
| `--nc-space-1` (grid)        |        4px |      3.5px |

A reply read at 12.25px with a line height of 1.7, while the composer took 14px.
What you typed was bigger than what you'd read. The 44px touch target that NACRE.md
promises was 38.5px, and the meta lines were under 11px. App pages (`pagekit.css`)
did the same thing on their own `<html>`.

Long reading on screens is most comfortable at about 16–18px, with a line height of
about 1.5–1.6 and lines of about 60–75 characters. Chat apps people compare Conch
with set replies at around 16–17px. Interface text (lists, rows, settings) is
usually denser, at 13–14px.

## Decision

1. **The root keeps the reader's size.** `<html>` stays at `100%`, so `1rem` is
   whatever the browser says: 16px, or larger if someone chose larger. The 14px UI
   text starts at `<body>`. A local `NacreProvider` scope (not `<html>`) still sets
   its own body size. App pages do the same. Every token now renders at the size
   it's written as. That's about 114% of what shipped, close to the 110% zoom
   people preferred, and it makes the touch target and the 4px grid real.
2. **A reading size, separate from the UI size.** Words people read through use
   new tokens, one step up the scale from UI text:
   - `--nc-text-read` 16px, with `--nc-leading-read` 1.6
   - `--nc-text-read-lg` 17px for long-form pages (the documentation)
   - `--nc-measure-read` 70ch
   - `--nc-text-code` 14px, for code set beside reading text

   The chat uses them through `--nc-chat-text` and `--nc-chat-leading`. A reply,
   your bubble and the composer are all one size, so what you type is the size it
   will be read at. `Prose` reads at `--nc-text-read` by default: replies,
   artifacts, plans and past chats. `Prose size="lg"` is the documentation's 17px.

3. **Everything else stays at UI sizes.** The sidebar, settings rows, cards, tool
   rows and stories keep `--nc-text-sm`/`md`, and meta lines keep `--nc-text-xs`.
   A reply reads 16 / 13 / 12 (words, steps, when), with a step of about 1.2
   between each level. The sidebar and settings stay dense: they get the 14px the
   system always described, not the reading size.
4. **Phones.** A phone already gets 16px reading text. That's also the size
   `base.css` forces on every field so iOS doesn't zoom in, so the composer
   matches the chat there with no special case. `Input` and `NumberField` lay
   out at 16px for the phone but draw at the well's own size
   (`--well-type` = well size ÷ 16px: 14/16 for `md`). A field on a phone looks
   the same as with a pointer.

## Consequences

- The whole interface is about 14% larger than it was, by design. Layouts given in
  `rem` grow with it: the sidebar (17rem), the page column (64rem) and the chat
  column (46rem). Media queries don't change, since they always used the
  browser's 16px. At 16px the chat column is about 65 characters wide, inside the
  reading measure.
- Containers that hard-coded the old ratio no longer need it. The phone-field
  fix's "one step up" (Field labels and Select stepping up on touch) is gone,
  because a field's 14px now matches the words around it.
- A future change to the reading size is one token. Raising `--nc-text-read` to
  17px on wide screens would move the reply, the bubble and the composer
  together.
