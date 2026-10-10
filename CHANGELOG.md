# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.4](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.3...v0.1.0-alpha.4) (2026-10-10)


### Bug Fixes

* **server:** a Mac lists Conch by name in Privacy & Security, not "node" ([4806a4a](https://github.com/georgevibing/conch-agent/commit/4806a4a15ef66f0c4b203b76a53d70321af52b2b))
* **site:** publishing asks GitHub again after a passing 502 instead of failing the build ([8067eb3](https://github.com/georgevibing/conch-agent/commit/8067eb325ce909d9dad497e342aacfd7b066ff8d))

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
