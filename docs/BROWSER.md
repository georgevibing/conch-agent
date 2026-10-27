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
- **Stop it:** the square button in the panel's toolbar, while the assistant works. On a phone
  the panel covers the chat, so Stop is there too.
- **Find on the page:** <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>F</kbd> in the panel, or
  **Find on the page** in ⌘K. <kbd>Enter</kbd> goes to the next one.

## Tabs

Each chat's tabs sit above the address bar, as in any browser, each with its site's icon. Click
one to look at it, close one with its × or the middle mouse button, or open a new one with **+**
(or double-click the empty part of the row); the address is ready to type. Right-click a tab to
reload it, close the others, or reopen the one you closed last.

A link that opens a new tab, or a "Sign in with Google" window, becomes a tab of its own, and
the assistant knows it did. When a sign-in window closes, the view goes back to the tab that
opened it. A chat keeps up to eight tabs.

The browser's keys work while the panel has focus: <kbd>Ctrl</kbd> + <kbd>L</kbd> for the
address, <kbd>Ctrl</kbd> + <kbd>T</kbd> for a new tab, <kbd>Ctrl</kbd> + <kbd>W</kbd> to close
one, <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> to reopen it, <kbd>Ctrl</kbd> +
<kbd>Tab</kbd> for the next tab, <kbd>Ctrl</kbd> + <kbd>1</kbd>–<kbd>9</kbd> for one by
place, and <kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd> for back and forward (⌘ instead of
Ctrl on a Mac). In a web browser, a few of these belong to the browser you opened Conch in;
the desktop app has them all.

**Your tabs come back.** Close the panel, reload Conch, or come back after the browser went to
sleep or Conch restarted: each chat's tabs open again where you left them, the same one in
view.

## What it can do

Whatever you'd do with a mouse and keyboard: click, double-click, right-click, point at a menu
to open it, drag something onto something else, press shortcuts like <kbd>Ctrl</kbd> +
<kbd>Shift</kbd> + <kbd>K</kbd>, and scroll inside a list or a panel. On a page with nothing to
point at by name — a map, a drawing, a game — an assistant that can see screenshots clicks where
it sees things. It asks exactly the same questions either way.

- **Long forms in one go.** It fills every field it can in one step and asks once. It never sends
  the form: pressing the form's button is a step of its own. Passwords and files are left for
  their own steps.
- **Long pages.** It reads a long page part by part, to the end.
- **The page's own questions.** When a site asks "Are you sure?", the assistant hears what it
  asked and answers it. If the question is about paying, sending or deleting, you're asked
  first, unless you just said yes to that very thing.
- **Sites that check for bots.** A "Just a moment…" check that passes by itself is waited out.
  One that wants a person becomes **Your turn**.

## Uploading files

It can put a file into a page's **Upload** or **Choose file** box: a file you attached in the
chat, something it made for you in the chat, or a file in your working folder. It asks you every
time, and says which file goes to which site: _"Upload “cv.pdf” (attached in this chat) to
jobs.example?"_. Hidden files, key files and Conch's own files never go, and nothing from outside
your working folder.

## Taking the wheel

Click anywhere on the page (or press **Take over**). The assistant stops and waits.
Your mouse, scroll wheel and keyboard now go straight to the page — just use it. When
you're done, press **Hand back** and it carries on from wherever you left things.

Pressing <kbd>Shift</kbd> + <kbd>Esc</kbd> leaves the page if your keyboard is inside
it.

When the page asks you something while you drive ("Remove this item?"), the question shows over
the page, under the site's name. Answer it there. If you hand back first, the page gets
**Cancel**.

## Signing in

The assistant never sees a password, code or card number. When a site asks for one and it's
saved in **Passwords** (or a password manager you connected), Conch fills it:

- One question covers the whole sign-in: _Sign in as ada@example.com on example.com?_ The
  username page, the password page and the code page don't ask again.
- With several accounts for the site, the card shows each one. Tap the one to use.
- On a sign-up or change-password form, Conch makes a strong password, saves it in Passwords and
  types it in, after asking.
- A page that only looks like one of your sites (`paypa1.com`) gets nothing, and the assistant
  tells you.
- Conch fills only over https, and never into a sign-in box from another site inside a page.

