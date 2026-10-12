# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.10](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.9...v0.1.0-alpha.10) (2026-10-12)


### Features

* **server:** Health says when Conch froze and started again ([ac1ea66](https://github.com/georgevibing/conch-agent/commit/ac1ea6616329eebee0fc8e3c18f78ed370e19513))


### Bug Fixes

* **server:** a command that sends SIGUSR1 can't open a debugger anyone here could use ([d1a0403](https://github.com/georgevibing/conch-agent/commit/d1a0403c9498fc85d821764e57319f80cc9a6a05))
* **server:** a freeze's evidence names the source line, not a line of tsx's output ([e4e41d6](https://github.com/georgevibing/conch-agent/commit/e4e41d67019604914cf7c46ceae5cd5a477f0a05))
* **server:** a frozen gateway that answers before its kill isn't killed ([e5219b5](https://github.com/georgevibing/conch-agent/commit/e5219b5388d6a5e237324fc730d1073a3452c141))
* **server:** a frozen gateway's evidence is captured before it is stopped ([1240b36](https://github.com/georgevibing/conch-agent/commit/1240b3644b7218bd01832e84f050152029dc2ee9))
* **server:** a gateway frozen when its supervisor dies doesn't hold the port forever ([184b01c](https://github.com/georgevibing/conch-agent/commit/184b01c4ff7fef520bce9a33d100d54f992306e0))
* **server:** a gateway that keeps stalling briefly is seen, not just one that stalls long ([5497ed3](https://github.com/georgevibing/conch-agent/commit/5497ed3994542f43c6f59178a4b61fd66053fe32))
* **server:** a gateway that's busy on its own isn't given longer because the computer is busy ([3b00d7a](https://github.com/georgevibing/conch-agent/commit/3b00d7a8e30862e1045d0f13658d96ec6f1cbff5))
* **server:** a hold after one slow moment says Conch is catching up ([69e9042](https://github.com/georgevibing/conch-agent/commit/69e9042d34c6fd87a20ec95426dca567346e32fc))
* **server:** a routine waiting for room on your plan still goes when it was just being held ([ab73f07](https://github.com/georgevibing/conch-agent/commit/ab73f077241b87db1aec151b62896a34554615a9))
* **server:** a silent gateway's incident doesn't pass old numbers off as current ([b4322df](https://github.com/georgevibing/conch-agent/commit/b4322df19373818d9598ea8a7e23b0e579108e62))
* **server:** a slow stretch counts for one whole interval, whoever looks in between ([b9e6f81](https://github.com/georgevibing/conch-agent/commit/b9e6f81a3d9144cda1805f630477936644d53f7e))
* **server:** a starved computer's slow cycles are not taken for flapping ([01e89ae](https://github.com/georgevibing/conch-agent/commit/01e89ae0a3bb4f0a073f84b557ac6b245867a9b0))
* **server:** a stretched reduction asks again only when the gateway will listen ([1b7c032](https://github.com/georgevibing/conch-agent/commit/1b7c0321b9f1d87a2ed1252cb4ec75c042a00210))
* **server:** a supervisor whose ticks always come late still judges a frozen gateway ([6b38bea](https://github.com/georgevibing/conch-agent/commit/6b38bea1fe41e89d989618ff5b88a7e581b84c13))
* **server:** Ctrl+C on a gateway that isn't answering doesn't wait fifteen seconds ([2745f0d](https://github.com/georgevibing/conch-agent/commit/2745f0db69f00db9003798977a7631e69c1d7561))
* **server:** setting the clock back doesn't hold every command for as long ([50818cb](https://github.com/georgevibing/conch-agent/commit/50818cb35be5f0282887a9d7131247ab21b514f1))
* **server:** the heaviest command is the one busy now, not one busy long ago ([66deb6a](https://github.com/georgevibing/conch-agent/commit/66deb6ae005bc20dd9a1f0b290c7cde461aa5150))
* **server:** the supervisor says what happened to Conch and how long it waits ([809f498](https://github.com/georgevibing/conch-agent/commit/809f498f9c6a847712a30e5a112e80a1e446fd64))
* **server:** where Conch was stuck keeps the unnamed function that called it ([9eeec05](https://github.com/georgevibing/conch-agent/commit/9eeec0587edfda1727899e4bd1f1ebef5e65f856))

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
