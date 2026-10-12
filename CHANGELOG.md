# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.

## [0.1.0-alpha.9](https://github.com/georgevibing/conch-agent/compare/v0.1.0-alpha.8...v0.1.0-alpha.9) (2026-10-12)


### Features

* **server:** a frozen gateway leaves where its JavaScript was stuck ([a51c583](https://github.com/georgevibing/conch-agent/commit/a51c583cde1221e0d4a625c6a59c16a5b0380144))
* **server:** a gateway that still answers gets longer while other programs starve the computer ([f256d53](https://github.com/georgevibing/conch-agent/commit/f256d5304130c8a50f04e0cd1fbfca2246a7379a))
* **server:** capture where a frozen gateway is stuck before killing it ([c2d0fdb](https://github.com/georgevibing/conch-agent/commit/c2d0fdb25781f3276e5b187418d86d0868d45737))
* **server:** Conch holds new work while its own loop falls behind, before it stops answering ([483d5d5](https://github.com/georgevibing/conch-agent/commit/483d5d53956732e0825766064e9b1f4d5bdabf8e))
* **server:** each heartbeat says how late Conch's own timers ran ([e8fa94c](https://github.com/georgevibing/conch-agent/commit/e8fa94c80b5a19f95d40119219921bdb58e7d79d))
* **server:** notice a slow memory leak and plan a quiet restart for it ([e9430bd](https://github.com/georgevibing/conch-agent/commit/e9430bde0e935336b0714a352755e86bf1fe21ad))
* **server:** the watchdog calls beforeKill as it gives up on a gateway ([5f6e50a](https://github.com/georgevibing/conch-agent/commit/5f6e50af3ee07e6edfbd325b3e1a48a2d458b936))
* **server:** watch for memory leaks once Conch is listening ([83dab2c](https://github.com/georgevibing/conch-agent/commit/83dab2cac1c76ca55d55274e41f3b12b90ec086d))


### Bug Fixes

* **nacre:** a chart follows its space after switching from Table to Chart ([1550b0f](https://github.com/georgevibing/conch-agent/commit/1550b0f5a251ebc18fcfa1413271e67788e5200c))
* **nacre:** a live chart's colours wrap past the eighth series ([63b6630](https://github.com/georgevibing/conch-agent/commit/63b6630c1ce455b3db93c76ad89e72043525c14e))
* **nacre:** a missing value on a line or area chart is a gap, not a drop to zero ([1d9f5e0](https://github.com/georgevibing/conch-agent/commit/1d9f5e0553811ced7ae2f72a78ef2512f5762b1f))
* **nacre:** stacked bars with negative values stay inside the chart ([8bea993](https://github.com/georgevibing/conch-agent/commit/8bea993a539acbfaf724bde82de43247cc5081bc))
* **protocol:** “less expensive”, “save money” and “more advanced” find a model to switch to ([a90e455](https://github.com/georgevibing/conch-agent/commit/a90e4555a0a03552e6ce9b9330694218148d2841))
* **server:** “go back” finds the model a chat started on ([17b44b7](https://github.com/georgevibing/conch-agent/commit/17b44b729e4c75ce26fdfacc25c9fecb45ec9c60))
* **server:** a big payment written the European way asks first too ([3861e63](https://github.com/georgevibing/conch-agent/commit/3861e63e9bbf5df26f356b9a23b599261eb2125c))
* **server:** a busy month's calendar is read whole, and its card never shows a hidden day as free ([a1b041f](https://github.com/georgevibing/conch-agent/commit/a1b041fb0a991321a57a9eb2f10eaa135f63d5c8))
* **server:** a chat app's long poll and a provider's long answer arrive whole ([0a54414](https://github.com/georgevibing/conch-agent/commit/0a54414277cedf6e44d76a9279189fb729843d3e))
* **server:** a chat's commands end when the gateway crashes, on macOS and Windows too ([871d28d](https://github.com/georgevibing/conch-agent/commit/871d28db86f982103a76b87125f9fb3018235067))
* **server:** a chat's small jobs go to the provider it answers with now ([da98fb3](https://github.com/georgevibing/conch-agent/commit/da98fb3d91ac51465a96f8e77cf2ee74f1f44ffa))
* **server:** a clone over ssh, xh and a looked-up text record mark the chat as having read ([4f69242](https://github.com/georgevibing/conch-agent/commit/4f69242909fd21ab6b890947fd6ded77887f4b63))
* **server:** a command or a file written in capitals is read like the lower-case one ([b97e315](https://github.com/georgevibing/conch-agent/commit/b97e315e39f02ad4e26b547ee9a82f85d3e1f4fb))
* **server:** a Conch app holding too much memory in buffers is stopped ([3cca68f](https://github.com/georgevibing/conch-agent/commit/3cca68f1b15dd087314ce31af59d227232168872))
* **server:** a Copilot chat kept as both .json and .jsonl is brought in once ([1104e79](https://github.com/georgevibing/conch-agent/commit/1104e79a4266c07a936af9e732f035c73415703e))
* **server:** a failed check of how a provider charges isn't kept for a minute ([63613c4](https://github.com/georgevibing/conch-agent/commit/63613c4e190c274c600fb7e27e250484ff2844f6))
* **server:** a frozen gateway is killed in seconds, a struggling one still stops gracefully ([b6a0d5e](https://github.com/georgevibing/conch-agent/commit/b6a0d5e34b4ab9f726651bddadf7152d7f67c456))
* **server:** a mislabelled picture no longer marks a model as unable to see ([13c383c](https://github.com/georgevibing/conch-agent/commit/13c383c8c95b8f5841d2e098ebb23f1f634987d4))
* **server:** a one-off at a time that comes twice runs at the first ([66e40cb](https://github.com/georgevibing/conch-agent/commit/66e40cb61e0e6a51b2f00a1a9ac087e3d4f2e595))
* **server:** a page that says slow down hasn't changed ([7e559ad](https://github.com/georgevibing/conch-agent/commit/7e559ad88a0b589a3961eeaa0acedfbcb4519c8b))
* **server:** a password is never filled into a page that went elsewhere while you were asked ([ee34faf](https://github.com/georgevibing/conch-agent/commit/ee34faf5c916bde0e0b4c1fe91f89674095d6b58))
* **server:** a past chat stays when it grew but couldn't be read just then ([c81896a](https://github.com/georgevibing/conch-agent/commit/c81896a86483092f754670b6f3ba7998274ba14f))
* **server:** a past chat's file that won't read isn't read again until it changes ([3511411](https://github.com/georgevibing/conch-agent/commit/3511411373eb1548b4f20ea9a9e38c3ae600083c))
* **server:** a pause for an agent running its own loop counts steps, not tool calls ([d90d6e7](https://github.com/georgevibing/conch-agent/commit/d90d6e7d5dcc192cb7eac20d11fb5b25944c611b))
* **server:** a picture can be edited from one of the chat's attachments by its id ([4a06746](https://github.com/georgevibing/conch-agent/commit/4a06746874dafbecff58711cc4767c951623d7b6))
* **server:** a provider's error is read as "out of credit" or "model gone" only when it says so ([ebd7803](https://github.com/georgevibing/conch-agent/commit/ebd7803807384c97af150c477603ac2281a6a1f6))
* **server:** a quoted .env value with a comment after it comes in without its quotes ([46c09e7](https://github.com/georgevibing/conch-agent/commit/46c09e7a41e4dfa8fdcabb62c8dccfc16c603e85))
* **server:** a redirect to another site goes without the key, and a 303 asks again with GET ([795143c](https://github.com/georgevibing/conch-agent/commit/795143c21d0c1e3cc1590d395318b8d54a03e6eb))
* **server:** a reply cut off at the most a model can write says so, and a cut-off tool call never runs ([c604d19](https://github.com/georgevibing/conch-agent/commit/c604d199ee460acfe7ff97f4414d75c1eee5e756))
* **server:** a routine paused while the clock looks stays paused ([d322e68](https://github.com/georgevibing/conch-agent/commit/d322e685dc1d4cc9dc77c9f22114df7de26f94e6))
* **server:** a saved trajectory hides a tool argument whose field names a secret ([f6e372b](https://github.com/georgevibing/conch-agent/commit/f6e372be38e3a374f8850fe61887817a4d3cd0e5))
* **server:** a sealed page that navigates another way, or leaks by STUN or prefetch, opens with its code off ([8b3e975](https://github.com/georgevibing/conch-agent/commit/8b3e97543ea3dcf26fa6e0c748e39f5b4d63ac62))
* **server:** a skill from a GitHub repository too big to list whole isn't added part-way ([94439f2](https://github.com/georgevibing/conch-agent/commit/94439f2492552fb888b9795de14a9c03be87f954))
* **server:** a skill is verified against the whole key you trust, not its fingerprint ([c806bd5](https://github.com/georgevibing/conch-agent/commit/c806bd539b7fb2ffb650f74cff8f59b691814d0e))
* **server:** a skill suggestion you turned down stays down as you keep asking ([8d283df](https://github.com/georgevibing/conch-agent/commit/8d283df6d65cda716fd747ebcf4afc30ff62567c))
* **server:** a skill's allowed-tools reads the way YAML reads it ([6d6281a](https://github.com/georgevibing/conch-agent/commit/6d6281a47f8e5974065ad9da820ba20f3d5c0c71))
* **server:** a skill's review and fingerprint cover its deep files, bundled packages and links ([78c36b6](https://github.com/georgevibing/conch-agent/commit/78c36b68291a9c49cac2f48f268bfaa795372aa3))
* **server:** a slow start tells the supervisor it's still starting ([92d58a1](https://github.com/georgevibing/conch-agent/commit/92d58a1d7197e9cf66acaa8741c467d0b9cdeeb7))
* **server:** a slow start that keeps saying it's starting isn't taken for a freeze ([e36ba87](https://github.com/georgevibing/conch-agent/commit/e36ba875e5ee5da1d70acbc83455715137f3b853))
* **server:** a stopped Conch app call is let go, so it can't fetch or stop the app later ([c5a344c](https://github.com/georgevibing/conch-agent/commit/c5a344c17f0c0a58b40b64d2dafde5d4b1dde23c))
* **server:** a swap the pointer never reached is forgotten, not left pending forever ([cdddfa2](https://github.com/georgevibing/conch-agent/commit/cdddfa2221372c3bf9d04926f355bb7415b28521))
* **server:** a task set to go after another no longer deadlocks it over a shared file ([db8167a](https://github.com/georgevibing/conch-agent/commit/db8167a2be1317107a9c7cc86cf2d34deaac6a2d))
* **server:** a tool call's pieces stay together from servers that send no index or id ([1950bf9](https://github.com/georgevibing/conch-agent/commit/1950bf9671b30d6e02ace7f017df733938becaa4))
* **server:** a tool schema with fields but no root type keeps its fields ([e4c9e10](https://github.com/georgevibing/conch-agent/commit/e4c9e10e8260d5856260199fdf2e167e7504e7cc))
* **server:** a tool that takes anything keeps an input field it was given ([89ed6e1](https://github.com/georgevibing/conch-agent/commit/89ed6e18d7e4ebf69c05b282e10a2973d8b5785c))
* **server:** a tool's own mend reads fields by other names before unknown ones are dropped ([6339d84](https://github.com/georgevibing/conch-agent/commit/6339d84cec7e12c9c5ee6acc8ea6bcb5af835a55))
* **server:** a trajectory takes out the home folder, not a folder whose name starts the same ([c7aa0e6](https://github.com/georgevibing/conch-agent/commit/c7aa0e676e1bddb7fb09c08b252881baff364f3b))
* **server:** a wait that ended while Conch slept or restarted says it ended ([1e5997b](https://github.com/georgevibing/conch-agent/commit/1e5997bb1ed9e45c0f96de86d8aae1231c97048c))
* **server:** a well-known name pointed at someone else's code asks before installing ([d327392](https://github.com/georgevibing/conch-agent/commit/d3273925f0df514e741957a8f9f2a13d0fe2631a))
* **server:** a wrapped rm -rf ~ still asks, and still breaks the circuit ([189c1f4](https://github.com/georgevibing/conch-agent/commit/189c1f4f71882ab1164efde44bd456abc4227014))
* **server:** About you and routines brought from another app never carry a key ([f8d8220](https://github.com/georgevibing/conch-agent/commit/f8d822088a2eac7e9677179ce15f156a8a9e3ca0))
* **server:** Allow from the lock screen isn't offered for a delete written another way ([46a54db](https://github.com/georgevibing/conch-agent/commit/46a54db06265b7e4d7b0ab62f56efdf68e0236e9))
* **server:** an attachment named meta.json keeps its own bytes ([f3c7d22](https://github.com/georgevibing/conch-agent/commit/f3c7d22f365d2b8504000311f81cdca9a471b1aa))
* **server:** an IBAN typed in one piece and saved in groups is still your own ([696e7db](https://github.com/georgevibing/conch-agent/commit/696e7db15be6aa4c8d75e57b6465ec6dbf93dbf3))
* **server:** an incident shows no measurements rather than old ones ([397aef9](https://github.com/georgevibing/conch-agent/commit/397aef9fcc91a23a5e1bf2bca78898927f9a2005))
* **server:** an IPv6 sign-in is throttled by its whole /64 ([aff99bd](https://github.com/georgevibing/conch-agent/commit/aff99bde087060155d9f79fe8099a0cc62f9b465))
* **server:** asking again for an update that's waiting for a restart leaves it ready ([db124de](https://github.com/georgevibing/conch-agent/commit/db124de63f799bc2a0d944a1ded37650c758ce24))
* **server:** chart_show takes one series written flat as values or data ([416a95f](https://github.com/georgevibing/conch-agent/commit/416a95fe0b357635b5b9010fbd2819e5ade1df26))
* **server:** commands that run at once keep all their changes, as the turn's ([eaceeb4](https://github.com/georgevibing/conch-agent/commit/eaceeb4c8f4ba1e0a1809a61a36d79f26c4dc3d8))
* **server:** Conch never calls [::] or a private address behind NAT64 ([cc5064b](https://github.com/georgevibing/conch-agent/commit/cc5064b511f4f6e61e6e0374289867f371128af5))
* **server:** Conch's kept-away places are seen however a command spells them ([045ab8d](https://github.com/georgevibing/conch-agent/commit/045ab8d548c69d89eeb642fb6c244777fcd4bcf1))
* **server:** deleting on GitHub through gh api asks, as gh repo delete does ([6820d55](https://github.com/georgevibing/conch-agent/commit/6820d5522c47604c1d0c626387a5c4c7f8ff0e27))
* **server:** downloaded code run through a flag, a tee or a saved file asks ([498ae5b](https://github.com/georgevibing/conch-agent/commit/498ae5bb5150d183a7b9dbb088a0d04afbb4a99a))
* **server:** failed sign-ins from elsewhere no longer keep this computer out ([8060509](https://github.com/georgevibing/conch-agent/commit/8060509c61507918753c9d06113abbc19e512529))
* **server:** files with long or accented names come back from a machine ([393bbaf](https://github.com/georgevibing/conch-agent/commit/393bbaf20cfe54152e4675df9462d2b7f7f37521))
* **server:** find -delete and rsync --delete ask like rm -r of the same folder ([181b357](https://github.com/georgevibing/conch-agent/commit/181b357e1927e1f0dec8f772ca562fb0c55e307a))
* **server:** front matter Conch writes quotes a value ending in a colon, and ones YAML reads as numbers ([9a793f2](https://github.com/georgevibing/conch-agent/commit/9a793f283d147f0b9b9190c074df6372fd33ab66))
* **server:** health that keeps failing again restarts instead of shedding forever ([cbcd95c](https://github.com/georgevibing/conch-agent/commit/cbcd95c00d153b47207c3d6249218ac346db9941))
* **server:** Hermes' YAML reads escaped quotes, and front matter after a byte-order mark ([bdb2264](https://github.com/georgevibing/conch-agent/commit/bdb2264558e22bc4c7c9c57b0697dd718da9b510))
* **server:** installing from this computer or posting to it doesn't ask after reading ([4e3de29](https://github.com/georgevibing/conch-agent/commit/4e3de29609c970cc8f278d01eb5cab63116a2731))
* **server:** keys named like DB_PASSWORD or given as --password are hidden, and Stripe, Hugging Face and npm keys too ([ed8ee46](https://github.com/georgevibing/conch-agent/commit/ed8ee465cf19a9d3e0e30670e0c24524d5e3abdf))
* **server:** lean mode keeps instructions after a # comment in a code block ([fd782ba](https://github.com/georgevibing/conch-agent/commit/fd782ba9f5f1d07cf07932f8cb08db887efd6b69))
* **server:** lean mode's code-block check type-checks ([01f35f5](https://github.com/georgevibing/conch-agent/commit/01f35f517f7cf87f138e76555a222c6f6f446c3c))
* **server:** long answers split for chat apps keep emoji, code indentation and ~~~ fences whole ([7444ea7](https://github.com/georgevibing/conch-agent/commit/7444ea702184a25846aeaa296a4a86309fe5ba40))
* **server:** offers to connect an app keep to asking for it, not mentioning it ([e6f304e](https://github.com/georgevibing/conch-agent/commit/e6f304e6ca169a6eb3d8b197f76cbafd7b93ddc8))
* **server:** one long job of many middling results still fits a small window ([d292ed5](https://github.com/georgevibing/conch-agent/commit/d292ed58bd0143428cee9a05ef572700fdbc7856))
* **server:** only a pyproject's dependencies count as declared, not every key in it ([8c25237](https://github.com/georgevibing/conch-agent/commit/8c25237ebee559b148bd38c7c72d8d2b37de658a))
* **server:** OpenClaw's config reads right when a string holds a colon or a comma ([fa7755f](https://github.com/georgevibing/conch-agent/commit/fa7755f96875b3ee2182e1296af2ac504ed37f72))
* **server:** pressing Run now twice starts a routine once ([0872ebf](https://github.com/georgevibing/conch-agent/commit/0872ebf0a59eda1d9417f2c1225cb233baa23d6c))
* **server:** programs run for a place end when the gateway crashes ([30fe96e](https://github.com/georgevibing/conch-agent/commit/30fe96ef209f2ded3b55482e3b8633f64dfc2a03))
* **server:** quiet learning keeps a password manager, a loan officer or a star sign ([8fc0327](https://github.com/georgevibing/conch-agent/commit/8fc032790dd139b728925e31a2098d2dbccae865))
* **server:** reading ~/.npmrc or ~/.pypirc counts as reading keys ([4fdab42](https://github.com/georgevibing/conch-agent/commit/4fdab42bfa2016f13ff579f0609028512e60d416))
* **server:** reading a cluster or a cloud doesn't ask because of the names in it ([3b43627](https://github.com/georgevibing/conch-agent/commit/3b4362728255ac4ccceecd6500cb58d02826b4fa))
* **server:** relief after a freeze says Conch is recovering, not that memory is short ([e2dc725](https://github.com/georgevibing/conch-agent/commit/e2dc72549c686abb631a9c44d7ff0693ada680db))
* **server:** relief stops the heaviest managed command, not the newest ([190d818](https://github.com/georgevibing/conch-agent/commit/190d81875ce422e4f51839e13f19f3be1d700682))
* **server:** scrollback with no line break is cut at a whole character ([cd93ef0](https://github.com/georgevibing/conch-agent/commit/cd93ef092422f2dc4bcaaf1ebe92df248bb8df9e))
* **server:** Show it as a chart only comes under a table whose numbers are the point ([c71fe34](https://github.com/georgevibing/conch-agent/commit/c71fe34a04211a3734d9757285334e9f4932b9ea))
* **server:** Slack catch-up can page back through a busy channel and on through a long thread ([2a708c1](https://github.com/georgevibing/conch-agent/commit/2a708c17c16b39b633e1d1fea8e1fdf62ee117db))
* **server:** ssh running grep -R over there isn't described as opening a tunnel ([78f16b4](https://github.com/georgevibing/conch-agent/commit/78f16b4d4d1135ec10b15c56a917478535d72fea))
* **server:** Stop pressed while Claude Code gets ready stops the turn ([079a849](https://github.com/georgevibing/conch-agent/commit/079a84964416d3c3ce4a7afe81535b9308020bd8))
* **server:** stopping Conch on Windows lets the gateway save its conversations first ([6dac5f7](https://github.com/georgevibing/conch-agent/commit/6dac5f7f6b576a5ac6a3b6c86818589ee84272a1))
* **server:** the 15-minute minimum holds whatever time a cron routine is set up ([e27b0d2](https://github.com/georgevibing/conch-agent/commit/e27b0d2578456bdf5897769dfb2cdc630a4da5f0))
* **server:** the basic terminal never breaks a character split across error writes ([d3f8883](https://github.com/georgevibing/conch-agent/commit/d3f888326034ac58628b24d99069380c7321b529))
* **server:** the browser never opens Conch at an IPv4 address written inside IPv6 ([6e7578e](https://github.com/georgevibing/conch-agent/commit/6e7578eed31438e11dd19f31a5d13b7ae2a6e236))
* **server:** the memory check keeps "Never delete files without asking the user first" ([bb28612](https://github.com/georgevibing/conch-agent/commit/bb286128623aad275033c570b49257fdc90eef73))
* **server:** the pty-through-Python terminal keeps no unused decoder ([d32cedc](https://github.com/georgevibing/conch-agent/commit/d32cedcfbb4552dbb36f8dea0283206c3d19c56b))
* **server:** the relief cooldown runs on the monotonic clock ([914b263](https://github.com/georgevibing/conch-agent/commit/914b263b34f2022b664bbc81d3ee4ba0b6734de8))
* **server:** the same memory said twice at once, or a long one, is kept once ([d07f014](https://github.com/georgevibing/conch-agent/commit/d07f014758131de86fe597ad8a6b9ed0926b26e5))
* **server:** turning down several skill suggestions at once keeps every one ([3148430](https://github.com/georgevibing/conch-agent/commit/31484303133a005e122685280e9422d2bfcbf90f))
* **server:** two looks at the clock at once no longer log a skipped run ([cf72e7a](https://github.com/georgevibing/conch-agent/commit/cf72e7ae6ca4ed9b6d980723397dfa609c18b9ad))
* **server:** two messages sent at once in a chat start one reply ([c39eea9](https://github.com/georgevibing/conch-agent/commit/c39eea9f02b46b6d1a2545147f2b2ad4bd5725fd))
* **server:** Undo never removes a file too big to keep that a command shrank ([749960b](https://github.com/georgevibing/conch-agent/commit/749960bc5d96b664689ca9c6edea285020a52b9a))
* **server:** Undo never removes an empty read-only file that a command filled ([32e083f](https://github.com/georgevibing/conch-agent/commit/32e083f17dec73491fa82fed1e49513e714dc7ae))
* **server:** waking a laptop doesn't stop the newest command ([42cbe6f](https://github.com/georgevibing/conch-agent/commit/42cbe6f45be60d295d41dd4ad2a1a613728692b3))
* **server:** words in quotes don't trip the circuit breaker or read as sudo ([64ab87d](https://github.com/georgevibing/conch-agent/commit/64ab87dbd3f8bb202714aee986e7f388b4bb051a))
* **server:** your own mail counts only when its Sent copy is that very email ([ef841c0](https://github.com/georgevibing/conch-agent/commit/ef841c049b127a68b099f86b72d2702fb2394a04))
* **web:** a chat opened while connecting is asked for once ([d070646](https://github.com/georgevibing/conch-agent/commit/d07064617322d3371a678326d7c8fc4d5d17e578))
* **web:** a code fence inside a longer fence stays code while a reply streams ([401c082](https://github.com/georgevibing/conch-agent/commit/401c082e137924122fb4b3486998c8b85e23962d))
* **web:** a link to a chat with an impossible id no longer blanks the app ([0a40ff4](https://github.com/georgevibing/conch-agent/commit/0a40ff46d5dd0c115bcf774f4ba58250661f5c89))
* **web:** a message too long to send stays in the box and says so ([5e2b264](https://github.com/georgevibing/conch-agent/commit/5e2b2647320128fdf84539b0637f9a92e27670c9))
* **web:** a Stop pressed after a reply ended doesn't make the next one look stopped ([79e7526](https://github.com/georgevibing/conch-agent/commit/79e7526ff86375fd9538b36d434ef57fce5ef6be))
* **web:** an error page that isn't JSON is an ApiError, and a 401 still signs out ([f007063](https://github.com/georgevibing/conch-agent/commit/f007063d319947260945af99bcdfdbcb8dae74d0))
* **web:** leaving a chat while a file uploads says it isn't attached ([d7f4c7d](https://github.com/georgevibing/conch-agent/commit/d7f4c7dbafd21bfe84541d996cf541e3f4f07c4d))
* **web:** messages waiting their turn keep their files when you leave the chat ([9398f60](https://github.com/georgevibing/conch-agent/commit/9398f608e51d10c3bdc02671dd89ecd27e40fa7c))
* **web:** two quick drops can't go past the attachment limit or add a file twice ([c62376a](https://github.com/georgevibing/conch-agent/commit/c62376a8d4f9df4c14a8ed51f4800d7d8761d0e1))

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
