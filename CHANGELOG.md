# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.4](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.3...v0.1.0-alpha.4) (2026-10-11)


### Features

* **nacre:** a quiet line for a chat that switched model when asked ([8989a2b](https://github.com/georgevibing/conch-agent/commit/8989a2bd003628eeb7302aa1ae74e52d49ad091b))
* **nacre:** sign-in cards with accounts to tap, and a Passwords bar while you drive the browser ([f7bde3e](https://github.com/georgevibing/conch-agent/commit/f7bde3ef20423757ba7d0acd964315d586c53630))
* **nacre:** the page's question, find on page and Stop in BrowserWindow ([7f22814](https://github.com/georgevibing/conch-agent/commit/7f2281431a0c5802d51a71cceebab31f0d932c97))
* **protocol:** browser fills say what they do, list accounts to pick, and offer Passwords in the live view ([82cea73](https://github.com/georgevibing/conch-agent/commit/82cea7336c6179c3cb86a2634218c830a46470e9))
* **protocol:** read "use Opus 5.5", "cheaper" or "go back" against the connected models ([8ef3a0f](https://github.com/georgevibing/conch-agent/commit/8ef3a0ffc116b6a4c3955f7dfdfbf4ba39b435d1))
* **protocol:** the page's own dialogs and find on page in the browser's live view ([ff4ce58](https://github.com/georgevibing/conch-agent/commit/ff4ce58858f6356a666201ce80d824dbc644de42))
* **server:** Passwords finds the right login for a page and spots look-alike sites ([2e8b7db](https://github.com/georgevibing/conch-agent/commit/2e8b7db5b54e5e01c0c8e936f8b69bf040d06751))
* **server:** the assistant switches the chat's model when you ask, on every provider ([79dfb44](https://github.com/georgevibing/conch-agent/commit/79dfb448e1b71d17187b70490cdb58fc7f4dbd10))
* **server:** the browser answers a page's questions, fills a form in one step, reads long pages to the end ([b345374](https://github.com/georgevibing/conch-agent/commit/b34537413980352a3c73bddcf3dc8df998989e7e))
* **server:** the browser signs in from Passwords with one question, and makes passwords on sign-up ([b42a009](https://github.com/georgevibing/conch-agent/commit/b42a009ce05ecc97788ea547bbaa33506dd0945c))
* **web:** Activity moves into Settings, under Safe and sound ([ea4cd4c](https://github.com/georgevibing/conch-agent/commit/ea4cd4c87ccf20fb385eaa2ac823cd1572339d5d))
* **web:** answer the page's questions, find on the page and Stop from the browser panel ([64e7dc4](https://github.com/georgevibing/conch-agent/commit/64e7dc49de3ec75fe6ce7d713982118b14a880de))
* **web:** pick the account on a sign-in card, and fill from Passwords in the live view ([3828456](https://github.com/georgevibing/conch-agent/commit/3828456535aa3671b24f6ea193d478409ed071d4))
* **web:** the chat shows when it switched model, with Switch back, and /model reads words ([4811936](https://github.com/georgevibing/conch-agent/commit/481193634e5d1b6f3adc5fc6d576bc2f7a049ffb))


### Bug Fixes

* an answer without a choice reaches the chat as it did before ([f8191b9](https://github.com/georgevibing/conch-agent/commit/f8191b953fa2b3a835ba227057f292572fb1329a))
* **nacre:** an app card's name sits level with its logo, in line with its row ([6c6e9e6](https://github.com/georgevibing/conch-agent/commit/6c6e9e654bf17e5a8a84e4cfec847d33f38ab59a))
* **nacre:** the page's question keeps the focus while you drive ([7ace2a4](https://github.com/georgevibing/conch-agent/commit/7ace2a492717c30bd693e4d3780504da02cba4c0))
* **nacre:** the per-core bars on This computer fill their column on desktop, not just on a phone ([2b96a93](https://github.com/georgevibing/conch-agent/commit/2b96a93be6149d0ff28847706df1bcbadd06a999))
* **server:** a Mac lists Conch by name in Privacy & Security, not "node" ([4806a4a](https://github.com/georgevibing/conch-agent/commit/4806a4a15ef66f0c4b203b76a53d70321af52b2b))
* **server:** routines the assistant makes run on your clock, not the gateway's ([c6edb4d](https://github.com/georgevibing/conch-agent/commit/c6edb4da084ea2abc8ca708bce7204a86f8128ab))
* **site:** publishing asks GitHub again after a passing 502 instead of failing the build ([8067eb3](https://github.com/georgevibing/conch-agent/commit/8067eb325ce909d9dad497e342aacfd7b066ff8d))
* **web:** Delete reads red in the chat selection bar, and the Providers subtitle says less ([6e75bea](https://github.com/georgevibing/conch-agent/commit/6e75bea82b8aebf0188cb6f9fbae4acc564a0144))
* **web:** the Passwords start screen shows its keys, and Password managers says less ([1294936](https://github.com/georgevibing/conch-agent/commit/1294936e3e83977e52b9d071e7f65a9dd50e7152))

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
