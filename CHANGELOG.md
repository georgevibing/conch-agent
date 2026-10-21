# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.16](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.15...v0.1.0-alpha.16) (2026-10-21)


### Features

* **browser:** each errand gets its own browser session ([0d8d55e](https://github.com/georgevibing/conch-agent/commit/0d8d55e285fe8dee40b81c811cbf8d9922354c6a))
* **browser:** show a task's own browser in the live view, and give a chat one ([0f82e1c](https://github.com/georgevibing/conch-agent/commit/0f82e1ccb302ca651af958492802f06ae388c02e))
* **channels:** backups and the security checkup name a number that takes calls ([f4dba03](https://github.com/georgevibing/conch-agent/commit/f4dba03c67b46e144ecc957bcbfcd72f36529b21))
* **channels:** call your assistant on the SMS number, and it rings you when an OK waits ([0c48a54](https://github.com/georgevibing/conch-agent/commit/0c48a54f18432cd12bc170b36889818d3511d1fe))
* **channels:** the public door takes a hook's socket, once it accepts the upgrade ([70d3944](https://github.com/georgevibing/conch-agent/commit/70d3944318f65d95c63c130dfef1fc94f14264bc))
* **protocol:** a browser session of its own per errand ([f52b739](https://github.com/georgevibing/conch-agent/commit/f52b739c83f98cce3ed40626a19b3671bc4ce4c1))
* **protocol:** mark search results found by meaning ([3856bb2](https://github.com/georgevibing/conch-agent/commit/3856bb22b7655beaf13cb74bf92f3f06d86d8397))
* **protocol:** settings for phone calls on the SMS number, and Twilio's call audio messages ([1c8e6d0](https://github.com/georgevibing/conch-agent/commit/1c8e6d022fb3df15e314f2ffe43ee14168df84e2))
* **protocol:** the always-on relay's wire, and the door's third way in ([435ad78](https://github.com/georgevibing/conch-agent/commit/435ad78c262439b09e1683d6a4d353569e6551cf))
* **relay:** an always-on relay that keeps Conch's webhooks sealed while it's off ([1ffbc7a](https://github.com/georgevibing/conch-agent/commit/1ffbc7a164ba6782051202e834cc9d87c6e39944))
* **search:** find chats by meaning, not just words ([faa035b](https://github.com/georgevibing/conch-agent/commit/faa035b18122e8ed24bff278d17b3878505058a2))
* **search:** tell the assistant which earlier chats were found by meaning ([961f9d3](https://github.com/georgevibing/conch-agent/commit/961f9d38eaac567bd08257133e1f17bb7fab7966))
* **server:** pair the always-on relay and drain it through the same door handlers ([b33b8cc](https://github.com/georgevibing/conch-agent/commit/b33b8cc5532bfef1ca9498b759420f9b7d6d7cf3))
* **web:** set up the always-on relay from Settings, in one press and one paste ([7c4511a](https://github.com/georgevibing/conch-agent/commit/7c4511a8bf2f42e04b605ec4580353e6f11e400b))
* **web:** turn phone calls on from the SMS number's page, and find them with ⌘K ([5fa7a79](https://github.com/georgevibing/conch-agent/commit/5fa7a79f8acdb22caf99b2f877fd0555792bac48))


### Bug Fixes

* **channels:** let a call from your number in only with full attestation or the call passcode ([06e29ff](https://github.com/georgevibing/conch-agent/commit/06e29ffb5363e85c2aa6ae2981149ecb172e15d0))
* **nacre:** plain-text excerpts, a no-break clock and the avatar frame ([19a25da](https://github.com/georgevibing/conch-agent/commit/19a25da19ca90e24e83ac337b3b503ce6aad156d))
* **nacre:** swap a typed path's last part and drop recipe asides by index ([fd3970c](https://github.com/georgevibing/conch-agent/commit/fd3970cb629db624c3bb1ef3d429a41b51c123de))
* **protocol:** read failures, headlines, base64 and model names by index ([e6f394f](https://github.com/georgevibing/conch-agent/commit/e6f394f09c51b0440a2d57c15c0077074e23fb86))
* **push:** keep a device quiet only while Conch is in front of someone there ([0487d35](https://github.com/georgevibing/conch-agent/commit/0487d3552be56669532026074794306020b44fea))
* recover stuck app sign-ins and resume chats after question answers ([3f928c1](https://github.com/georgevibing/conch-agent/commit/3f928c1a390853448c28937e73f8059c2ae0f647))
* **relay:** carry the raw query so a kept call step's Twilio signature still checks out ([cd4080b](https://github.com/georgevibing/conch-agent/commit/cd4080b50b2e2ed9de51bcf7744d40e7b3710143))
* **relay:** name WebCrypto's key type the same way in Node's types and the DOM's ([5313349](https://github.com/georgevibing/conch-agent/commit/531334919942bd1bac81f83fe70e9f1896d0bcfa))
* **routines:** catch up on mail after Conch was off, and fold a backlog instead of dropping it ([0f0eb63](https://github.com/georgevibing/conch-agent/commit/0f0eb639a7726f856137b5fa2ad1656f939ca749))
* **server:** back every gateway route with @fastify/rate-limit ([bc16d3c](https://github.com/georgevibing/conch-agent/commit/bc16d3c3e736eeea06ddb36e4270a1902a765798))
* **server:** give the pretend providers' shared budget to @fastify/rate-limit ([98b6d4b](https://github.com/georgevibing/conch-agent/commit/98b6d4b32280966a6e71989ca4a9e9d0af44d3c6))
* **server:** hold QQ's heartbeat between five seconds and two minutes ([3950bcf](https://github.com/georgevibing/conch-agent/commit/3950bcf0f4fe7bdbb2e590772267e6046866dc1a))
* **server:** name found cloud accounts with SHA-256, not SHA-1 ([fd6d2bb](https://github.com/georgevibing/conch-agent/commit/fd6d2bbf1b52b6f9ec3edcb5568731932cbf217e))
* **server:** play the card's own address, checked before connecting ([aede872](https://github.com/georgevibing/conch-agent/commit/aede872876d30110c0bb3550b55f012c5d0824c4))
* **server:** read timeout's options, time zones and bearer tokens without backtracking ([0434096](https://github.com/georgevibing/conch-agent/commit/0434096d007849481fdcdf65eef53ef9320c3c4b))
* **server:** seal model HTML and SVG properly, and close the other CodeQL text-cleanup alerts ([bc8848f](https://github.com/georgevibing/conch-agent/commit/bc8848fc9741ff43164fbc68fb5c31f880131b28))
* **tasks:** let background tasks keep browsing after a browser step fails ([b8f6839](https://github.com/georgevibing/conch-agent/commit/b8f683968c03da8aedbd44650e64c5630050ca9d))
* **web:** a sent message never comes back as a draft, and a restored command doesn't open the menu ([6c73e2f](https://github.com/georgevibing/conch-agent/commit/6c73e2fc49f887313028d496d6d1129424c99652))
* **web:** set a call passcode where calls are turned on ([359938d](https://github.com/georgevibing/conch-agent/commit/359938d4099ad2fb9d6a44d0832e31cca1e2a51e))

## [0.1.0-alpha.15](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.14...v0.1.0-alpha.15) (2026-10-18)

### Fixed

- Signed-out default no longer strands chats; Claude Code sign-in keeps its link
- Show machine RAM separately from OS memory budgets

## [0.1.0-alpha.14](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.13...v0.1.0-alpha.14) (2026-10-17)

### New

- Review and apply skill updates from chat

### Fixed

- Ground Auto decisions in evidence and target wait notifications
- Choosing the provider that is being carried ends the carry

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