Some accounts have no password: they sign in with Google (or Apple, Microsoft…), your
company's sign-in, a passkey, or a link sent by email. Conch knows from Passwords:

- **Continue with Google.** Conch presses the site's own button, and on Google's page fills your
  Google login for that account. One question covers it all: _Sign in to “Product Hunt” with
  Google as ada@gmail.com?_ If Google already shows the account, it's just clicked.
- Saved as "another account" without saying which? Conch asks you which one, never guesses.
- A passkey kept in 1Password or on your device can't be used by Conch's browser. Conch says so
  and hands you the page, and can make a passkey of its own once you're in.
- A link or a code by email: Conch fills your email, then reads the code from your mail app if
  it's connected, or asks you.

Driving yourself? Click a sign-in box and a bar offers what's saved for that site, or **Use a
strong password** on a sign-up form. On a page whose account signs in with Google, the bar says
so and offers **Continue with Google**.

## "Your turn"

Some things only you should do: a sign-in that isn't saved, a captcha, a payment, anything
personal. The assistant hands the browser to you. You'll see **Your turn** in the chat
and in the panel, with what to do, and your phone gets a notification with **Take over** if
you're away. Type it yourself. When it's a sign-in or a captcha, the assistant notices once
you're through and carries on by itself; otherwise press **I'm done**.

The assistant never sees what you type there. Password and card fields are hidden in
everything it reads, including screenshots.

Sites you sign in to stay signed in, so you only do it once.

## Tasks have a browser of their own

Each [task](../apps/docs/content/features/tasks.md), and each part of a job split into several, browses in a
browser of its own. Its cookies, sign-ins and tabs are nobody else's, so two tasks comparing
prices never fill the same basket or sign each other out. The panel says **Its own browser**.

- It starts signed in only to the sites you chose **Always for** a site. Point at
  **Its own browser** to see which.
- When it asks to use another site, **Allow** also lends it your sign-in there, until the task
  ends. In Auto it doesn't ask, so it signs in from Passwords instead.
- Nothing it signs in to comes back to your main browser.
- When the task is done, its browser closes and is forgotten. When it's interrupted, it's kept
  locked on this computer, so **Resume** carries on in the same browser, signed in, on the
  same pages.
- A few run at once, more on a computer with more memory. One nobody is using steps aside for
  another and comes back as it was.
- With **Your Chrome**, tasks use Conch's own browser instead. Conch never copies your Chrome's
  sign-ins.

A chat uses your main browser. To give one a browser of its own, press the layers button
in its panel. Press it again to go back.

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

Outside Full trust, Conch asks about the steps that need approval:

- **A new site.** The first time it wants to click or type somewhere, it asks:
  _"Let Conch use booking.com?"_ Choose **Allow in this chat**, or **Always for
  booking.com** so it won't ask about that site again. Reading pages never asks.
- **Anything significant.** Buying, paying, sending, posting, deleting, booking. It
  asks every time and shows you the exact button on the page. Nothing happens until
  you say yes.
- **Downloads.** It asks, and saves them in the Downloads folder of your working
  folder.

In **Auto**, what you already said counts as your answer:

- **A site you named.** "Log in to my Hetzner account", or just "order the same ink on
  Amazon", signs in from Passwords with no card, on that item's own site only. A site that
  only looks like it is refused.
- **Sending, booking, subscribing, cancelling, answering an invite.** Auto checks the
  button and the page against what you asked for, and goes ahead when they match. Paying
  isn't one of these: a price a month, a deposit or a bill after a trial on the page makes
  "Subscribe" or "Book" paying, and renewing, upgrading or adding funds is paying too.
- **A limit you named.** "Buy it if it's under $50" places the order with no card when the
  total on the page is inside that limit, in the same currency. Over it, or with no limit
  named, it asks.
- **One card per payment.** A yes to the order covers filling your saved card on that
  checkout, and the other way round.

The same holds in a task from that chat and when you write from your own chat app. None of
this applies after someone else has written in the chat, in a routine, or in your own Chrome.

In **Read only** mode it reads but never clicks, types or fills. In **Full trust** mode it
skips action approvals, including significant actions, uploads and downloads, and signs
in from Passwords without asking.

## Where it runs

Settings → Browser → Advanced → **Where it runs**:

