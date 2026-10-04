# The browser

Conch has a web browser of its own. Ask for something that needs the web — _"find
me a hotel in Lisbon for the 12th"_, _"check whether my parcel has shipped"_,
_"fill in this form for me"_ — and the assistant opens pages, reads them, clicks and
types, while you watch. There's nothing to install or set up.

## Watching it work

The first time it browses in a chat, the **browser panel** slides in beside the
conversation. You see the page as it is, live. A small pearl — the assistant's hand
— glides to whatever it's about to touch, the control lights up, and a caption says
what's happening ("Clicking “Search”").

In the chat, every step leaves a frame in a small filmstrip, so you can scroll back
and see what it saw. Hover a frame to see it bigger.

- **Show or hide the panel:** the globe button at the top of the chat, or
  <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd>.
- **Make it bigger:** drag the seam between the chat and the panel. The page takes
  the panel's shape, so a bigger panel means bigger text.
- **Turn off auto-opening:** Settings → Browser → _Show the browser when it starts
  browsing_. It still opens when it needs you.

## Taking the wheel

Click anywhere on the page (or press **Take over**). The assistant stops and waits.
Your mouse, scroll wheel and keyboard now go straight to the page — just use it. When
you're done, press **Hand back** and it carries on from wherever you left things.

Pressing <kbd>Shift</kbd> + <kbd>Esc</kbd> leaves the page if your keyboard is inside
it.

## "Your turn"

Some things only you should do: signing in, a captcha, a payment, anything
personal. The assistant never types passwords, codes or card numbers. When a site
needs one, it hands the browser to you instead. You'll see **Your turn** in the chat
and in the panel, with what to do. Type it yourself, then press **I'm done**.

The assistant never sees what you type there. Password and card fields are hidden in
everything it reads, including screenshots.

Sites you sign in to stay signed in, so you only do it once.

## Every model sees the page

The assistant reads a page as text, and looks at it as a picture when words aren't enough: a
chart, a map, a photo, a captcha. A model that can see gets the picture itself. A model that
can't gets a description instead, written by one of your models that can: another model from
the same provider first, then your other providers. There's nothing to set up.

- A chat with a model on this computer only asks models on this computer, so what's on your
  screen stays here.
- Each picture is described once, so looking at the same page again costs nothing more. What
  describing costs counts with the chat.
- If none of your models can see, the assistant is told so. It reads the page instead, or hands
  it to you.

## What it asks you, and why

Conch keeps the questions few, and makes each one count:

- **A new site.** The first time it wants to click or type somewhere, it asks:
  _"Let Conch use booking.com?"_ Choose **Allow in this chat**, or **Always for
  booking.com** so it won't ask about that site again. Reading pages never asks.
- **Anything significant.** Buying, paying, sending, posting, deleting, booking. It
  asks every time and shows you the exact button on the page. Nothing happens until
  you say yes.
- **Downloads.** It asks, and saves them in the Downloads folder of your working
  folder.

In **Plan only** mode it reads but never clicks or types. In **Full trust** mode it
skips the "new site" question, but never the "anything significant" one, and never
types your secrets.

## Staying safe

- It's a separate browser with its own profile. Your own browser, its cookies and
  its passwords are never touched.
- Web pages can contain hidden instructions meant to trick AI assistants. Conch tells
  the assistant that page content is information, never orders, and the questions
  above mean a page can't make it buy or send anything without you.
- The browser can't reach Conch itself, or other things on your computer and home
  network (like your router), unless you turn on **Open local apps** in Settings →
  Browser. That asks for your password first, and the security checkup mentions it.
- **Sign out of every site** (Settings → Browser) wipes the browser's cookies and
  sign-ins in one go.

## When something goes wrong

Mostly, you won't notice: Conch fixes the browser by itself. It uses the Chrome,
Edge or Brave you already have, or downloads Chromium the first time if there's none.
It restarts a browser that crashed and reopens your page. It clears a browser left
behind by an earlier session, and declines cookie banners. Settings → Browser lists
what it fixed, under _Fixed on its own_.

If it ever can't, it says what happened in one sentence, with one button: **Repair**
tries every fix in turn. On Linux, the browser sometimes needs system libraries that
only an administrator can install; Conch then shows the one command to run.

## For developers

- Code lives in `apps/server/src/browser/` (gateway), `apps/web/src/features/browser/`
  (app) and `packages/nacre/src/patterns/Browser/` (design system). The decision
  record is [ADR 0014](./adr/0014-browser.md).
- Testing your own app on `localhost`? Turn on **Open local apps**. Conch's own port
  stays blocked either way.
- `pnpm dev:mock` has a scripted assistant that browses: try _"Open example.com and
  click “Learn more”"_, or _"… and sign in"_ to see a handoff.
