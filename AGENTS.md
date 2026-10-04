# AGENTS.md

Operating manual for AI coding agents (and humans) working in **Conch**. Read this
first, then follow the routing table to the one document that covers your task.
Nested `AGENTS.md` files override this one for their subtree.

## What Conch is

A self-hosted web shell for the coding agents and models of your choosing. A small
Node gateway runs on your own machine, drives every provider you connected — [Claude
Code](https://code.claude.com) through the Claude Agent SDK, the plans people pay for
through their vendor's own program (Codex, Copilot, Gemini CLI, Grok), a model on this
computer or a server of their own, or a model API — all at once, from one model picker, and streams the conversation to
a React web app built on **Nacre**, our own design system. Apps (integrations) and
skills belong to Conch, so they work with every provider. Conch also grows by
itself: ask for an ability it doesn't have, and it builds a **Conch app** (tools
every model can use, pages that look like Conch, sealed off), adds it when you say
so, and shares it on GitHub in one press. See [ARCHITECTURE.md](./ARCHITECTURE.md)
and [§ How Conch extends itself](#how-conch-extends-itself).

**The Conch promise.** Anyone can use it, including people who have never opened a
terminal. Conch sets itself up, fixes what breaks before anyone notices, and
interrupts only to ask for approval of something that matters, or for the one
thing only a person can do. Every feature is judged by that promise first. See
working agreement 11: _fix it before you ask_.

## Routing — where to go for what

| If your task involves…                                                                                                                  | Read / work in                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any UI component, token, animation, theming, Storybook                                                                                  | [`packages/nacre/AGENTS.md`](./packages/nacre/AGENTS.md) → [`docs/design/NACRE.md`](./docs/design/NACRE.md)                                                                                                                                                                                                                                                                                                                                                               |
| The web app (routes, state, data fetching, chat screens)                                                                                | `apps/web/` + [ARCHITECTURE.md § Web app](./ARCHITECTURE.md#web-app-appsweb)                                                                                                                                                                                                                                                                                                                                                                                              |
| The gateway / Claude Code integration / permissions                                                                                     | `apps/server/` + [ARCHITECTURE.md § Gateway](./ARCHITECTURE.md#gateway-appsserver)                                                                                                                                                                                                                                                                                                                                                                                        |
| Wire protocol between web and gateway                                                                                                   | `packages/protocol/` + [ARCHITECTURE.md § Protocol](./ARCHITECTURE.md#wire-protocol-packagesprotocol)                                                                                                                                                                                                                                                                                                                                                                     |
| Lint / TS config shared across packages                                                                                                 | `packages/eslint-config/`, `packages/tsconfig/`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Apps (integrations, MCP servers, OAuth, the catalog)                                                                                    | `apps/server/src/integrations/` (`hosted.ts` joins Conch's own apps) + [ADR 0009](./docs/adr/0009-integrations.md), [ADR 0049](./docs/adr/0049-every-app-works-with-every-model.md) (every app works with every model) — security-relevant                                                                                                                                                                                                                                |
| The Apps page: one card per app, its switches, Talk to me here, old addresses                                                           | web `features/integrations/{apps,paths}.ts`, `{AppsView,AppDetailView,AppAbilitiesSection}.tsx`, `Channel.app`, `channels/routes.ts` (`/api/channels/email/gmail`), Nacre `AppAbilities`, `IntegrationCard` + [ADR 0052](./docs/adr/0052-one-app-one-card.md)                                                                                                                                                                                                             |
| Providers (which engine runs, connecting them, keys, the Providers page)                                                                | `apps/server/src/providers/`, `apps/server/src/secrets/`, `engines/registry.ts` (every built-in engine), web `features/providers/` + [ADR 0010](./docs/adr/0010-providers.md), [ADR 0012](./docs/adr/0012-every-provider-at-once.md), [ADR 0053](./docs/adr/0053-more-providers.md) — security-relevant                                                                                                                                                                   |
| Pay-as-you-go providers: one OpenAI-style adapter, a row per company, regions, knowing a pasted key                                     | `engines/api/{chat,openai,presets}.ts`, `providers/catalog.ts` (`recognise`, `envKeys`), protocol `recogniseKey`, Nacre `KeyCatcher`, web `features/providers/FoundHere.tsx` (`KeyPaste`) + [ADR 0053](./docs/adr/0053-more-providers.md) — security-relevant                                                                                                                                                                                                             |
| Your plans through the vendor's own program over ACP (Copilot, Gemini CLI, Grok)                                                        | `engines/acp/` (`agents.ts` one row per program, `door.ts` Conch's tools on loopback, `shim.mjs` the door over stdio, `calls.ts` its own tool calls as rows, `engine.ts` declines native tools, loads sessions) + [ADR 0053](./docs/adr/0053-more-providers.md), [ADR 0036](./docs/adr/0036-provider-consistency.md), [ADR 0069](./docs/adr/0069-carrying-a-chat-on.md) — security-relevant                                                                               |
| Servers of your own, LM Studio, Ollama Cloud, Found on this computer                                                                    | `providers/{servers,found}.ts`, `engines/api/{server,lmstudio,ollamaCloud}.ts`, `local/host.ts` (`isPrivateUrl`), web `features/providers/{AddServer,FoundHere,ProviderGallery}.tsx` + [ADR 0053](./docs/adr/0053-more-providers.md) — security-relevant                                                                                                                                                                                                                  |
| A model on this computer (Ollama, pulls, offline)                                                                                       | `apps/server/src/local/`, `engines/api/ollama.ts`, `apps/web/src/features/local/` + [ADR 0022](./docs/adr/0022-a-model-on-this-computer.md) — security-relevant                                                                                                                                                                                                                                                                                                           |
| Skills (SKILL.md, other agents' folders, `use_skill`)                                                                                   | `apps/server/src/skills/` + [ADR 0013](./docs/adr/0013-skills.md) — security-relevant                                                                                                                                                                                                                                                                                                                                                                                     |
| The browser (live view, takeover, per-site permissions)                                                                                 | `apps/server/src/browser/`, `apps/web/src/features/browser/`, `packages/nacre/src/patterns/Browser/` + [ADR 0014](./docs/adr/0014-browser.md) — security-relevant                                                                                                                                                                                                                                                                                                         |
| Every model sees the page: screenshots as pictures or in words, the describer, sight per model                                          | `engines/api/{pictures,sight}.ts`, each wire's `toolResults` and `seesFor`, `vision/describer.ts`, `TurnInput.describe`, `Engine.completeSees` + [ADR 0070](./docs/adr/0070-every-model-sees-the-page.md)                                                                                                                                                                                                                                                                 |
| The terminal (shells on the host, the drawer, who may open one)                                                                         | `apps/server/src/terminal/`, `apps/web/src/features/terminal/`, `packages/nacre/src/patterns/Terminal/` + [ADR 0015](./docs/adr/0015-terminal.md) — security-relevant                                                                                                                                                                                                                                                                                                     |
| Something a feature needs installed (apps, CLIs, runtimes)                                                                              | `apps/server/src/setup/`, Nacre `SetupChecklist` + [ADR 0016](./docs/adr/0016-getting-what-a-feature-needs.md) — security-relevant                                                                                                                                                                                                                                                                                                                                        |
| Updates (Conch itself, the programs it uses, rollback)                                                                                  | `apps/server/src/updates/`, `apps/web/src/features/health/UpdatesSection.tsx`, Nacre `SoftwareUpdate` + [ADR 0019](./docs/adr/0019-updates.md), [ADR 0051](./docs/adr/0051-releases.md) — security-relevant                                                                                                                                                                                                                                                               |
| Releases: `pnpm release`, channels, signed tags, the staged swap and going back                                                         | `apps/server/src/release/`, `updates/{releases,layout}.ts`, `supervisor.ts`, `release/allowed_signers`, Nacre `ReleaseNotes`, `UpdateBanner`, `ReleaseChannelPicker` + [docs/RELEASING.md](./docs/RELEASING.md), [ADR 0051](./docs/adr/0051-releases.md) — security-relevant                                                                                                                                                                                              |
| Attachments (long pastes, files, pictures, drop, previews)                                                                              | `apps/server/src/attachments/`, `apps/web/src/features/chat/`, Nacre `Attachments` + [ADR 0017](./docs/adr/0017-attachments.md) — security-relevant                                                                                                                                                                                                                                                                                                                       |
| Passwords (the vault, other password managers, filling sign-ins)                                                                        | `apps/server/src/vault/`, `apps/web/src/features/passwords/`, Nacre `Passwords` + [ADR 0025](./docs/adr/0025-passwords.md), [§ Adding a password manager](#adding-a-password-manager) — security-relevant                                                                                                                                                                                                                                                                 |
| Backups (what's in one, the format, restore, automatic backups)                                                                         | `apps/server/src/backup/`, `apps/web/src/features/health/`, Nacre `Backups` + [ADR 0020](./docs/adr/0020-backups.md) — security-relevant                                                                                                                                                                                                                                                                                                                                  |
| Slack as an app for every model (the user token, `slack_*` tools, the connect dialog)                                                   | `apps/server/src/slack/` (`apps.ts` is its `HostedApps`), web `features/integrations/{SlackConnect,slackApi}.ts*` + [ADR 0049](./docs/adr/0049-every-app-works-with-every-model.md), [ADR 0052](./docs/adr/0052-one-app-one-card.md) — security-relevant                                                                                                                                                                                                                  |
| Channels — Apps → Talk to me here (Telegram, Discord, Slack, WhatsApp, Signal, iMessage, email, Teams, Matrix, WeChat), the public door | `apps/server/src/channels/` (`door.ts`), `apps/web/src/features/channels/`, Nacre `Channels` + [ADR 0018](./docs/adr/0018-channels.md), [ADR 0043](./docs/adr/0043-whatsapp-and-signal.md), [ADR 0044](./docs/adr/0044-imessage-and-email.md), [ADR 0045](./docs/adr/0045-teams-matrix-wechat.md), [ADR 0052](./docs/adr/0052-one-app-one-card.md), [ADR 0075](./docs/adr/0075-group-chats.md), [§ Adding a channel](#adding-a-channel) — security-relevant               |
| Your assistant looking through earlier chats (`search_chats`, `read_chat`, who may, taint, secrets)                                     | `apps/server/src/search/past.ts`, `search/index.ts` (`slice`), protocol `past-chats.ts` (`chats.looked`), web `features/chat/PastChatsItem.tsx`, Nacre `PastChats` + [ADR 0059](./docs/adr/0059-looking-through-earlier-chats.md) — security-relevant                                                                                                                                                                                                                     |
| What ⌘K can find by name                                                                                                                | `apps/web/src/features/palette/` (`findables.tsx`) — see working agreement 10                                                                                                                                                                                                                                                                                                                                                                                             |
| Repair everything (the whole-Conch checkup, Settings → Health)                                                                          | `apps/server/src/doctor/` (`checks.ts`), `apps/web/src/features/health/`, Nacre `RepairPanel` — see working agreement 12                                                                                                                                                                                                                                                                                                                                                  |
| What routines spend: each run's cost, one run's limit, the monthly limit, room on a plan                                                | `apps/server/src/routines/spend.ts` (`RoutineSpend`: `allow`, `record`), `usage/prices.ts`, `EngineEvent` `usage`, web `features/routines/SpendingSection.tsx`, Nacre `RoutineSpending` + [ADR 0057](./docs/adr/0057-routines-cant-run-up-a-bill.md) — a person changes the limits, never the agent                                                                                                                                                                       |
| Offline, usage limits, who answers a turn                                                                                               | `Services.route`, `apps/server/src/network/`, `ConversationManager` + [ADR 0023](./docs/adr/0023-offline-and-limits.md)                                                                                                                                                                                                                                                                                                                                                   |
| Models that can only chat (the picker's badge, the switch offer, routing that keeps apps)                                               | `packages/protocol/src/apps.ts` (`canUseApps`, `appsModel`), `providers/{apps,capabilities}.ts`, `conversations/manager.ts` (`turn.needs-apps`, `release`), web `features/chat/NeedsApps.tsx`, Nacre `ModelSwitchCard` + [ADR 0050](./docs/adr/0050-models-that-cannot-use-apps.md)                                                                                                                                                                                       |
| Tool calling on every model: forgiving arguments, precise errors, schemas per provider, tools in words for models without them          | `engines/tools/{args,repair}.ts` (every engine reads calls here), `engines/api/{toolplan,prompted,schemas,refusals}.ts`, `Wire.toolsFor`/`schemaFamily` + [ADR 0072](./docs/adr/0072-every-model-gets-its-tools.md) — security-relevant (untrusted arguments)                                                                                                                                                                                                             |
| Long chats: fitting each model's window, the summary line, `/compact`, learning before forgetting, healing "too long"                   | `engines/api/{context,session}.ts`, `Engine.context` (`engines/types.ts`), `conversations/manager.ts` (`compact`), `memory/tidy.ts` (`learn`), web `features/chat/{compact,bigger}.ts`, Nacre `SummaryDivider` + [ADR 0055](./docs/adr/0055-long-chats-on-every-model.md)                                                                                                                                                                                                 |
| Gmail, Google Calendar, Google Drive (apps, app passwords, Google sign-in)                                                              | `apps/server/src/google/` (`apps.ts`, `imap.ts`, `service.ts`), `channels/imap.ts`, web `features/integrations/GoogleAppConnect.tsx` + [ADR 0037](./docs/adr/0037-direct-google-accounts.md), [ADR 0040](./docs/adr/0040-google-setup-without-a-broker.md), [ADR 0048](./docs/adr/0048-google-apps-and-gmail-app-password.md) — security-relevant                                                                                                                         |
| Offering to connect an app from the chat (cues, the offer card)                                                                         | `apps/server/src/integrations/cues.ts`, `catalog.ts`, web `features/integrations/ChatBits.tsx` + [ADR 0021](./docs/adr/0021-connect-from-chat.md) — see working agreement 12                                                                                                                                                                                                                                                                                              |
| The chat knowing Conch: offers to turn on an app or skill, carrying on, `ask`, reply chips, plans, tool views                           | `apps/server/src/{offers,questions,replies,plans}/`, tool views (`HostToolResult.view`, `conversations/views.ts`, `google/views.ts`, `slack/views.ts`), protocol `chat-cards.ts`, web `features/{offers,questions,replies,plans}/`, `features/chat/ToolFound.tsx`, Nacre `Offer`, `QuestionCard`, `ReplyChips`, `PlanChecklist`, `ToolViews` + [ADR 0060](./docs/adr/0060-the-chat-knows-conch.md) — see working agreement 14                                             |
| Conch apps: what people make, share and add (the maker's tools, the sealed runtime, pages and the page kit, GitHub, the quality bar)    | `apps/server/src/conchapps/` (`service.ts`, `hosted.ts`, `tools.ts`, `guide.ts`, `check.ts`, `runtime.ts` + `runtime/host.mjs`, `fetcher.ts`, `sources.ts`, `publish.ts`), protocol `conch-apps.ts` + `conch-apps-words.ts`, web `features/conchapps/`, Nacre `ConchApps`, `pagekit/`, `SealedFrame` `onCall` + [ADR 0061](./docs/adr/0061-apps-you-make-share-and-add.md), [§ How Conch extends itself](#how-conch-extends-itself) — security-relevant                   |
| Always on, the installer, Conch as an app (`pnpm conch background`)                                                                     | `apps/server/src/background/`, `scripts/install.sh`, `scripts/install.ps1`, web `features/background/`, Nacre `AlwaysOn` + [ADR 0026](./docs/adr/0026-always-on.md) — security-relevant                                                                                                                                                                                                                                                                                   |
| The desktop app (Electron, what it carries, its window, tray and updates)                                                               | `apps/desktop/` (`src/{gateway,window,policy,environment,updater}.ts`, `scripts/{payload,dist}.mjs`), `apps/server/src/desktop/app.ts`, `updates/app.ts`, protocol `desktop.ts`, `.github/workflows/desktop.yml` + [ADR 0054](./docs/adr/0054-the-desktop-app.md) — security-relevant                                                                                                                                                                                     |
| The menu bar, a little computer (`pnpm conch tray`, `install.sh --server`)                                                              | `apps/server/src/background/{tray,tray-sources,little}.ts`, `security.ts` (`TRAY_API`), web `features/background/RunningOptions.tsx` + [ADR 0029](./docs/adr/0029-menu-bar-and-little-computer.md) — security-relevant                                                                                                                                                                                                                                                    |
| Phones: the secure address (Tailscale), the app (manifest, `sw.js`), notifications (Web Push), voice                                    | `apps/server/src/network/tailscale.ts`, `push/`, `voice/`, web `features/{phone,pwa,notifications,voice}/`, Nacre `Notifications`, `Voice` + [ADR 0027](./docs/adr/0027-in-your-pocket.md) — security-relevant                                                                                                                                                                                                                                                            |
| It learns you: meaning search, the tidy-up, memories that wait, skill suggestions, What Conch knows                                     | `apps/server/src/memory/{index,embed,concepts,ondevice,ondevice-runner,tidy,learning,routes,doctor}.ts`, `skills/suggest.ts`, web `features/memory/`, `features/skills/SkillSuggestions.tsx`, Nacre `Memory` (`MeaningSearch`) + [ADR 0032](./docs/adr/0032-it-learns-you.md), [ADR 0041](./docs/adr/0041-meaning-out-of-the-box.md) — security-relevant (untrusted chats, a downloaded model)                                                                            |
| Skills from what worked: Save how I did this, the tidy shelf, Off                                                                       | `apps/server/src/skills/{learn,usage}.ts`, `skills/service.ts` (`shelf`, `tidyShelf`), web `features/skills/{SkillOfferInChat,SkillShelfCard,SkillSuggestions}.tsx`, Nacre `SkillOffer`, `SkillShelf`, `SkillSuggestionCard` + [ADR 0058](./docs/adr/0058-skills-from-what-worked.md) — security-relevant (drafts from untrusted chats)                                                                                                                                   |
| Safe hands: the guard after reading, sealed commands, Activity, skills read first                                                       | `apps/server/src/conversations/{taint,sandbox}.ts`, `engines/claude-code/engine.ts` (PreToolUse), `activity/`, `skills/scan.ts`, web `features/{safety,activity}/`, Nacre `Safety`, `Activity`, `SkillReview` + [ADR 0028](./docs/adr/0028-safe-hands.md) — security-relevant                                                                                                                                                                                             |
| Skill trust: what a skill may do, signatures, trusted publishers, sealing per provider                                                  | `apps/server/src/skills/{permissions,signing,trust,cli}.ts`, `conversations/manager.ts` (`skillLimit`), `engines/codex/engine.ts` (`sealFor`), `conversations/safety-routes.ts` (`coverage`), web `features/skills/SkillTrust.tsx`, Nacre `SkillPermissionList`, `SkillSignatureBadge`, `TrustedPublisherList`, `SealCoverage` + [ADR 0031](./docs/adr/0031-skill-trust.md) — security-relevant                                                                           |
| Skill scope: a chat held to a skill's list until you stop it, the sealed signing key                                                    | `packages/protocol/src/holds.ts` (`skillHolds`), `conversations/manager.ts` (`stopHolding`, `addHolds`), `skills/{trust,doctor}.ts`, `lib/protect.ts` (`runsConchPower`), web `features/skills/ChatHolds.tsx`, Nacre `SkillHold` + [ADR 0047](./docs/adr/0047-skill-scope.md) — security-relevant                                                                                                                                                                         |
| Discover: skills people share (Anthropic, ClawHub, skills.sh), pinned, read before they're added, offered from the chat                 | `apps/server/src/skills/market/` (`types.ts` one `MarketSource` per place, `github.ts`/`clawhub.ts` check every byte against the pin, `service.ts` preview/install/updates, `tools.ts` `find_skills`), `offers/desk.ts` (`market`), protocol `skill-market.ts`, web `features/skills/{Discover,market}.ts*`, Nacre `Discover` (`MarketShelf`, `MarketSkillPreview`, `MarketTrustBadge`) + [ADR 0072](./docs/adr/0072-discover-skills-people-share.md) — security-relevant |
| Undo: putting back what the assistant changed in your files, Redo, forgetting a memory from Activity                                    | `apps/server/src/undo/`, `conversations/manager.ts` (the turn's tracker), web `features/undo/`, Nacre `Undo`, `ActivityTimeline` `action` + [ADR 0030](./docs/adr/0030-undo.md) — security-relevant                                                                                                                                                                                                                                                                       |
| Come home: bringing things from OpenClaw and Hermes (`pnpm conch import`)                                                               | `apps/server/src/import/` (`openclaw.ts`, `hermes.ts`, `read.ts`, `model.ts`, `service.ts`), web `features/import/`, Nacre `ComeHome` + [ADR 0035](./docs/adr/0035-come-home.md), [ADR 0042](./docs/adr/0042-come-home-the-rest.md) — security-relevant                                                                                                                                                                                                                   |
| Show me: things made beside the chat, sealed pages, pinned apps                                                                         | `apps/server/src/artifacts/` (`frame.ts` is the seal), web `features/artifacts/`, Nacre `Artifacts` (`SealedFrame`, `ArtifactPanel`, `ArtifactChart`) + [ADR 0034](./docs/adr/0034-show-me.md) — security-relevant                                                                                                                                                                                                                                                        |
| Editing what was made by hand, live data in pages                                                                                       | `apps/server/src/artifacts/live.ts` (the SSRF guard, OKs, limits), `service.ts` (`edit`, `draft`, `editedSection`), web `features/artifacts/{ArtifactEditing,live,edits}.ts*`, Nacre `CodeEditor`, `ArtifactEditor`, `LiveData*` + [ADR 0046](./docs/adr/0046-edit-by-hand-and-live-data.md) — security-relevant                                                                                                                                                          |
| Routines that start when something happens: the pulse, its sources (mail, calendar, page, folder, finished, another app), only-if       | `apps/server/src/routines/triggers/` (`pulse.ts`, one file per source, `brief.ts`, `doctor.ts`), `routines/service.ts` (`fire`), protocol `triggers.ts`, web `features/routines/{RoutineEditor,WhenStarters}.tsx`, Nacre `TriggerEditor`, `WatchStatus` + [ADR 0056](./docs/adr/0056-when-routines-and-the-pulse.md) — security-relevant (untrusted events, the public door, SSRF)                                                                                        |
| Hand it off: background tasks, helpers side by side (`delegate`), worktrees                                                             | `apps/server/src/tasks/`, web `features/tasks/`, Nacre `TaskCard` + [ADR 0033](./docs/adr/0033-hand-it-off.md) — a task has exactly its chat's powers (mode, guard, budget)                                                                                                                                                                                                                                                                                               |
| Other apps using Conch: the MCP door (`/mcp`), the launcher, pairing Claude Desktop / Cursor / VS Code, scopes                          | `apps/server/src/mcp/` (`endpoint.ts` the door and the handshake, `service.ts` what's offered and how a call runs, `call.ts` a call as a turn of the app's own chat, `pairing.ts`, `targets.ts` each app's settings file, `launcher.mjs`), protocol `mcp.ts`, web `features/otherapps/`, Nacre `OtherApps` + [ADR 0073](./docs/adr/0073-conch-for-your-other-apps.md) — security-relevant                                                                                 |
| Conch restarting itself, surviving a crash                                                                                              | `apps/server/src/supervisor.ts`, `lib/lifecycle.ts` (`restart()`), web `features/health/restart.ts`                                                                                                                                                                                                                                                                                                                                                                       |
| The documentation (guides, the reference read from the code, `pnpm docs:dev`)                                                           | `apps/docs/` (`content/README.md` for how to write a page), Nacre `Docs` patterns — see working agreement 13                                                                                                                                                                                                                                                                                                                                                              |
| The front page (the landing page at `/`: its scenes, its moving pictures, “Good to know”)                                               | `apps/docs/src/landing/` (`Landing.tsx`, `demos.tsx`, `useClock.ts`), Nacre `Site` patterns — see working agreement 13                                                                                                                                                                                                                                                                                                                                                    |
| Evals on real models (`pnpm eval`: tasks, the model matrix, fixtures, the scripted approver, the report, the nightly workflow)          | `apps/server/src/evals/` (`models.ts` the matrix, `tasks.ts` the tasks and checkers, `harness.ts`, `approver.ts`, `fixtures/`, `report.ts`), `.github/workflows/evals.yml` + [ADR 0071](./docs/adr/0071-evals-on-every-model.md) — spends money, never in `pnpm check`; the approver is security-relevant                                                                                                                                                                 |
| A decision that changes architecture or adds a dependency                                                                               | Write an ADR in [`docs/adr/`](./docs/adr/) first                                                                                                                                                                                                                                                                                                                                                                                                                          |
| This computer, proven: the key, the launchers' one-time links, `pnpm conch open`                                                        | `apps/server/src/auth/{here,here-routes,open-here}.ts`, `security.ts` (`looksLocal` describes the connection, `isLocal` is trust), the launchers (`background/{shortcut,tray-sources}.ts`, `scripts/install.*`, `apps/desktop/src/here.ts`), web `features/auth/` (`#here=`) + [ADR 0063](./docs/adr/0063-this-computer-is-proven.md) — security-relevant                                                                                                                 |
| Devices, approving new ones (`conch devices`), and from your own devices                                                                | `apps/server/src/auth/` (`store.ts`, `devicesCli.ts`), `security.ts`, web `features/auth/`, Nacre `DeviceApproval` + [ADR 0024](./docs/adr/0024-approve-new-devices.md), [ADR 0065](./docs/adr/0065-passkeys-and-approving-from-your-devices.md) — security-relevant                                                                                                                                                                                                      |
| Passkeys (Touch ID, Windows Hello, Face ID) and the hello link that makes a new Conch yours                                             | `apps/server/src/auth/` (`passkeys.ts` the ceremonies, `aaguids.ts`, `store.ts` passkeys and `claim`, `routes.ts`), `test/authenticator.ts` (a pretend authenticator), web `features/auth/` (`passkey.ts`, `HelloScreen.tsx`, `SignIn.tsx`, `useVerify.tsx`), Nacre `PasskeyButton`, `MakeItYours`, `PasskeyList` + [ADR 0065](./docs/adr/0065-passkeys-and-approving-from-your-devices.md), [ADR 0064](./docs/adr/0064-your-own-address.md) — security-relevant          |
| Your own address: HTTPS by Conch itself, ACME, ports 80 and 443, the door at `/conch`                                                   | `apps/server/src/address/` (`acme.ts`, `listeners.ts`, `service.ts`, `dns.ts`, `reach.ts`, `runtime.ts`, `routes.ts`, `doctor.ts`, `pebble.test.ts` against a real ACME server), protocol `address.ts`, web `features/auth/AddressSection.tsx`, Nacre `AddressStatus` + [ADR 0064](./docs/adr/0064-your-own-address.md) — security-relevant                                                                                                                               |
| The command line: `conch setup`, its look (the pearl), its voice, the `conch` command on PATH                                           | `apps/server/src/cli/` (`ui.ts`, `pearl.ts`, `prompts.ts`, `words.ts` the voice, `command.ts`, `setup.ts`), `cli.ts`, `cliCommands.ts`, `scripts/install.{sh,ps1}`. Every message goes through the kit; tell people `cliName()`, never a typed `pnpm conch`                                                                                                                                                                                                               |
| Security, auth, exposing the gateway beyond localhost                                                                                   | [§ Security engineering](#security-engineering) below → [ARCHITECTURE.md § Security](./ARCHITECTURE.md#security-model) → [ADR 0008](./docs/adr/0008-access-and-hardening.md) — treat as high-risk                                                                                                                                                                                                                                                                         |

**Rule of thumb:** UI goes in Nacre _first_. If an app screen needs a visual element
that doesn't exist, build it as a Nacre primitive or pattern (with a story), then use
it. Apps must not contain bespoke styling beyond layout.

## Repo map

```
apps/
  web/            React 19 + Vite SPA (the chat UI)
  server/         Node gateway: HTTP + WebSocket, wraps @anthropic-ai/claude-agent-sdk
  docs/           The site: the front page, guides in Markdown, reference read from the code
  desktop/        The Electron app: Conch, Node and a window, for macOS, Windows and Linux
packages/
  nacre/          Design system: tokens, Lustre material, components, patterns, Storybook
  protocol/       Zod schemas + types for every message on the wire
  eslint-config/  Shared flat ESLint configs (base, react)
  tsconfig/       Shared tsconfig bases
docs/             Guides and records kept beside the code; each is a page of apps/docs too
  design/         Design language (NACRE.md)
  adr/            Architecture decision records
scripts/          Repo tooling (e.g. snap.mjs visual QA screenshots)
```

## Commands

Run from the repo root unless noted. Node ≥ 24, pnpm 12 (`corepack enable` or `npm i -g pnpm`).

| Command                                                                       | What it does                                                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                                | Install everything                                                                                                                                                    |
| `pnpm dev`                                                                    | Run all dev servers via Turbo                                                                                                                                         |
| `pnpm storybook`                                                              | Nacre Storybook on http://localhost:6006                                                                                                                              |
| `pnpm docs:dev`                                                               | The site on http://localhost:4400 (the front page at `/`, the documentation at `/docs`), redrawn as you write and as the code it reads changes                        |
| `pnpm docs:build`                                                             | The site as static files in `apps/docs/dist`, every page drawn ahead of time for search; `site.yml` publishes it to conchagent.com (`pnpm docs:preview` opens it)     |
| `pnpm check`                                                                  | Format check + lint + typecheck + tests. **Must pass before every commit.**                                                                                           |
| `pnpm test`                                                                   | All unit tests (Vitest)                                                                                                                                               |
| `pnpm e2e`                                                                    | Builds the web app and runs Playwright journeys against the gateway + mock engine                                                                                     |
| `pnpm eval [--smoke] [--models a,b] [--tasks x,y] [--list]`                   | The eval tasks on real models, side by side, compared with the last run (`.evals/report.html`). Only models whose keys are in the environment; costs money (ADR 0071) |
| `pnpm dev:mock`                                                               | Dev servers with the scripted mock engine (no Claude usage)                                                                                                           |
| `pnpm start`                                                                  | Build and run Conch for real at http://localhost:4317                                                                                                                 |
| `pnpm start:network`                                                          | Same, reachable from your network (sign-in required; prefer Tailscale)                                                                                                |
| `pnpm desktop:dev`                                                            | The desktop app on the repository: Vite's hot reload, the gateway restarted on change                                                                                 |
| `pnpm desktop:start`                                                          | Builds the web app, the app's code and what it carries, then opens the app as it ships                                                                                |
| `pnpm desktop:build`                                                          | This computer's installers in `apps/desktop/out` (`:mac`, `:win`, `:linux` on that system; CI builds them all)                                                        |
| `pnpm desktop:e2e`                                                            | Builds the app as it ships (unpackaged) and drives it with Playwright: window, tray, crash, quit                                                                      |
| `conch <command>` (`pnpm conch` here)                                         | From the terminal: `setup`, `hello`, `address`, `status`, `passkeys`, `devices`, `background` … (`conch help`)                                                        |
| `pnpm release [beta\|alpha] [--dry-run]`                                      | Make a release: version and notes from the commits, one question, then check, tag (signed), push ([docs/RELEASING.md](./docs/RELEASING.md)). Maintainers only.        |
| `pnpm --filter @conch/nacre test -- src/components/Button`                    | Tests for one component                                                                                                                                               |
| `pnpm a11y [--filter=button]`                                                 | axe (incl. colour contrast) on every story, light + dark, in real Chrome (Storybook must be running)                                                                  |
| `node scripts/snap.mjs <story-id> [--mode=dark] [--hover=css] [--clip=css]`   | Screenshot a story for visual QA (Storybook must be running)                                                                                                          |
| `node apps/docs/scripts/shot.mjs <page> [--mode=dark] [--width=390] [--full]` | Screenshot a page for visual QA: `home` is the front page, `--still` is reduced motion (`pnpm docs:dev` must be running)                                              |
| `node apps/docs/scripts/a11y.mjs [--filter=providers]`                        | axe (incl. colour contrast) on the front page and every documentation page, light + dark, in real Chrome (`pnpm docs:dev` must be running)                            |

## Working agreements

1. **Verify, don't assume.** Run the relevant tests/typecheck/lint after every change.
   For UI changes, also screenshot the affected stories in light _and_ dark mode with
   `scripts/snap.mjs` and look at them.
2. **Small, conventional commits** (`feat(nacre): …`, `fix(server): …`, `docs: …`,
   `chore: …`). One logical change per commit. Never push unless asked. A commit's
   author is whoever `git config` names; never add `Co-Authored-By`, "Generated with"
   or any other attribution lines to commits or pull requests.
3. **Dependencies are decisions.** Prefer what's already installed. New runtime deps
   need a line of justification in the commit message; significant ones need an ADR.
   pnpm enforces a minimum release age — don't bypass it.
4. **Types are the contract.** `strict` + `noUncheckedIndexedAccess`. No `any`; use
   `unknown` + narrowing. Anything crossing the network is validated with Zod from
   `@conch/protocol` on _both_ sides.
5. **Accessibility is not optional.** `jsx-a11y` strict is on and never disabled.
   Every interactive component has keyboard support, visible focus, and an axe test.
6. **No secrets in code or logs.** Config comes from env (`apps/server/.env.example` documents it).
   A fake key in a test or a pretend app is written in two parts (`'xoxb-' + '…'`), so secret
   scanners and GitHub's push protection never take it for a real one.
7. **Inclusive language** in code, comments and docs (primary/replica, allowlist/denylist).
8. **Don't edit generated or vendored files** (`pnpm-lock.yaml` by hand, `dist/`,
   `storybook-static/`).
9. **Design for every provider, not just Claude Code.** Conch drives several
   engines at once (Claude Code, Codex, Copilot, Gemini CLI and Grok through their
   own programs; Ollama, LM Studio and servers of your own; a dozen key-based APIs
   — `engines/registry.ts` has them all), and one conversation can move between them. Every feature must
   work for all of them, or degrade on purpose:
   - Never assume one active engine. The engine for a turn is the conversation's
     (`TurnOptions.engine`); the default provider only decides where new chats
     start. Ask `providers.engineFor(id)` or `providers.ready()`, not `engine()`.
   - What the user sets up — integrations, skills, memory, routines — belongs to
     Conch and reaches every provider. Nothing in the app gallery may depend on a
     provider (ADR 0049, `catalog.test.ts`). What a provider brings by itself is
     brought into Conch when Conch can connect it; the rest is shown apart
     (Settings → Providers), and says it only works with that provider.
   - Put engine-specific behaviour behind the `Engine` interface
     (`apps/server/src/engines/types.ts`), as a declared capability. Features ask
     the engine what it can do (e.g. `engine.integrations.mode`, `usage?`,
     `complete?`); they never check which engine it is.
   - Keep the protocol and UI generic. Use the engine's `label` and the
     assistant's name (`persona.name`), never a hard-coded "Claude" or "Claude
     Code" in product copy (a few older screens still do: fix them when you
     touch them). Give things generic names (`account` connectors, not
     `claude-ai`).
   - When an engine lacks a capability, Conch fills the gap where it reasonably
     can (e.g. the MCP bridge for engines without MCP) or hides the feature with
     an explanation. It never breaks.
   - The mock engine is the second provider: it takes the other path where one
     exists (it's a "bridge" engine for integrations), so both paths are tested.
10. **If a person can find it by name, ⌘K finds it.** The palette is the one box
    for everything: chats and messages, and every other thing a person can open,
    use or change by name — skills, models from every provider, integrations,
    routines, pages, settings sections and actions. When you add a new kind of
    thing or a new page, register it in `apps/web/src/features/palette/findables.tsx`
    (with the words people would type) in the same change, and extend
    `Palette.test.tsx`. Choosing it does the obvious thing: open it, or use it
    right there (a skill goes into the composer, a model applies to the chat).
11. **Fix it before you ask.** Conch is for people who don't debug. When something
    is missing, stale or broken, Conch repairs it itself and carries on. The person
    is asked only for approvals that matter, or for what only they can do. Proactive,
    never intrusive:
    - **Heal first.** Handle every failure you can foresee, in code, without asking:
      - Install what's missing (with progress) and fall back to the next good
        option.
      - Clear stale locks and orphaned processes.
      - Relaunch what crashed and restore where it was.
      - Retry flaky networks lighter and with backoff.
      - Refresh expired tokens.

      The browser (ADR 0014) is the reference: it finds a browser or downloads
      one, clears a dead profile lock, falls back from Chrome to Edge to
      Chromium, relaunches after a crash and reopens each chat's page, and
      declines cookie banners.

    - **Offer to get what's missing.** When a feature needs something outside Conch
      (an app, a CLI, a runtime), don't report it missing. Declare it as a _need_
      (`apps/server/src/setup/known.ts`, ADR 0016), and the UI turns it into one
      button:
      - **Find it where it really lives** before saying it's missing: `PATH` as the
        OS sees it (Windows app aliases in `WindowsApps` fail `existsSync`; use
        `presentSync`/`findExecutable`), macOS app bundles, the folders installers
        use. Run what you found by its full path.
      - **Install it for them** when a package manager can do it without an
        administrator (winget, Homebrew, npm into a user prefix). Offer it as
        “Install X”, show the exact command, show progress, then carry on to the
        thing they asked for. No second press.
      - **Link to it** when only a person can install it (`sudo`, an app store,
        a licence). Then watch: poll while missing, and look again on window focus.
      - **Point at the switch** when it's installed but turned off in another app:
        name the setting, offer “Open <app>”, and check again when they come back.
      - A card says what's missing in a few words (“Needs the 1Password app.”) with
        **Finish setup**, never a program name and **Try again**.
      - The pieces: a status or health carries `fix: {need, kind}` / `need`, the web
        shows `<GetIt needId=…>` (features/setup), and `Services.needLanded` re-checks
        whatever was waiting when an install lands.
    - **Retry what passes by itself.** A failure that usually clears (a server
      restarting, a blip offline, an expired token) is retried with backoff and a
      renewal, not handed to the person as “Try again”. Only ask when the fix
      really is theirs (a revoked sign-in). A chat whose provider failed offers
      the next best thing — sign in (then resend by itself), another provider that
      is ready, or opening 1Password — from the turn's `problem`.
    - **Say what you fixed, quietly.** Record each repair with
      `services.healed.note(area, message)`: one plain sentence, shown under
      Settings → Health → “Fixed on its own” as reassurance, never as an error
      or a toast that demands attention.
    - **Ask only what matters.**
      - Ask about spending, sending, publishing or deleting; about changes that
        grant trust or reach; and about credentials, which the person types
        themselves and the agent never sees.
      - Ask for things only a person can do: sign in, solve a captcha, run a
        command as administrator.
      - Ask once, in the flow, in plain words, with one obvious button. Never
        ask something Conch could have worked out or fixed itself.
    - **Never a dead end.** Every problem state says what happened in one sentence
      and offers one next step: Repair, Try again or Open settings. When only the
      person can do it (a system library on Linux), show the exact command to
      copy. A subsystem with state exposes its health and a single **Repair**
      that tries every fix in turn. The destructive fix (wiping a profile) comes
      last, and only after confirmation.
    - **Errors are for the agent too.** Tool errors say what happened and what to
      try next, in words a model can act on ("something is covering that button;
      close the dialog first"). The agent's prompt tells it to try once more
      another way before it tells the person.
    - **Test the healing, not just the happy path.** Every self-repair gets a test:
      the stale lock, the crash, the fallback, the retry.

12. **Every new part joins the features that cover all of Conch.** Some features
    are about everything Conch is: **Repair everything** looks at every part,
    **backups** carry every file you’d miss, **updates** watch every program
    Conch relies on, **connect-from-chat** knows every app in the catalog, and
    **offline and limits** route around every provider. They only stay whole if
    each new part plugs itself in — in the same change, without being asked:

    | You’re adding…                                                                                                                 | Also, in the same change                                                                                                                                                                                                                                                                                                                                                                                        |
    | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | Anything with state that can go wrong (a service, a connection, a store, a daemon)                                             | A `DoctorCheck` in `apps/server/src/doctor/checks.ts` (`registerCoreChecks`), or the subsystem's own `doctor.ts` registered from `Services`. With `repair: false` it only looks; with `repair: true` it applies the safe fixes and says `fixed`. What only a person can do is `needs-you` with one `action` (`open` a settings place, `need` to install, or a `command` to copy). Tested like `checks.test.ts`. |
    | A file or folder under `CONCH_HOME`                                                                                            | A rule in `apps/server/src/backup/manifest.ts` (ADR 0020): `kept` (with its group), `secret` (only in a passphrase-locked backup), `derived` (rebuilt, never backed up) or `outside`. `manifest.test.ts` fails on any file no rule covers.                                                                                                                                                                      |
    | A setting that lets Conch act without asking, or lets someone else reach it (a trust level, a bot's people, a program it runs) | A line in `apps/server/src/backup/powers.ts` (and a `BackupPower` kind): a restore preview names it, so an old or someone else's backup can't quietly bring it back.                                                                                                                                                                                                                                            |
    | A program, app or runtime Conch runs or relies on                                                                              | A need in `apps/server/src/setup/known.ts` (ADR 0016) with `version` (how to read the installed one), `latest` (where the newest is announced) and its `update` recipe — `updatable({ winget, brew, npm })` gives all three. Updates (ADR 0019) then watches it and offers the one-click update; `latest.test.ts` fails on a need that can update but can't say its versions.                                   |
    | An app in the integrations catalog                                                                                             | Its `cues` in `integrations/catalog.ts` (ADR 0021; the type requires them): the precise phrases that only mean that app, and the ones that mean something else, with rows in `cues.test.ts`. A false offer is worse than none; `{ match: [] }` is allowed and honest.                                                                                                                                           |
    | A provider                                                                                                                     | `Engine.local = true` if it runs on this computer (offline answers: ADR 0023, and ADR 0022 for how Ollama does it). Its failures classified as a `TurnProblem` (`limit`, `unavailable`, `signed-out`…) so a limit or an outage routes to your fallback instead of a dead end. Its readiness shows in `providersCheck`.                                                                                          |
    | A failure another provider could answer                                                                                        | `ConversationManager.#answer`'s retry condition and `Services.route` (ADR 0023). Not a failure the person must fix (`signed-out`, `key-locked`): that keeps its own card.                                                                                                                                                                                                                                       |
    | Something a person can open or do by name                                                                                      | Working agreement 10 (⌘K).                                                                                                                                                                                                                                                                                                                                                                                      |
    | A new power for Conch apps (something `app.*` can do, or a page can ask for)                                                   | Its words in `appAbilities` (`conch-apps-words.ts`), so every card says it; a rule in `conchapps/check.ts`; its section in the maker's guide (`conchapps/guide.ts`); and, if it lets an app act without asking or reach further, a line in `backup/powers.ts`. See [§ How Conch extends itself](#how-conch-extends-itself).                                                                                     |

    Three of these are enforced by tests that fail with the fix in their message
    (`backup/manifest.test.ts` — whose session really uses every store, so extend
    `test/session.ts` when you add one — `updates/latest.test.ts`, and the catalog's
    type for `cues`); the rest are on you. If a new part fits no row but is still something
    you’d want back on a new computer, or would want to know is broken, it belongs
    in one of these features: extend the feature (and this table) rather than
    leave the part out.

13. **The documentation moves with the code.** `apps/docs` is what people read to
    use Conch (`pnpm docs:dev`). A change that makes a page untrue fixes the page
    in the same change, without being asked. Two rules keep that cheap:
    - **What the code can list is never typed.** Providers, channels, the app
      gallery, `pnpm conch` commands, environment variables, permission modes,
      slash commands, the files under `CONCH_HOME`, the programs Conch installs,
      the HTTP routes and the socket's messages are read from the code every time
      the documentation starts, builds or is tested
      (`apps/docs/reference/build.ts` → `virtual:conch-reference`). The page shows
      the words the code already has, so write them well where the thing is
      defined. To show something new, read it in `reference/build.ts` (shape in
      `types.ts`), draw it as an embed in `apps/docs/src/embeds/`, and ask for it
      from a page with `<!-- conch:name -->`. Never copy a list into Markdown.
    - **What only a person can explain is a guide.** Markdown in
      `apps/docs/content/<section>/`: a file is a page, and nothing else is listed
      by hand. Format and voice are in `apps/docs/content/README.md` (short
      sentences, the app's own button names, nothing that can be taken out).
      `docs/SECURITY.md`, `BROWSER.md`, `TERMINAL.md`, `REVERSE_PROXY.md`,
      `ARCHITECTURE.md`, `docs/design/NACRE.md` and every ADR are pages too, shown
      from where they are: editing one is editing the documentation.
    - **The front page says only what’s true.** `/` is the first thing anyone
      sees of Conch (`apps/docs/src/landing/`). Its pictures are the app’s own
      Nacre components playing a short script (`demos.tsx`), so a picture can’t
      show a screen Conch doesn’t have. Its numbers and names come from
      `virtual:conch-reference`. It claims nothing Conch can’t show: no users,
      no stars, no comparisons, nothing that’s “coming”. It doesn’t run Conch
      down either: nothing about who made it or how few use it, no apologies.
      What someone should know before installing is in “Good to know”, three
      tiles at most. A picture that plays never changes size (Nacre `Steady`),
      so nothing under it moves.
    - **Every page is found by search.** The site is drawn ahead of time and
      published at conchagent.com (`SITE_URL`); each page's title and
      `description` become what a search result and a shared link show
      (`src/site/head.ts`). Give a new page a `description` of one sentence, at
      most 160 characters, and a title no other page has:
      `src/site/head.test.ts` fails otherwise.

    | You’re adding or changing…                                                                                            | The documentation, in the same change                                                                                                                                                                                                                                                                                         |
    | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | A provider                                                                                                            | Its card, facts and row in the comparison appear by themselves (`providers/catalog.ts`, and what the engine declares). Write `content/providers/<id>.md` (front matter `provider: <id>`): how to connect it, what it brings, what to know first.                                                                              |
    | A channel                                                                                                             | Its tile and facts appear by themselves (`channels/catalog.ts`). Write `content/channels/<id>.md` (`channel: <id>`) with the steps, and draw the other app with Nacre `Handset` / `PortalSketch` in `src/embeds/channels.tsx`.                                                                                                |
    | An app in the catalog, a password manager, a file under `CONCH_HOME`, a program Conch runs, a route, a socket message | Nothing more than the code needs: the gallery, the lists and the reference read `integrations/catalog.ts`, `VaultSourceId`, the manifest rule’s `why`, the need, the routes and the protocol schemas.                                                                                                                         |
    | A `conch` command or subcommand                                                                                       | Its row in `apps/server/src/cliCommands.ts` (`summary`, `detail`). `cli.ts` doesn’t compile without it; help and the reference both read it. It speaks through `cli/ui.ts` in the voice of `cli/words.ts`, and if it changes who may sign in or where Conch is reached, `lib/protect.ts` keeps it from the assistant's shell. |
    | An environment variable                                                                                               | Its words in `ENV_ABOUT` (`apps/server/src/config.ts`), which doesn’t compile without them.                                                                                                                                                                                                                                   |
    | A slash command, a permission mode, a thinking level                                                                  | Its words where it’s defined (`apps/web/src/features/commands/slash.ts`, `features/models/words.ts`).                                                                                                                                                                                                                         |
    | A keyboard shortcut (`useHotkey`)                                                                                     | A row in `content/reference/keyboard.md`.                                                                                                                                                                                                                                                                                     |
    | A feature, or anything a person sees or does differently (a button’s name, a default, a limit, a new step)            | Its guide in `content/features/` or `content/care/`, or a new one; and the line about it in README “What it does”.                                                                                                                                                                                                            |
    | A headline feature (what you’d show a friend first), or something to know first                                       | A scene or a tile on the front page (`apps/docs/src/landing/Landing.tsx`), its picture made of the app’s own components in `demos.tsx`. What to know first goes in “Good to know”.                                                                                                                                            |
    | Something Conch apps can do, or the app format                                                                        | `content/features/make-apps.md`, and the maker's guide the assistant reads (`conchapps/guide.ts`), in the same change: `guide.test.ts` fails when the guide leaves out something the runtime offers or a class the page kit has.                                                                                              |
    | Something the pages can’t draw yet                                                                                    | A Nacre pattern first (`packages/nacre/src/patterns/Docs/`, or `Site/` for the front page, with its story and test), then an embed.                                                                                                                                                                                           |

    `apps/docs/src/content.test.ts` runs in `pnpm check` and fails with the fix in
    its message when a provider or channel has no guide, a link or a heading it
    points at doesn’t exist, a page asks for a part that isn’t there, a command or
    setting has no words, or the app listens for a key the keyboard page doesn’t
    list. `src/landing/Landing.test.tsx` fails when the front page types a
    count, leaves out a provider, channel or app, boasts, or links nowhere. The
    rest is on you: read the page you changed (`pnpm docs:dev`), look
    at it in light and dark with `apps/docs/scripts/shot.mjs`, and run
    `apps/docs/scripts/a11y.mjs` when you changed how pages are drawn.

14. **The chat shows what Conch can do.** The chat is where people spend their
    effort, so every part of Conch should be reachable from it without leaving it
    (ADR 0060). When you add or change something, make it part of the chat in the
    same change:

    | You’re adding…                                                                                              | Also, in the same change                                                                                                                                                                                                                                        |
    | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | Something a person turns on, connects or sets up before the assistant can use it                            | Its line in the map (`offers/map.ts`) and an `OfferKind` (or a branch of one) in `OfferDesk`, with the card's words and what “on” means for **carrying on**. The assistant can then offer it where it’s needed, and the chat carries on by itself once it’s on. |
    | A tool whose results a person would rather see than read (events, messages, files, people, places, numbers) | A `ToolView` kind in `@conch/protocol` `chat-cards.ts`, its Nacre view (stories, axe), and `view` on the tool’s `HostToolResult`. The model still gets the text.                                                                                                |
    | A step where the assistant needs the person’s choice                                                        | The `ask` tool with the right field kinds, never a numbered list in prose. A new kind of answer (a place, a person, a file) is a new `QuestionField` kind with its own control.                                                                                 |
    | Something the person would often do next after a kind of reply                                              | A rule in `replies/conch.ts` (Conch’s own chips), when it can be read from the reply itself.                                                                                                                                                                    |
    | A new card in the transcript                                                                                | It obeys the chat's manners: at most one thing asking for attention per turn, nothing for nobody (unattended runs), nothing driven by untrusted content, the words on a button are what it does, and it folds to a quiet line once it's done.                   |

    Ask “could the chat have done this for them?” of every feature. If the honest answer
    is “yes, if it knew”, tell it (the map) and give it the card.

15. **Conch grows by apps, not only by code.** Conch is built to extend itself
    (ADR 0061): a person who needs something it can't do asks, and the assistant
    makes a Conch app, checked, sealed and offered as a card. Keep that path the
    best way to get a new ability:
    - **Ask "could a Conch app do this?"** of every narrow feature request (one
      service, one person's routine, one site). If yes, it belongs in an app, not
      in Conch's core. If an app _almost_ could, but the platform lacks a power it
      needs, extend the platform ([§ How Conch extends itself](#how-conch-extends-itself))
      rather than hard-coding the one feature.
    - **What Conch makes meets Conch's bar.** That bar lives in code, not in hope:
      the quality gate (`conchapps/check.ts`), the page kit (Nacre `pagekit/`,
      generated into the gateway by `pnpm pagekit`), the starter
      (`conchapps/starter.ts`) and the maker's guide (`conchapps/guide.ts`). When a
      house rule changes (a token, an accessibility rule, the voice, a new Nacre
      look), change them in the same change, so every app made after it is held
      to the new rule.
    - **The assistant knows what it can extend.** A new part of Conch an app could
      use is a power in the runtime, with words a person reads on the card; never
      a way around the seal.

## Adding a provider

Most companies speak OpenAI's chat format; adding one is rows, not code
([ADR 0053](./docs/adr/0053-more-providers.md)):

1. **The engine.** A `ChatPreset` in `apps/server/src/engines/api/presets.ts`:
   its endpoints (several for a company with regions, tried in order), where its
   key comes from, how to read its model list, and what to say about its errors.
   Add the id to `BuiltInEngineId` (`packages/protocol/src/common.ts`) and to
   `builtInEngines` in `engines/registry.ts`. A program that speaks ACP is a row in
   `engines/acp/agents.ts` instead, plus its need in `setup/known.ts`.
2. **The words.** Its `ProviderCopy` in `providers/catalog.ts`: group, tagline,
   description, highlights, an honest `free` note, the `envKeys` Conch may find,
   and `keyForm.recognise`. Only a prefix that is the company's own mark is
   `distinct`; any other shape is `loose`, so Conch asks before sending a key
   there. Never try a key at several companies to see which one takes it.
3. **The mark.** Its logo in Nacre `patterns/Integrations/brands.ts` and
   `patterns/ModelPicker/ProviderLogo.tsx`.
4. **Whole Conch.** Its key in Come home (`import/{openclaw,hermes}.ts`) if those
   agents know it. Its `TurnProblem`s come from `mapChatError`, so a limit or an
   outage routes to the fallback with nothing more to write.
5. **Docs.** `apps/docs/content/providers/<id>.md` with `provider: <id>`: where to
   get a key, what's free, what to know. `content.test.ts` fails until it exists.

Test it with a fake fetch like `openai.test.ts`: models listed and tidied, a
streamed answer with reasoning and a tool call, and each error it can give.

## Security engineering

Conch can answer at an address of its own, over HTTPS it terminates itself ([ADR 0064](./docs/adr/0064-your-own-address.md)): the listeners hand every request to the gateway, so its guards apply unchanged. Through a tunnel or web server the person already runs, the same address has `via: 'proxy'` ([ADR 0067](./docs/adr/0067-your-address-through-a-tunnel.md)): no listeners, the name allowed, and the way in checked through it. Follow [docs/REVERSE_PROXY.md](./docs/REVERSE_PROXY.md).
Keep deployment hostnames in configuration, preserve Host/Origin for HTTP and WS,
and serve built assets through the gateway so document security headers apply.

Conch runs commands **as the user**, and a prompt-injected agent is part of the
threat model. Hold every change to the bar of a thorough professional security review:

1. **Research before you build.** For anything touching auth, sessions, crypto,
   parsing untrusted input, the agent's powers, or network exposure, read the
   current primary sources first:
   - OWASP ASVS 5.0 and the OWASP Cheat Sheets (Authentication, Session
     Management, Password Storage, CSRF, CSP);
   - NIST SP 800-63B-4;
   - the Fetch Metadata / resource-isolation guidance;
   - recent academic work on LLM agents, for example indirect prompt injection
     (Greshake et al., 2023), markdown/image exfiltration and tool-use escalation.

   Cite what you followed in the commit message or ADR. When the sources disagree
   or have moved on, follow the newest standard and say so.

2. **Threat-model the change.** Ask who can reach it: a web page, another
   localhost port, the LAN, a proxy, another OS user, or the agent itself.
   Loopback alone is not trust (proxies), looking local is not trust either (nginx's
   defaults, other accounts: ask `Gatekeeper.isLocal`, which needs proof, ADR 0063),
   hostname alone is not origin (ports), and the agent's own tool calls are untrusted input.
3. **Never roll your own crypto.** Use `node:crypto` (CSPRNG, scrypt,
   `timingSafeEqual`) and reuse `apps/server/src/auth/secrets.ts`. Store hashes of
   secrets, never the secrets. Compare in constant time.
4. **Secure by default, safe to misconfigure.** New features start locked down.
   An unsafe choice must be explicit, explained in plain words, and surfaced by the
   security checkup (`auth/checkup.ts`). Add a check whenever you add a risky
   option.
5. **Secrets never travel in URLs** (fragments only for one-time codes), logs,
   error messages, the agent's environment, or responses after creation. Show a
   secret once.
6. **Validate at every edge.** Zod on both sides, `Id`/`CommandName` for anything
   that becomes a path, and `safeJoin` for every file path.
7. **The agent can't raise its own privileges.** Anything that grants trust,
   enables automation, or persists permissions needs a human action in the UI.
   Checks that must hold in every permission mode (protected paths, tools
   turned off, the guard after reading) go in `TurnInput.guard` — Claude
   Code's PreToolUse hook — never only in `canUseTool`, which the SDK skips
   when a mode allows by itself (ADR 0028). A new tool that brings outside
   content in taints the chat (`conversations/taint.ts` `taintFrom`); one that
   can send things out or change the computer is a sink (`sinkReason`).
   A chat is held to what each skill in it says it needs the same way, in
   every later turn (`skills/permissions.ts` `needs`/`allows`, ADR 0031,
   ADR 0047): a new tool that can do harm needs a capability in `needs()`,
   and nothing but a person's action ends a hold. Trusting a skill publisher is a
   lasting power: sudo mode, and the key comes from a signature that held.
8. **What the assistant makes is sealed.** A page it wrote runs only in
   `SealedFrame` from `/api/artifacts/…/frame` (opaque origin, no network, no way
   out — ADR 0034); everything else is drawn by Conch, never as HTML. Don't add
   `allow-same-origin`, popups or a network source to either. A page's live data
   goes through `artifacts/live.ts` only (ADR 0046): never `fetch` for a page any
   other way, and never let a page choose a host.
9. **Test the attack, not just the feature.** Add regression tests for each abuse
   case (traversal, cross-origin, replay, brute force, escalation). See
   `apps/server/src/auth/auth.test.ts` and `e2e/security.spec.ts`.
10. **Warn people in their words.** Every security message says what could happen
    and what to do next, never jargon alone.

## Secrets in a new feature

A feature that needs a key or a password never keeps it in its own file in the
clear (ADR 0025):

- **A key Conch itself uses** (a provider, an integration, a channel) goes in
  one of the sealed key files (`lib/sealed.ts` `SEALED_FILES`; add yours
  there and to the backup manifest as `secret`), and is listed in
  `Services.#systemKeys` so it shows in Passwords.
- **A secret the person owns** (a login, a card, a note) lives in Passwords.
  The agent reaches it only through `passwords_find`, `passwords_request`,
  `passwords_read` and the browser fill.
- Add any new place secrets live to `lib/protect.ts`, so the agent's own
  file tools can't touch it.

## Adding a password manager

Passwords shows Conch's own vault and the password managers people already use,
as one list (ADR 0025). A new one must play by the same rules as 1Password,
Bitwarden, KeePassXC, Proton Pass, Dashlane, Keeper and the macOS Keychain:

1. **A `PasswordSource`** in `apps/server/src/vault/sources.ts`, registered in
   `VaultService`, with an id added to `VaultSourceId` and its id prefix in
   `PREFIXES` (`service.ts`):
   - `state()` is cheap and never prompts anybody.
   - `list()` carries **no secret values**: names, accounts, sites, kinds and
     where an item sits in its own app. If the program's list includes
     passwords (Bitwarden's does), drop them while mapping.
   - `fields()` describes fields, with values only for fields that aren't
     concealed.
   - `value()` and `totp()` fetch one value for one use. It's never cached
     beyond the call, and never written anywhere. When a manager hands over
     a code's setup rather than the code, compute the code in the gateway
     (`totpNow`) instead of putting the setup anywhere.
   - `full()` (optional, for Moving in) reads every value of one item in one
     call, passkeys included when the program has their private keys. Run
     everything through `toPasskey`, which keeps only real ES256 keys.
   - A program that would stop at a prompt gets `input: ''`, so it fails in
     words instead of hanging. One that asks the person something itself
     (1Password's approval, Touch ID, the keychain's dialog) goes in `PROMPTS`,
     so it's only read, and its copies only sync, while someone's looking at
     Passwords (`GET /api/vault?look=1`). Everything else that lists Passwords
     (the sidebar, Apps, ⌘K) gets what it showed last, and never raises a
     prompt in another app.
2. **Through its own program and its own unlock.**
   - The program is a need (ADR 0016) in `setup/known.ts`, so Conch can find,
     install or link to it.
   - A master password or session key goes on stdin or in the program's own
     environment variable, **never as an argument**, and is kept in memory
     only.
   - The `Exec` seam lets a test pretend to be the program.
3. **Read-only, but for Copy to.** Edits happen in the manager's own app. Items
   come into Conch's vault only when the person imports a file or chooses **Copy
   into Conch** (`vault/transfer.ts`: one way, one item at a time, through the
   program, never an export file on disk). The one write is `add` (optional,
   ADR 0062): a new item made from one of Conch's own when the person chooses
   **Copy to <manager>**, its values on the program's stdin, behind a recent
   sign-in, with no tool for the assistant. Offer it only when the program takes
   a new item on stdin.
4. **Ids are id-safe** (`xx_…`, at most 128 characters of `[A-Za-z0-9_-]`) and
   map back to the item without guessing.
5. **Reads and fills follow the vault's rules unchanged** (`readPolicy`, `fillPolicy`, an Unlock card when locked): only on the item's own sites
   (`siteMatches`), with the person's OK, recorded and redacted. A source never
   bypasses `VaultService.fillPolicy`.
6. **Words and pictures:** its mark in Nacre's `brands.ts` (Simple Icons) and
   `SOURCE_*` in `patterns/Passwords`, its name in the web filters, and a
   one-line unlock explanation in `SourcesDialog`.
7. **Tests:** a fake program in `vault.test.ts` or `sources.test.ts`, written
   from the program's own source or docs, proving:
   - no secret reaches a list or an argument;
   - locking hides its items;
   - a fill on another site is refused;
   - copying it into Conch brings what it should.

## Adding a channel

Channels are chat apps your assistant can be reached from (ADR 0018). More are
coming, and each one follows the same shape:

1. **Outbound when the app allows it.** Connect from this computer (long
   polling, a WebSocket the app offers). An app that only delivers to a web
   address (Teams, a WeChat Official Account) comes in through the public
   door (`channels/door.ts`, ADR 0045), never through the gateway:
   - mount a handler at an unguessable `hookId` the channel was given
     (`door.mount`), and offer its address with `hook()`;
   - check the app's own signature before reading a word (a JWT, an HMAC),
     and refuse stale or repeated deliveries;
   - send the bot's own key only to the app's own hosts;
   - say `error` with "turn on its public address" while the door isn't
     ready.

   Where an app offers both (WeCom's long connection, an Official Account),
   the outbound way is the default.

2. **An adapter.** Put it in `apps/server/src/channels/<app>.ts`, implementing `ChannelAdapter`:
   - `identify()` checks the keys with a real call and says who the bot is.
   - `connect()` runs and reconnects by itself, and reports `state`. It ends
     on `needs-token` only when the app refuses the key.
   - Map every error to a plain `ChannelError`, turning the app's own error
     codes into the setting to change.
   - Never put a key in a message or a URL you log (`redact`).
   - Private chats, unless it can tell a mention apart in a group (ADR 0075):
     then set `groups = true`, report `direct: false` with `mentioned` (an
     @mention or a reply to the bot), the group's name, the mention cut out of
     the text and a `quote` of someone else's message being replied to. The
     service does the rest: off until the owner turns the group on, the owner
     as in private, everyone else words only. One channel's failure never
     reaches another.
3. **A pretend app** in `channels/mock/<app>.ts`, with `/__control/…` endpoints.
   Unit tests, e2e and `pnpm dev:mock` use it. Test the healing paths: a
   dropped connection, a refused key, a rate limit, and the app's own quirks.
4. **The words and pictures**: a `CHANNEL_CATALOG` entry (with `short`, its few words
   for a tile among the other apps in Apps), the logo in Nacre's
   `brands.ts` (Simple Icons; keep a brand's own colours when its rules ask),
   and a setup in `ConnectChannel.tsx`:
   - numbered steps that say which button to press;
   - beside them, a `Handset` for a chat or a `PortalSketch` for a web page;
   - everything worked out for the person that can be: names, settings, links;
   - keys accepted when pasted anywhere on the page, and checked as they land;
   - a last step, a hello that recognises the owner.
5. **Nobody gets in by default.** Only two things admit anyone: the owner's
   hello (a one-time code, or **That's me** in Conch), or a person pressing
   **Let in**.
6. **An account that's already the person's own** (WhatsApp, Signal: ADR
   0043; iMessage, email: ADR 0044) is not a bot. One set of pieces covers
   them all (`channels/linked.ts`):
   - `ownAccount(kind)`: other people's chats are never read unless
     `settings.others` is `ask`, and groups are never answered;
   - the owner is let in without a hello: a `ChannelLinker` (the QR scan is
     the hello) or the adapter's `owner()` (an email address's own mail,
     iMessage to yourself), welcomed once the channel is online;
   - no buttons: `TextChoices` writes numbered answers and reads replies;
   - mark what Conch sends, so it never reads its own answers back (two
     Conches on one account never answer each other); never change the
     person's own profile;
   - a channel that can't be told "send me what I missed" reports a
     `cursor`, kept with the channel, so a restart answers nothing twice;
   - someone else's words from the owner (a forward) set `outside`, which
     taints the chat; a sender's identity is never taken from what the
     sender wrote (email: the provider's own `Authentication-Results`, or
     your Sent mail);
   - its keys in a sealed file or a folder that's `secret` in backups and
     in `lib/protect.ts`; a program it needs is a need with Install, a macOS
     switch it needs is `ChannelHealth.access`.
7. **Its page in the documentation** (working agreement 13):
   `apps/docs/content/channels/<app>.md` with the same steps in words, and a
   picture of the other app in `apps/docs/src/embeds/channels.tsx`. The tile and
   the facts come from the catalog entry.

## How Conch extends itself

A **Conch app** ([ADR 0061](./docs/adr/0061-apps-you-make-share-and-add.md)) is a
folder: `conch-app.json` (`ConchAppManifest`), `tools.mjs`, up to four pages and
skills. The assistant builds one in a chat with the maker's tools
(`conchapps/tools.ts`: `app_new`, `app_write`, `app_check`, `app_try`,
`app_present`…), reading `app_guide` first, and the person adds it from the card.
It is then one of Conch's own tool families (`ConchApps`, `hosted.ts`), so every
provider gets its tools, under the app's policy and the guard after reading. Its
pages are sealed artifacts with the page kit and `conch.call`. It is shared as a
signed `.conchapp` or a GitHub repository with the topic `conch-app`, and added
back from a link, a file or the community search.

The seal is the contract everything else stands on. Don't loosen it:

- **The process** (`runtime.ts` `sealedArgs`, `sealedEnv`; `runtime/host.mjs`):
  Node's permission model reading only the app's folder and writing only its
  data; no programs, workers, addons, WASI, inspector or `eval`; no environment;
  and the fence inside the process (no network or process modules, no `fetch`,
  `WebSocket` or undici dispatcher, no `console` socket, no real `process`,
  frozen prototypes). `runtime.test.ts` attacks every one of these from a real
  child process. A change to the host passes those tests unchanged, plus a new
  attack for whatever it adds.
- **The network** goes through the gateway (`fetcher.ts`): only the hosts on the
  card (`reaches`), through live data's SSRF guard, capped and rate-limited.
- **Pages** reach only their own app's tools, through `SealedFrame` `onCall`; a
  change needs a press in the page or a yes. Never `allow-same-origin`, a network
  source or popups (rule 8 in § Security engineering).
- **Adding is a person's press.** No tool installs, updates, publishes or trusts.
  Keys and data carry over only in the same hands (`sameHands`: same source and
  signer), another maker's versions are never offered for **Go back**, and only
  apps made here are signed with the person's key.
- **What a stranger's app says is data.** Its name, instructions, examples and
  tool descriptions reach the model sanitised and fenced, and its tools taint
  the chat.

**Adding a power apps may use** (a notification, a calendar read, a file the
person picks), in this order:

1. **The decision.** Amend ADR 0061 or write a new ADR: what the power is, who
   can be hurt by it, and why a declared, shown permission is enough.
2. **The declaration.** A manifest field in `ConchAppManifest`, off unless the app
   asks for it, with its words in `appAbilities`, so the card, the install
   preview, the app's page and the prompt all say it ("Can send you a
   notification"). A new reach shows first in `describeChanges` on update.
3. **The door.** A message over the runtime's IPC (`host.mjs` asks, `runtime.ts`
   answers), carried out by the gateway with its own checks and limits. The app
   process is never handed a capability, a handle or a path outside its folders.
   Add the attack tests next to the existing ones.
4. **The bar and the manual.** A rule in `check.ts` (what makes using it right or
   wrong), and its section in `guide.ts` with a short example. `guide.test.ts`
   keeps the guide in step with the runtime and the page kit.
5. **Whole Conch.** A `BackupPower` line if it lets an app act without asking; a
   doctor check if it holds state; the mock engine's Tally path and
   `journey.test.ts` if it changes the journey.

**Adding a place apps come from** (another forge, a registry): implement
`AppSources` in `conchapps/types.ts` through `guardedFetch` with the download
cap, and teach `parseLink` its links. Its packages go through `findApps`,
`checkApp` (`safetyOnly`) and `verifyApp` like every other; nothing it says is
trusted, and its descriptions taint the chat.

**Making the apps better** is changing the guide, the starter, the quality bar
and the page kit. Read a few apps the assistant makes after every such change
(a real provider in `pnpm dev`, or the mock's Tally in `pnpm dev:mock`).

## Releasing

Pushing to `main` is no longer a release. A release is `pnpm release`, by the
maintainer (docs/RELEASING.md). Write `feat` and `fix` subjects in the person's
words, since they become the release notes, and put what the person must do in
a `BREAKING CHANGE:` footer. A release tag also builds the desktop apps for every platform and attaches them
to its GitHub Release (`.github/workflows/desktop.yml`, ADR 0054). Never run `pnpm release`, create `v*` tags or
change `release/allowed_signers` unless you're asked to: installs trust them.
A change to stored data must stay readable by the version before (ADR 0051 §
Data across versions).

## Definition of done

- [ ] `pnpm check` passes
- [ ] New/changed UI has stories covering its states, and screenshots were reviewed
- [ ] New behaviour has tests (unit for logic, play/axe for components)
- [ ] The documentation says what’s true now (working agreement 13): the guide in `apps/docs/content` for anything a person sees or does differently, and this file, ARCHITECTURE.md, NACRE.md or an ADR for how it’s built
- [ ] Security-relevant? Threat-modelled, abuse cases tested, checkup updated, sources cited
- [ ] Never asks anyone to type a file or folder path. Find it first (as `vault/keepass.ts` finds KeePassXC databases), offer it with Nacre `PathPicker`, and use the system's Open dialog (`POST /api/pick`, a new `PickPurpose` per use) for anything else. Typing is only the fallback from another device.
- [ ] Fails well (working agreement 11)? Foreseeable failures heal themselves or end in one plain next step, and the healing paths are tested
- [ ] Needs something outside Conch? It's declared as a need that Conch finds, installs or links to, and notices when it arrives. It's never a “Couldn't find X” message.
- [ ] Joined the whole-Conch features (working agreement 12)? A Repair everything check, a backup rule for new files, `version`/`latest` for new programs, `cues` for new catalog apps, `local` and `TurnProblem` for new providers.
- [ ] A narrow ability? Considered as a Conch app first (working agreement 15), and, if it extends what apps can do, done the way [§ How Conch extends itself](#how-conch-extends-itself) says.
- [ ] Part of the chat (working agreement 14)? What a person must turn on is in the map and can be offered; results worth seeing have a view; choices are asked with `ask`.
