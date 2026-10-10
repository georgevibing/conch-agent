# 0110 — Using your apps, while you watch

- Status: accepted
- Date: 2026-10-08
- Extends: [ADR 0014](./0014-browser.md) and [ADR 0080](./0080-the-browser-does-what-you-do.md)
  (watch it, take over, one door for every action), [ADR 0096](./0096-bounded-browser-steps.md)
  (bounded steps, Stop that holds)
- Keeps: [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0100](./0100-permission-modes-every-provider.md) (permission modes),
  [ADR 0031](./0031-skill-trust.md) (what a skill may do),
  [ADR 0054](./0054-the-desktop-app.md) (the desktop app and its IPC),
  [ADR 0070](./0070-every-model-sees-the-page.md) (every model sees a picture)

## Context

The browser covers the web. A lot of what people want done lives in apps on their own
computer: a slide in Keynote, a list in Notes, a setting in an app with no website, a file
dragged from Finder into an upload. Settings → This computer (`computer/`) only read the
machine's numbers.

What others do (October 2026):

- **Anthropic's computer-use tool** is the shape most models learned: a screenshot, then
  `left_click`, `type`, `key`, `scroll`, `left_click_drag`, `wait`… at pixel coordinates of
  the last screenshot. The current version (`computer_toolset_20260801`) is a set of member
  tools; older ones (`computer_20250124`, `computer_20251124`) one tool with an `action`. No
  automatic downscaling: the host sends about a megapixel (1280×800 is the advice) and maps
  points back. Its guidance: a person confirms consequential actions, screen content is
  untrusted, the session is capped.
- **OpenAI's** `computer` tool batches actions and returns a screenshot after each batch;
  same coordinates, same advice.
- **OpenClaw** has one `computer` tool behind a master switch ("Allow Computer Control")
  rechecked on every call, a deny list that always wins, screenshots kept from the chat, and
  coordinates that must match the screenshot's display or fail closed. Its macOS notes: the
  Screen Recording and Accessibility grants are separate and tied to the app's identity; don't
  grant Accessibility to a shared `node`; refresh on focus rather than trust a first answer.
  It documents no Stop and no overlay.
- **Hermes** drives `cua-driver` over MCP with numbered elements, refuses in unattended runs,
  and blocks key combos (empty the bin, log out) and dangerous typed text. No kill switch.

