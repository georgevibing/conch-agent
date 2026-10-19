# 0141 — A browser per errand

- Status: accepted
- Date: 2026-10-19
- Builds on: [ADR 0014](./0014-browser.md), [ADR 0080](./0080-the-browser-does-what-you-do.md),
  [ADR 0130](./0130-passwords-in-the-browser.md), [ADR 0033](./0033-hand-it-off.md),
  [ADR 0129](./0129-tasks-start-when-there-is-room.md), [ADR 0025](./0025-passwords.md)

## Problem

Every chat and every background task had a tab in one browser context
(`BrowserRuntime.context()`). Tabs were per conversation, but cookies, local
storage and sign-ins were shared. Errands that ran side by side collided: two
price comparisons fanned out by `delegate` filled one shop's basket, one
signed the other out, and a site's "you're already looking at this in another
tab" logic saw them as one person.

## Decision

**Each errand gets its own browser session.** Every task, and every helper
(both run as a conversation with `origin.kind === 'task'`), browses in a
browser context of its own: cookies, storage and tabs that no other chat or
task sees. `BrowserService.tools(ctx)` marks the conversation when a task's
turn builds its tools; the agent can't choose this, and a task can't leave it.

Ordinary chats keep the main context, signed in where the person signed in
("use my logins" is what people expect). A person can give a chat its own
from the live view (the **A browser of its own for this chat** toggle, a live
command `session`), and take it back.

### Sign-ins are lent, never shared

An isolated context still needs the person's sign-ins for some errands.
Copying cookies is copying credentials (a session cookie is a bearer token:
OWASP Session Management Cheat Sheet), so the rule is least privilege and a
person's press:

- A new errand is seeded with a copy of the main context's storage state
  (`context.storageState()`) for **exactly the sites the person always
  allows** (Settings › Browser, `browser.json` `sites`), filtered by
  registrable domain (`errands.ts` `loginsFor`, the same `siteOf` a site
  permission uses: `.shop.example` belongs to `shop.example`, `alice.github.io`
  is not `github.io`). Never the whole jar. These are sites the errand could
  already act on with the person's sign-in in the shared context before this
  change, so lending them widens nothing.
- Another site is lent only when the person presses **Allow** on that site's
  question in the errand (`tools.ts` `permit` → `BrowserService.lendSignIn`):
  its cookies are added to the errand's context. The card says so
  (`BrowserPermission.lendsSignIn`). Auto and Full trust don't ask about an
  ordinary site, and therefore never lend by themselves; there the errand
  starts signed out and signs in with Passwords (ADR 0130), which works in any
  context because filling acts on the page.
- Never from **your own Chrome** (ADR 0080): Conch doesn't copy cookies out of
  the person's own browser into another process. Beside your Chrome, errands
  run in Conch's own browser, signed in nowhere; the prompt and the panel say
  so.
- Never passkeys or IndexedDB (`storageState()` without `credentials` or
  `indexedDB`), and never back: what an errand signs in to stays in the errand.
- **Revoking** a site (no longer always allowed) takes its cookies back from
  every errand it was lent to, open or set aside. **Sign out of every site**
  wipes every errand too.

Threat model: a prompt-injected errand (Greshake et al., 2023) gets the
sign-ins of the sites the person trusts and the ones they allowed in that
errand, and nothing else; before, it had all of them. Another errand's session
is out of its reach. What it holds never enters the agent's context, a log or
a URL.

### Lifecycle

- **Ends with the task.** Done, unverified or stopped (`task.changed` →
  `BrowserService.taskChanged`): the context closes and its session and saved
  tabs are forgotten. Deleting the chat does the same.
- **Waits for Resume.** Interrupted or failed: the context is set aside
  (`Errands.park`): its storage state is kept, and its tabs in
  `browser/tabs.json` as for any chat. Resume runs in the same conversation,
  so it opens the same session and tabs again. Shutdown, Repair and an update
  set every open errand aside the same way.
- **Sealed at rest.** Sessions live in `browser.errands.secrets.json`, one of
  the `SEALED_FILES` (AES-256-GCM under the device key, ADR 0025), protected
  from the agent's file tools (`protect.ts`), and `derived` in the backup
  manifest: copies of sign-ins aren't carried to another computer. At most 40
  are kept, for 14 days. The main profile (`browser/profile`) stays as before:
  Chromium's own store.
- **A cap.** `errandLimit()`: about one open context per 2 GB of memory, from
  2 to 6. When it's full, the open errand used least recently that nobody is
  driving or watching is set aside to make room (it comes back as it was).
  When all are busy, the step fails in words a model can act on ("wait a
  minute and try again"). Idle errands are set aside by the browser's idle
  sweep. The task scheduler (ADR 0129) keeps its room checks as they are: its
  gateway reserve already counts the browser, an errand's context is far
  smaller than a task, and setting one aside is cheap and lossless, so the
  browser enforces its own cap instead of the scheduler guessing which tasks
  will browse.
- **Heals.** What an errand holds is snapshotted a few seconds after each page
  loads. A context or the errands' browser that crashes is relaunched on next
  use (or at once when someone is watching), from the last snapshot, with its
  tabs, and Health says "Reopened a task's browser as it was".

### Where it runs

`BrowserRuntime.errandContext` makes the contexts and contains each one like
the main one (every request and WebSocket past the guard, ADR 0014
"Containment"):

- **Conch's own browser here**: a second, non-persistent Chromium (the same
  program as the main one), one context per errand, started when the first
  needs it.
- **A browser elsewhere** (a DevTools address, Browserbase, Steel): a new
  context of that browser when it gives one; otherwise (some clouds keep one
  context per session) Conch's own browser here, said once in Health. The main
  browser isn't let go of for idleness while an errand uses a context in it.
- **Your Chrome**: Conch's own browser here, for the reason above.

### The live view

The live view was already per conversation, and a task has its own: it shows
the right context's tabs because each conversation's tab now opens in its own
context. `BrowserTab.session` carries `reason` and the sites lent; the window
shows **Its own browser** (the sites in its tooltip).

## Consequences

- Parallel errands no longer collide, and a task's reach to the person's
  sign-ins is narrower than before.
- A task that needs a site the person hasn't always allowed signs in again
  (from Passwords, or a handoff), unless they allow it when asked. That's the
  price of not copying the whole jar.
- One more browser process while tasks browse, bounded by the cap.
- Tests: `browser/errands.test.ts` (parallel tasks apart, seeding only
  permitted sites, revoking, resume across a restart, the cap, crash heal, a
  chat's toggle).
