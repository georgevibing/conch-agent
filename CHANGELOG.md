# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.11](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.10...v0.1.0-alpha.11) (2026-10-13)


### Features

* every assistant knows a Sign in with Google login has no password; a phone journey proves the page ([8d732a6](https://github.com/georgevibing/conch-agent/commit/8d732a6e8d67e8d3685c27a14e826a19fb5894e9))
* **nacre:** Passwords says how an account signs in, and an item's page says it in fewer words ([e0e57f8](https://github.com/georgevibing/conch-agent/commit/e0e57f872efe9dd65f62c0ee2672f9021534a6a8))
* **nacre:** the live view's bar says "Product Hunt signs in with Google" ([72ee306](https://github.com/georgevibing/conch-agent/commit/72ee3060f5f037dd4259f95294d3112c00e4d0fc))
* **protocol:** an item can say how it signs in (Sign in with Google, a passkey, SSO, a link) ([4b8ad3d](https://github.com/georgevibing/conch-agent/commit/4b8ad3d164e87607456a0b69a40dee177801058a))
* **protocol:** the browser's offers and cards say how an account signs in ([f73fbe6](https://github.com/georgevibing/conch-agent/commit/f73fbe6e5e8e52080801b114e89db1b54b4e99bb))
* **server:** Passwords knows how an account signs in (Sign in with Google, a passkey, SSO, a link) ([1f42c1e](https://github.com/georgevibing/conch-agent/commit/1f42c1e3a03db088e5207340de767bbd464c491b))
* **server:** passwords_find says how a login signs in ([587a05e](https://github.com/georgevibing/conch-agent/commit/587a05edb6d13072c6ceaf498bd36efc728fa067))
* **server:** the browser signs in with Google, a passkey, SSO or a link (ADR 0133) ([43e53c8](https://github.com/georgevibing/conch-agent/commit/43e53c834db421514447cd0d263688a2ef720f0a))
* **web:** press "Continue with Google" from the live view's bar ([1b23d26](https://github.com/georgevibing/conch-agent/commit/1b23d2656b216db7f65aab912bf8b60b4827e469))


### Bug Fixes

* **server:** a 1Password "Sign in with" item shows no empty password, and says how it signs in ([6d0d611](https://github.com/georgevibing/conch-agent/commit/6d0d611fa92191e9c9b19e16b554caef5114e826))
* **web:** a Passwords item that signs in with Google says so, with no empty password ([ad732b8](https://github.com/georgevibing/conch-agent/commit/ad732b85829dd896111b75183c506347acc44ef7))

## [0.1.0-alpha.10](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.9...v0.1.0-alpha.10) (2026-10-12)

### New

- Settings → Health tells you when Conch stopped answering this week and started again on its own, and where it was stuck

### Fixed

- Conch notices when it keeps stalling for a few seconds at a time, not only when it stops answering for long
- When Conch is frozen, it keeps a note of where it was stuck, even when it froze while starting
- If Conch starts answering again just before it would be restarted, it carries on instead
- Ctrl+C on a frozen Conch stops it in seconds, and pressing it again stops it at once
- A frozen Conch no longer keeps running in the background after whatever started it has gone
- When Conch has to stop a command to stay responsive, it stops the one working hardest right now
- When another program keeps the computer busy, Conch waits longer before restarting itself, and never mistakes that for its own trouble
- Messages after a restart say what happened, and how long Conch will wait before starting again
- After one slow moment, waiting work says Conch is catching up, not that it is recovering from repeated trouble
- A command can no longer open a door into Conch that other people on this computer could use
- A routine waiting for room on your plan runs once there is room, even when it was held a moment before
- Setting your computer's clock back no longer holds every command for as long

## [0.1.0-alpha.9](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.8...v0.1.0-alpha.9) (2026-10-12)

### New

- Conch notices a slow memory leak and starts itself again once, while nothing is working, before it can freeze
- Conch holds new work as soon as it starts falling behind, before it stops answering
- A frozen Conch leaves a small note of where it was stuck, so a repeat can be fixed. It never holds your chats, commands or keys

### Fixed

- Waking your computer from sleep no longer stops a command that was running
- A frozen Conch starts again in seconds, and a slow start, like restoring a big backup, is no longer taken for a freeze
- On macOS and Windows, a chat's commands end when Conch stops unexpectedly, instead of running on unseen
- On Windows, stopping Conch with Ctrl+C saves your conversations first
- More ways to delete, download and run code, or read keys, now ask first, such as a wrapped rm -rf, find -delete and gh api
- Your keys stay yours: a password is never filled into a page that moved, a redirect to another site drops the key, and more secrets are hidden
- Skills are checked against the whole key you trust, deep files included, and a skill is never added part-way
- Failed sign-ins from elsewhere no longer keep this computer out
- Routines: Run now pressed twice runs once, a paused routine stays paused, and a one-off runs on time
- Charts draw gaps, negative stacked bars and more than eight colours right, and fit their space after switching from Table
- Chat apps get long answers, links and emoji whole, and Slack catch-up pages back through busy channels and long threads
- Files stay attached while you move between chats, and a message too long to send stays in the box and says so

## [0.1.0-alpha.8](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.7...v0.1.0-alpha.8) (2026-10-11)

### Fixed

- On Linux, a chat no longer says it deleted files like .bashrc or .claude/agents that it never touched, after a command ran in the sandbox

## [0.1.0-alpha.7](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.6...v0.1.0-alpha.7) (2026-10-11)

### Fixed

- The first keys typed in a new terminal reach the shell
- The page hears the internet go while its first read is on its way
- Run a calendar routine once, and hold runs to sending what they're told

## [0.1.0-alpha.6](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.5...v0.1.0-alpha.6) (2026-10-11)

### Fixed

- The page hears what changed while it wasn't connected

## [0.1.0-alpha.5](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.4...v0.1.0-alpha.5) (2026-10-11)

### Fixed

- Every Feishu or Lark code to scan can be followed, not 31 in 32
- A chat deleted as it starts doesn't answer out of sight

## [0.1.0-alpha.4](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.3...v0.1.0-alpha.4) (2026-10-11)

### New

- The browser signs in from Passwords with one question, offers the accounts to pick on a sign-in card, and makes a strong password when you sign up
- Passwords finds the right login for a page and warns you about look-alike sites
- The browser answers a page's own questions, fills a form in one step and reads long pages to the end; find on page and Stop are in its panel
- Ask the assistant to switch model in your words, like "use Opus 5.5", "something cheaper" or "go back", on every provider
- The chat shows when it switched model, with Switch back
- Activity moves into Settings, under Safe and sound

### Fixed

- Routines the assistant makes run on your clock, not the gateway's
- A Mac lists Conch by name in Privacy & Security, not "node"
- The per-core bars on This computer fill their column on desktop
- An app card's name sits level with its logo
- Delete reads red in the chat selection bar
- The Passwords start screen shows its keys

## [0.1.0-alpha.3](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.2...v0.1.0-alpha.3) (2026-10-10)

### Fixed

- The docs show their version, without a line about development docs
- Keys typed while a new terminal starts aren't lost

## [0.1.0-alpha.2](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.1...v0.1.0-alpha.2) (2026-10-10)

### Heads up

- Downloaded the 0.1.0-alpha.1 app? Choose Alpha once in Settings → Health → Updates to get this and later alphas

### New

- Until you choose a channel, Conch follows the newest release there is: stable once there's one, before that beta, then alpha
- A copy of Conch that follows main can now choose the alpha channel, and a channel with no release yet says so
- The installers install the newest alpha or beta until there's a stable release
- The website shows the newest release, with its docs and downloads, while there's no stable one yet

### Fixed

- A deleted chat stays deleted, even when a task's update was on its way to it

## [0.1.0-alpha.1](https://github.com/georgevibing/conch-agent/commits/v0.1.0-alpha.1) (2026-10-10)

### Heads up

- This is Conch's first alpha: expect rough edges, and tell us what breaks on GitHub Issues
- The macOS and Windows apps aren't code-signed yet, so your computer asks once before Conch first opens
- On a Mac, each update comes as a download to install, until the app is signed

### New

- Every model you pay for in one calm app: Claude Code, Codex, GitHub Copilot, Gemini CLI, Grok, local models and API keys
- A limit never stops a chat: when a plan runs out, the next plan or key with room carries on
- It says what it's doing in plain words, with Why? on any step and Undo for what it changed
- Agents with their own names and faces, that work together, work in the background and remember what matters
- Routines and standing orders: every weekday at 7:30, when an email arrives, or "always tell me if a flight changes"
- A browser you can watch and take over, and a real terminal a keystroke away
- Gmail, Google Calendar, Drive, Slack, GitHub and more for every model, and new apps Conch builds when you ask
- On the web, macOS, Windows, Linux, your phone, and chat apps like Telegram, Discord, Slack, WhatsApp, Signal and iMessage
- Four permission modes on every provider, Activity for everything it did, and Undo
- Repair everything checks every part of Conch and fixes what it can
- No account and no telemetry: your chats, memories and settings stay on your computer