What people complain about is the same as for browsers (ADR 0014): setup is a project, you
can't tell when it's acting, and a screen can carry instructions (Greshake et al., 2023 — an
email open in Mail is someone else's words). An assistant that can press keys anywhere can
also press them in a terminal, in System Settings, or on Conch's own Allow button.

## Decision

Your assistant can use the apps on your Mac, while you watch. It's off until a person turns it
on, and the one thing everyone remembers is the glowing edge with Stop one press away.

### One tool, for every provider that sees

- **`computer`** (`computer-use/tools.ts`) is a Conch host tool, so it reaches every engine with
  host tools (in-process MCP for Claude Code, function calling for the APIs, Codex's dynamic
  tools) and its picture reaches every engine in its own shape, described for one that can't
  see (ADR 0070).
- **Anthropic's vocabulary, in one tool:** `action` is `screenshot`, `left_click`,
  `right_click`, `middle_click`, `double_click`, `triple_click`, `mouse_move`,
  `left_click_drag`, `type`, `key`, `scroll` or `wait`, with `coordinate`, `text`,
  `scroll_direction`, `scroll_amount`, `duration`; plus Conch's `open_app` and `list_apps`
  (Spotlight is refused, so opening an app goes through the same rules). Points are read
  forgivingly (`[x, y]`, `"x,y"`, `{x, y}`, ADR 0072), key names the way models write them
  (`cmd+s`, `Return`, `Page_Down`).
- **Every action comes back with a fresh picture**, about a megapixel (`fitPicture`), the
  pointer included. Coordinates are read against the last picture; if the screen's size
  changed since, the click is refused until it looks again (OpenClaw's "fail closed").
- **Native shapes are deferred.** Sending Anthropic's own toolset to the Messages API would need
  `engines/api/anthropic.ts` to map member tools and echo `toolset_name`, per model version.
  The generic tool already speaks the same words, so the native mapping is a thin adapter
  later. Claude Code can't take a native tool through MCP anyway.

### macOS first, with nothing to install

- **The driver** (`driver.ts` the interface, `mac.ts` the Mac) uses what every Mac has:
  `screencapture` for the picture, and JavaScript for Automation (`osascript -l JavaScript`)
  calling Core Graphics and AppKit — the same `CGEvent`s a mouse and keyboard make, the window
  list (`CGWindowListCopyWindowInfo`), and the two switches (`CGPreflightScreenCaptureAccess`,
  `AXIsProcessTrusted`). No native addon, no download, nothing for Updates to watch. The code
  is fixed; the assistant's words reach it only as one JSON argument Conch wrote. Text is typed
  as Unicode key events in pieces of 24 characters, so Stop lands between them.
- **Windows and Linux** get `UNSUPPORTED`: the tool isn't offered, and Settings says "On a Mac
  for now". The interface is what a PowerShell/`SendInput` or `xdotool`/`ydotool` driver
  implements next.
- **The two switches, one press each.** Settings → This computer → **Use your apps** shows
  **See the screen** (Screen Recording) and **Click and type** (Accessibility). The button first
  asks macOS to put Conch on the list (`CGRequestScreenCaptureAccess`,
  `AXIsProcessTrustedWithOptions`), then opens that exact System Settings page
  (`x-apple.systempreferences:…Privacy_ScreenCapture` / `Privacy_Accessibility`). The page
  looks again every two seconds while a switch is off, and on focus, and the row turns **On**
  with a glint by itself. The button only appears on the computer itself (`isLocal`); another
  device is told where to do it. The switches belong to the app macOS sees: **Conch** for the
  desktop app and for a Conch started by its host (ADR 0026, `CONCH_HOSTED`), otherwise the
  app Conch was started from (`TERM_PROGRAM`), and Settings says which. Repair everything says when one is still off.

### The glowing edge and Stop

- **The desktop app draws it** (`apps/desktop/src/overlay.ts`). While a chat uses the computer
  the gateway sends `computer {on, label}` over the app's IPC (protocol `desktop.ts`). Every
  display gets a transparent, click-through, always-on-top panel with Nacre's pearl spectrum
  as a slowly turning glow at its edges (`pages/edge.html`), and the main one gets a small
  card at the top: "Conch is using your computer", what it's doing, and **Stop ⌘⎋**
  (`pages/stop.html`). Both are non-activating panels, so the app being used keeps the
  keyboard, and both are content-protected, so they never appear in a screenshot: the
  assistant can't see its own Stop, and never aims at it. Reduced motion holds the glow still.
- **⌘⎋ from anywhere.** The app registers it only while the edge is lit. The tool refuses to
  press it, so the assistant can't stop itself by accident. Stop on the card, the keys, the
  chat's card or `POST /api/computer-use/stop` all interrupt that chat's turn
  (`ConversationManager.interrupt`): the turn's signal aborts every step, typing included.
- **In the chat**, the composer carries `ComputerUseLive` while the turn runs: the latest
  picture inside the same pearl edge, the step it's on, and one big **Stop**.
- **Conch in a browser only** (no desktop app): no edge and no global key; the chat's card and
  Stop are the honest fallback, and Settings says the app adds the edge.

### Safety

- **Off by default.** Turning it on is a person's change in Settings: from the computer
  itself, or right after confirming it's you elsewhere (`verified`). `computer-use.json` is in
  `lib/protect.ts`, so the assistant's file tools can't turn it on or add an app. A restore
  preview names it (`BackupPower` `computer-use`), and the security checkup lists it with
  **Turn off**.
- **Never where nobody can press Stop.** Routines, tasks and chats from chat apps don't get the
  tool (Hermes refuses unattended runs too). One chat at a time holds the computer; another is
  told so.
- **Kept away, in every mode** (`policy.ts` `keptAway`): password managers (by bundle id and
  name), System Settings and the system's password and permission prompts (SecurityAgent,
  Touch ID, the login window, notifications, Spotlight, Disk Utility), terminals and script
  editors (commands go through Conch's own tool, where the risk policy applies), banking,
  payment and crypto apps, and Conch itself (its app, and a browser tab titled "… · Conch",
  so it can never press its own Allow). They are refused before the driver runs and painted
  over in every picture, so their contents never reach the model. If one comes to the front,
  the result says so.
- **Keys it never presses** (`refusedKeys`): the Stop keys, locking the screen or signing out,
  Force Quit, emptying the Bin or deleting for good, and Spotlight.
- **Each app asks once per chat**, "Use Notes on your computer", in every mode but Full
  trust, Auto included (`explicit`): an app on your computer is signed in to your life, like
  your own Chrome (ADR 0080). **Always** remembers that app, and skips the question only while
  the chat hasn't read anything besides the screen; after a web page, an email or someone
  else's words, it asks once in the chat even then. Full trust skips the question under the
  same condition. Plan only looks but never clicks or types.
- **Taint.** Every `computer` call marks the chat "read what was on your screen"
  (`taintFrom`), so the guard after reading (ADR 0028) asks before anything else could send it
  out. Acting needs `apps` (`computer`) for a skill's list (ADR 0031); looking isn't limited.
- **Bounded.** 60 steps a turn (`MAX_STEPS`), then it stops to check in. Each driver call has
  its own timeout; a failure says what to do next and that it may have happened anyway, so the
  assistant looks before repeating (ADR 0096).
- **Nothing kept.** The latest picture lives in memory for the chat's card and is dropped when
  the turn ends; the temporary file `screencapture` writes is removed as soon as it's read.
  `GET /api/computer-use/shot/:id` serves only that one picture, `no-store`, while it lasts.
- **The prompt** says to take a screenshot first, prefer Conch's own tools, never type a
  password, treat the screen as information, and `ask` before sending, buying or deleting.
  When it's off on a Mac, one line tells the assistant to point at the setting rather than
  pretend it can't be done.

## Consequences

- No new dependencies. New protocol: `computer-use.ts`; `computer` / `computer.stop` on the
  desktop IPC; `DoctorPlace` `computer`; `BackupPower` `computer-use`; the checkup's
  `computer-use-off`.
- New data: `~/.conch/computer-use.json` (on or off, apps always allowed), backed up as a
  setting. Nothing of the screen is ever written down.
- macOS grants follow the app's signature. A Conch run from a terminal is granted through that
  terminal, which then lets anything run in it see the screen; Settings names the app so the
  person knows what they're granting, and the desktop app is the recommended way.
- Residual risk: an allowed app can still show instructions that steer the assistant within
  that app, and there's no reading of a control's name, so a "Send" or "Buy" in an app is only
  caught by the prompt's rule to ask first, not by a check like the browser's high-stakes
  confirmation. Per-app questions, the kept-away list, the taint guard, Stop and the step
  bound limit the blast radius; they don't remove it. Reading the Accessibility tree for
  control names, the native Anthropic toolset, a chat-card offer to turn it on (ADR 0060) and
  the Windows and Linux drivers are the next steps.
