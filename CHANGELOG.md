# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.18](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.17...v0.1.0-alpha.18) (2026-10-26)


### Features

* always allow one command, not a whole kind of step ([5c9381c](https://github.com/georgevibing/conch-agent/commit/5c9381c0be139ecb454036370cd4c881cb8eee7c))
* **nacre:** VaultApproval asks to use a saved key in a command, unseen ([78fbf88](https://github.com/georgevibing/conch-agent/commit/78fbf88d33ede23f9d069b2cfc4449a533710798))
* replay your own chats to see how often Auto's rules would ask ([71b0447](https://github.com/georgevibing/conch-agent/commit/71b044718bcb55748265269b6a9125e3868c0983))
* **server:** a provider can name its own fast model for Auto's reviews ([5bc183e](https://github.com/georgevibing/conch-agent/commit/5bc183e05479fede2ddd1fd4a1a0ab02c82b9157))
* **server:** Auto can review steps for Copilot, Gemini CLI and Grok ([d433776](https://github.com/georgevibing/conch-agent/commit/d43377621f39992fdd4845fe46808bb66d164ad8))
* **server:** Auto checks each step once, quickly, and reuses the answer ([c48465e](https://github.com/georgevibing/conch-agent/commit/c48465ec508fd2b31952cc24128894a0cb633c4a))
* **server:** Auto's reviews on Claude Code run on Haiku, with Claude Code started ahead ([f8abac8](https://github.com/georgevibing/conch-agent/commit/f8abac80fd5717cd66affe8a0303ade257eed391))
* **server:** Auto's reviews on Codex use its fastest model your account lists ([acb2791](https://github.com/georgevibing/conch-agent/commit/acb27919ae7d8c1469a67afb4f31011aa60a5296))
* **server:** Auto's reviews on pay-as-you-go keys use the provider's own fast model ([da34f31](https://github.com/georgevibing/conch-agent/commit/da34f3121f0c262fd8cdd7c13a395fc72acfd1b0))
* **server:** count Auto's reviews and how long they take ([96cd4bc](https://github.com/georgevibing/conch-agent/commit/96cd4bc33c2bb68fa7caff6e1dca7a62118ca700))
* **server:** every chat knows which programs here reach a service, and as whom ([433bd3f](https://github.com/georgevibing/conch-agent/commit/433bd3f226a659bad6a0849ef6b6665dff01f526))
* **server:** Full trust, or your own words naming it, uses a saved key without a card ([8a1a114](https://github.com/georgevibing/conch-agent/commit/8a1a114fdd8d0c9b324ad570510de520b3258730))
* **server:** installs, clones and pulls run in the sealed box ([1ad5d1b](https://github.com/georgevibing/conch-agent/commit/1ad5d1b389c63086b335542c0fdeb7e4edce6dc3))
* **server:** put a saved key into a command's environment without the model seeing it ([a602f71](https://github.com/georgevibing/conch-agent/commit/a602f71cd66ee8473f97db010e000e6fe3458870))
* **server:** tasks keep what you asked for in their chat, so Auto doesn't ask again ([c15e508](https://github.com/georgevibing/conch-agent/commit/c15e508fb3473d0bd7ed6a27b7fed742b1e622fe))
* **server:** the assistant can have Conch look at an app again ([a393758](https://github.com/georgevibing/conch-agent/commit/a393758597b9de2063ff612b572c1ddcc16cf8a5))
* **server:** your dashboard shows how often Auto asks, per 100 steps, and why ([a811221](https://github.com/georgevibing/conch-agent/commit/a811221232642e784e58334958e22708c9534956))
* tell Auto about where you work, in your own words ([d8baf7c](https://github.com/georgevibing/conch-agent/commit/d8baf7c46eab2b2bd13b44c26825de84a49fa050))


### Bug Fixes

* **nacre:** a password card fits a phone, its check beside the first line ([1938e42](https://github.com/georgevibing/conch-agent/commit/1938e42b3a7c87e0f64a3d8b9302eee9331d66ad))
* **server:** a serious step's card never offers to always allow it ([106085d](https://github.com/georgevibing/conch-agent/commit/106085d530ebd8a0c60b2fed8654523645a879f6))
* **server:** a skill's rule never stands between the person and Conch's own safe way ([6f3ac3c](https://github.com/georgevibing/conch-agent/commit/6f3ac3c20f6e8bbf1a9adf711e04002f456a50a5))
* **server:** a step you said not to do asks you, instead of being refused ([a05e8d0](https://github.com/georgevibing/conch-agent/commit/a05e8d096579cc6d09da4d0ed23b46dcf3b95d0c))
* **server:** a wait reads CI through whichever GitHub sign-in can see the repo ([b233407](https://github.com/georgevibing/conch-agent/commit/b23340723bce92454dd327a0897c23c9cf81d471))
* **server:** an app call never holds a turn, and Stop cancels it ([20ed68e](https://github.com/georgevibing/conch-agent/commit/20ed68e3ff0509bdf16755d7372bbee99af6ab96))
* **server:** an app that didn't open for a turn is looked at again first ([78402d5](https://github.com/georgevibing/conch-agent/commit/78402d5da3d2f47bebfacbbd6fa57e3c1038ffe5))
* **server:** an app that isn't connected doesn't hide the way in this computer already has ([45fefba](https://github.com/georgevibing/conch-agent/commit/45fefbaa11db881bd6f696de413180cb2dc6d259))
* **server:** Auto doesn't make you wait for a review that can't change the answer ([4b47af3](https://github.com/georgevibing/conch-agent/commit/4b47af39d8c18f9f7ab8d89e29d4da8b03a901ac))
* **server:** Auto goes ahead when you ask it to push, in your own words and language ([63627c0](https://github.com/georgevibing/conch-agent/commit/63627c05545abfe97ad4b0b9fe63daf8b548f10a))
* **server:** every assistant reaches a service the most direct way first ([c6929e9](https://github.com/georgevibing/conch-agent/commit/c6929e9ee8d5d2eac52c05c2e3cdd6a7a5f8c639))
* **server:** every prompt names one way to give a command a saved key ([81632e9](https://github.com/georgevibing/conch-agent/commit/81632e97fd4dcb1292979859d8fbfca56aa37f76))
* **server:** Passwords tells every model how to use a saved key, whatever a skill says ([5ef2cad](https://github.com/georgevibing/conch-agent/commit/5ef2cad9da90fc8e6a7c714ed44da91e0f641e82))
* **server:** the apps prompt names tools as the engine gets them, and a missing app's tools are said ([1bb619c](https://github.com/georgevibing/conch-agent/commit/1bb619c2f818c7a209b5f3980c1e3d0319bfaea1))
* **server:** the browser comes after the app, and a stuck model tries another way in ([02d490a](https://github.com/georgevibing/conch-agent/commit/02d490ae16fa98a10abcdd58edce6a8094b3b476))
* **server:** tools past one list's room wait behind find_tools instead of vanishing ([d741af4](https://github.com/georgevibing/conch-agent/commit/d741af42990500561197e2a973d5c705a3eb3f6c))

## [0.1.0-alpha.17](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.16...v0.1.0-alpha.17) (2026-10-25)

### New

- Review Auto actions against the authorized task
- Every kind of file you attach reaches every model, and opens in a preview

### Fixed

- An answered question's tick stays beside its first line

## [0.1.0-alpha.16](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.15...v0.1.0-alpha.16) (2026-10-21)

### New

- Set up the always-on relay from Settings, in one press and one paste
- Each errand gets its own browser session
- Find chats by meaning, not just words
- Pair the always-on relay and drain it through the same door handlers
- The public door takes a hook's socket, once it accepts the upgrade
- An always-on relay that keeps Conch's webhooks sealed while it's off

### Better

- Review requested Gmail sends at the resolved connector boundary in Auto
- Keep sandbox recovery guidance within every model prompt budget
- Honor Full trust for Claude Code host commands before guarding execution

### Fixed

- Read timeout's options, time zones and bearer tokens without backtracking
- Seal model HTML and SVG properly, and close the other CodeQL text-cleanup alerts
- Back every gateway route with @fastify/rate-limit
- Recover stuck app sign-ins and resume chats after question answers
- And 7 fixes

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