- **Its own browser** (the default): separate from yours, on this computer.
- **Your Chrome**, where you're already signed in. In Chrome, open
  `chrome://inspect/#remote-debugging` and turn on **Allow remote debugging** (Chrome 144 or
  newer), then press **Use my Chrome**; Chrome asks you to allow it. The assistant only uses tabs
  it opens there, each marked _Conch is using this tab_, never reads your other tabs, and asks
  before acting on each site unless you chose **Full trust**. The panel says **In your
  Chrome**. Use it only when you need your sign-ins: a page it reads there could try to trick
  it, with your real accounts.
- **Browserbase** or **Steel**: a browser in the cloud, with your API key. Pages it opens are
  seen by that company.
- **Another browser**, at its DevTools address.

Anything but its own browser asks for your password (or passkey) first, and keys are kept sealed
on this computer. If the one you chose can't be reached, the assistant uses its own browser
meanwhile and Settings says why.

## Staying safe

- By default it's a separate browser with its own profile. Your own browser, its
  cookies and its passwords are never touched, unless you choose **Your Chrome**.
- Web pages can contain hidden instructions meant to trick AI assistants. Conch tells
  the assistant that page content is information, never orders, and the questions
  above mean a page can't make it buy or send anything without you.
- The browser can't reach Conch itself, or other things on your computer and home
  network (like your router), unless you turn on **Open local apps** in Settings →
  Browser → Advanced. That asks for your password first, and the security checkup
  mentions it.
- **Sign out of every site** (Settings → Browser → Advanced) wipes the browser's cookies and
  sign-ins in one go, tasks' own browsers too.

## When something goes wrong

The chat says when the browser is waiting for your approval, for you to hand it back,
or for a previous step. Time spent signing in or answering an approval does not
count toward a page's execution limit.

If a browser step stays stuck for two minutes of active work, Conch stops the step
and closes that chat's tabs. An action may already have reached the site, so check
what happened before repeating it. Conch does not repeat a timed-out action on its
own. If the tabs cannot be closed, the browser stays blocked until **Repair**
reconnects it: on Settings → Browser, or **Repair everything** in Settings → Health.
Other chats' tabs stay open.

The same caution applies after **Stop**, or if the browser closes after an action
begins: check the page before repeating it. Conch keeps that result uncertain and
does not automatically replay the action. If the browser closes before the action
begins, Conch can reopen it and try safely.

Mostly, you won't notice: Conch fixes the browser by itself. It uses the Chrome,
Edge or Brave you already have, or downloads Chromium the first time if there's none.
It restarts a browser that crashed and reopens your page. It clears a browser left
behind by an earlier session, and declines cookie banners. What it fixed is listed
with every other repair in Settings → Health, under _Fixed on its own_.

If it ever can't, Settings → Browser says what happened in one sentence, with one
button: **Repair** tries every fix in turn. While the browser is healthy, that page
says nothing about repairing: **Repair everything** in Settings → Health runs the
same fixes with every other part's. On Linux, the browser sometimes needs system libraries that
only an administrator can install; Conch then shows the one command to run.

## For developers

- Code lives in `apps/server/src/browser/` (gateway), `apps/web/src/features/browser/`
  (app) and `packages/nacre/src/patterns/Browser/` (design system). The decision
  records are [ADR 0014](./adr/0014-browser.md),
  [ADR 0080](./adr/0080-the-browser-does-what-you-do.md) (tabs, uploads, clicking by
  position, your own Chrome and the cloud),
  [ADR 0130](./adr/0130-passwords-in-the-browser.md) (signing in from Passwords),
  [ADR 0133](./adr/0133-how-an-account-signs-in.md) (Sign in with Google, passkeys, SSO, links) and
  [ADR 0131](./adr/0131-everyday-browsing.md) (the page's own questions, forms in one step,
  long pages, bot checks, find on page, Stop in the panel).
- Testing your own app on `localhost`? Turn on **Open local apps** (under Advanced). Conch's own port
  stays blocked either way.
- `pnpm dev:mock` has a scripted assistant that browses: try _"Open example.com and
  click “Learn more”"_, or _"… and sign in"_ to see a handoff. Attach a file and say
  _"Open … and upload it to “CV”"_ for an upload, or _"… click “Our blog”, then go back to
  the first tab"_ for tabs.
