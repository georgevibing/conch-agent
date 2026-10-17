# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.14](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.13...v0.1.0-alpha.14) (2026-10-17)


### Features

* **protocol:** a skill-update card and an expected hash for reviewed saves ([8498d10](https://github.com/georgevibing/conch-agent/commit/8498d10ef319fadb5080f30342c92cceb1d186c7))
* **protocol:** describe inspect_skill and edit_skill in plain words ([31e80f9](https://github.com/georgevibing/conch-agent/commit/31e80f9dc8cdf551943d0b59fe88b5c1b34c436f))
* **skills:** review and apply skill updates from chat ([2b53211](https://github.com/georgevibing/conch-agent/commit/2b53211a8d0e447bb2a6196176cca66b21faef1a))
* **skills:** wire the skill-update review into the store, service, chat and docs ([59bff05](https://github.com/georgevibing/conch-agent/commit/59bff05485ea28b0aa418e99faa78484c0020529))


### Bug Fixes

* **server:** ground Auto decisions in evidence and target wait notifications ([b1aafe3](https://github.com/georgevibing/conch-agent/commit/b1aafe368ec1fe203e4772faf89988b2ba315b80))
* **waits:** resolve channels after service initialization ([ce1d09e](https://github.com/georgevibing/conch-agent/commit/ce1d09ef0275e9de8189a79153d5c762ce75446f))
* **web:** choosing the provider that is being carried ends the carry ([98c57fd](https://github.com/georgevibing/conch-agent/commit/98c57fd193537f4952aff8d4f5564edc37a1cd37))

## [0.1.0-alpha.13](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.12...v0.1.0-alpha.13) (2026-10-16)

### Fixed

- Honor permission modes and keep empty chat checks quiet

## [0.1.0-alpha.12](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.11...v0.1.0-alpha.12) (2026-10-16)

### New

- A chat can wait for another chat, or a task it started, and carry on by itself when it's done
- Your chats know what your other chats are doing
- Your chats can message each other, and stop each other, as far as you let them

### Fixed

- The note at the top of a chat keeps its width again

## [0.1.0-alpha.11](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.10...v0.1.0-alpha.11) (2026-10-13)

### New

- Passwords knows how an account signs in: with Google, Apple or another account, a passkey, single sign-on, or an emailed link
- An item that signs in with Google says so, with the account, and opens the Google login it uses
- In Conch's browser, your assistant presses the site's Continue with Google and Conch fills your Google sign-in, after one question
- A passkey kept only in another password manager is handed to you, with the offer to make one in Conch next time
- Choose how one of your own items signs in when you edit it, and find them by searching "google", "passkey" or "sso"

### Better

- An item's page is calmer on a phone: one short line under its name, and the buttons below it
- Items from 1Password and other managers say where they're kept in one line, with Copy into Conch beside it
- Copy into Conch keeps how an item signs in

### Fixed

- A 1Password item saved as Sign in with Google no longer shows an empty password that does nothing
- Logins without a password are no longer counted as weak or reused in the Security check

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
