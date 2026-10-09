import { currentTimeTool } from './lib/time-tool';
import { WorkPlaces } from './workplaces/service';
import { createHash } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { join, resolve, sep } from 'node:path';

import {
  ARTIFACT_FILES,
  CHAT_SOURCE_LABELS,
  isPastChatId,
  type ConversationSummary,
  type EngineId,
  type LoginState,
  type ServerEvent,
  type SkillSource,
  type TrayInfo,
  type TurnProblem,
} from '@conch/protocol';

import { Activity } from './activity/service';
import { importCheck } from './import/doctor';
import { ImportService } from './import/service';
import { pastChatsCheck } from './import/chats/doctor';
import { CARRY_ON_WITH, ChatImportService } from './import/chats/service';
import { PastChatStore } from './import/chats/store';
import { fetchLive, LiveDataAccess } from './artifacts/live';
import { ArtifactService } from './artifacts/service';
import { conchAppParts, type ConchAppParts } from './conchapps/deps';
import { pickPath } from './lib/picker';
import { PICK_PURPOSES } from './pick/routes';
import { conchAppsCheck } from './conchapps/doctor';
import { appsPrompt } from './conchapps/prompt';
import { ConchAppService } from './conchapps/service';
import { makerTools } from './conchapps/tools';
import { ArtifactStore } from './artifacts/store';
import { tasksCheck } from './tasks/doctor';
import { signingKeyCheck } from './skills/doctor';
import { marketCheck } from './skills/market/doctor';
import { marketSources } from './skills/market/sources';
import { SkillMarket } from './skills/market/service';
import { marketTools } from './skills/market/tools';
import { fingerprintOf } from './skills/signing';
import { TaskService } from './tasks/service';
import { mcpCheck } from './mcp/doctor';
import { McpSessions } from './mcp/endpoint';
import { McpPairing } from './mcp/pairing';
import { McpService } from './mcp/service';
import { McpClientStore } from './mcp/store';
import { TaskStore } from './tasks/store';
import { QuestionDesk } from './questions/desk';
import { QUESTIONS_PROMPT, questionTools } from './questions/tools';
import { scriptTools } from './scripts/tool';
import { DraftStore } from './drafts/store';
import { AttachmentStore } from './attachments/store';
import { fileTools } from './files/tools';
import { placesTools } from './research/places';
import { knowledgeTools } from './research/knowledge';
import { FinanceSource, financeTools } from './research/finance';
import { researchTools, publicWebFetcher } from './research/tools';
import { weatherTool } from './research/weather';
import { chartTools } from './research/charts';
import { recipeTools } from './research/recipe';
import { productTools } from './research/products';
import { musicTools } from './research/music';
import { videoTools } from './research/video';
import { faviconFetcher, Favicons } from './favicons/favicons';
import { ProcessService } from './processes/service';
import { GatewayRecovery } from './recovery/gateway';
import { recoveryHistoryCheck } from './recovery/doctor';
import { ImageService } from './images/service';
import { ChromiumPrinter } from './files/make/printer';
import { FileMaker } from './files/make/tools';
import { documentTools } from './files/documents';
import { publishTools } from './files/publish';
import { type SystemKey, VaultService } from './vault/service';
import { vaultTools } from './vault/tools';
import { vaultCheck } from './vault/doctor';
import { keystoreMode } from './vault/keystore';
import { deviceSealer, registerSealer } from './lib/sealed';
import { protectedPaths } from './lib/protect';
import { pretendBackend } from './background/backends';
import { carriedEnv } from './background/files';
import { backendFor, BackgroundService, runningAs } from './background/service';
import { AfterLogout, KeepAwake, pretendLittle } from './background/little';
import { Shortcut } from './background/shortcut';
import { askUrl, pretendTray, trayCheck, TrayService } from './background/tray';
import { pretendTailscale } from './network/mock-tailscale';
import { Tailscale } from './network/tailscale';
import { pushCheck } from './push/doctor';
import { PushService } from './push/service';
import { PushStore } from './push/store';
import { VoiceService } from './voice/service';
import { SpeechService } from './voice/speech';
import { WakeWord } from './voice/wake';
import { AccessStore } from './auth/store';
import { backupCheck } from './backup/doctor';
import { BackupService } from './backup/service';
import { BrowserService } from './browser/service';
import { adapterFor, type ChannelEndpoints, slackCheckFor } from './channels/adapters';
import { ChannelDoorService, doorCheck } from './channels/door';
import { addressCheck } from './address/doctor';
import { AddressService } from './address/service';
import { ChatDb, imessageSetup, MESSAGES_DB, openForImessage } from './channels/imessage';
import { MockMail } from './channels/mock/email';
import { MockMessages } from './channels/mock/imessage';
import { channelKeys } from './channels/keys';
import { MockDiscord } from './channels/mock/discord';
import { MockMatrix } from './channels/mock/matrix';
import { MockSlack } from './channels/mock/slack';
import { MockTeams } from './channels/mock/teams';
import { MockTelegram } from './channels/mock/telegram';
import { linkedChannels, type LinkedChannels } from './channels/linked-setup';
import { ChannelLinking } from './channels/linking';
import { MockDingTalk } from './channels/mock/dingtalk';
import { MockFeishu } from './channels/mock/feishu';
import { FeishuRegistrations } from './channels/feishu-register';
import { personId } from './channels/types';
import { FeishuAdapter } from './channels/feishu';
import { MockQq } from './channels/mock/qq';
import { MockGoogleChat } from './channels/mock/googlechat';
import { MockLine } from './channels/mock/line';
import { MockMattermost } from './channels/mock/mattermost';
import { MockRocketChat } from './channels/mock/rocketchat';
import { MockTwilio } from './channels/mock/twilio';
import { MockWeChat } from './channels/mock/wechat';
import { ChannelService } from './channels/service';
import { channelName } from './channels/catalog';
import { channelTools } from './channels/tools';
import { ChannelStore } from './channels/store';
import { TerminalService } from './terminal/service';
import { Gatekeeper } from './security';
import { linuxBrowserHome, ThisComputer } from './auth/here';
import type { Config } from './config';
import { CommandStore } from './commands/store';
import { ConversationManager, type TurnRoute, type ToolContext } from './conversations/manager';
import { ConversationStore } from './conversations/store';
import { ChatFolders } from './conversations/folders';
import { AgentStore } from './agents/store';
import { RoundService } from './agents/rounds';
import { homedir } from 'node:os';

import { OutsideAgents } from './a2a/outside';
import { TelemetryService } from './telemetry/service';
import { Redaction } from './trajectory/redact';
import { diskOf } from './computer/readers';
import { sampleResources } from './recovery/resources';
import { outsideCheck } from './a2a/doctor';
import { registerAgentsDoctor } from './agents/doctor';
import { ApiEngine } from './engines/api';
import { ExtensionService } from './extensions/service';
import { PretendWorld } from './extensions/pretend';
import { builtInEngines, serverEngine } from './engines/registry';
import { appsNeeded } from './providers/apps';
import { carryTools } from './providers/capabilities';
import { Describer } from './vision/describer';
import { MockEngine } from './engines/mock/engine';
import { MOCK_MEANING_SPEC, mockMeaningFetch, mockMeaningLoad } from './engines/mock/meaning';
import type { CompletionInput, Engine, LoginHandle } from './engines/types';
import { Emitter } from './lib/emitter';
import { sandboxFor, sandboxSupport, secretPlaces } from './conversations/sandbox';
import { heldTaints } from './conversations/taint';
import { UndoService } from './undo/service';
import { UndoStore } from './undo/store';
import { safetyCheck } from './conversations/safety-doctor';
import { providerCoverage } from './conversations/safety-routes';
import { registerCoreChecks } from './doctor/checks';
import { BOOT_ID, restart, restartable, stopSoon } from './lib/lifecycle';
import { Doctor } from './doctor/service';
import { NetworkWatch } from './network/watch';
import { Healed } from './lib/healed';
import type { Heal } from './lib/recover';
import { CloudService } from './clouds/service';
import { LocalService } from './local/service';
import { ComputerSampler } from './computer/sampler';
import { computerUseCheck } from './computer-use/routes';
import { pretendComputer } from './computer-use/pretend';
import { ComputerUseService } from './computer-use/service';
import { computerPrompt, computerTools } from './computer-use/tools';
import { KNOWN_NEEDS, findGh } from './setup/known';
import { WaitService } from './waits/service';
import { fetchClient, ghClient, realRun } from './waits/github';
import { Setup } from './setup/needs';
import { setToolsHome } from './setup/release';
import { ProviderKeys } from './providers/keys';
import { ProviderService } from './providers/service';
import { SecretVault } from './secrets/vault';
import { GoogleService } from './google/service';
import { GoogleStore } from './google/store';
import { googleTools } from './google/tools';
import { filesOf } from './channels/outbound';
import { registerGoogleDoctor } from './google/doctor';
import { GoogleApps } from './google/apps';
import { GMAIL_IMAP, GmailImap } from './google/imap';
import { SLACK_WEB_API } from './slack/api';
import { SlackApps } from './slack/apps';
import { registerSlackDoctor } from './slack/doctor';
import { SlackService } from './slack/service';
import { SlackStore } from './slack/store';
import { offeredSlackTools } from './slack/tools';
import { type Blueprint, CATALOG } from './integrations/catalog';
import { MockVendor } from './integrations/mock/vendor';
import { hostedApps } from './integrations/hosted';
import { IntegrationService } from './integrations/service';
import { MemoryIndex } from './memory/index';
import { OnDeviceModel } from './memory/ondevice';
import { cheapModel, MeaningModel, yourRequests, yourWords } from './memory/learning';
import { pickSmallModel, smallAllow, smallModelOrder, type SmallPick } from './providers/small';
import { registerLearningDoctor } from './memory/doctor';
import { registerQuietLearningDoctor } from './learning/doctor';
import { notYours, QuietLearning } from './learning/service';
import type { SmallModelDeps } from './conversations/stories/ask';
import { StoryExplainer } from './conversations/stories/explain';
import { StoryTitler } from './conversations/stories/titler';
import { LearningSpend } from './learning/spend';
import { MemoryStore } from './memory/store';
import { MemoryTidy } from './memory/tidy';
import { checkInCheck } from './checkins/doctor';
import { StandingOrderStore } from './checkins/orders';
import { CheckIns } from './checkins/service';
import { tellWords } from './checkins/tell';
import { standingOrderTools } from './checkins/tools';
import { SkillLearner } from './skills/learn';
import { SkillSuggester } from './skills/suggest';
import { SkillUsage, skillUsedIn } from './skills/usage';
import { RoutineService } from './routines/service';
import { OfferDesk } from './offers/desk';
import { offerTools } from './offers/tools';
import { RoutineSpend } from './routines/spend';
import { PAST_CHATS_PROMPT, pastChatTools, withOthers, type ChatFacts } from './search/past';
import { SearchService } from './search/service';
import { RoutineStore } from './routines/store';
import { WhenRoutines } from './routines/triggers';
import { calendarSource } from './routines/triggers/calendar';
import { folderSource } from './routines/triggers/folder';
import { routineSource, taskSource } from './routines/triggers/finished';
import { calendarAccess, gmailAccess, mailPeople } from './routines/triggers/google';
import { HookSecrets, hookSource } from './routines/triggers/hook';
import { mailSource } from './routines/triggers/mail';
import { judgeWith } from './routines/triggers/onlyif';
import { OwnWrites } from './routines/triggers/own';
import { pageSource } from './routines/triggers/page';
import { routinesWatchCheck } from './routines/triggers/doctor';
import { SettingsStore } from './settings/store';
import { SkillService } from './skills/service';
import { externalRoots, SkillStore } from './skills/store';
import { SkillTrust } from './skills/trust';
import { ConchCheckout, findCheckout, findRepository } from './updates/conch';
import { ReleaseFollower } from './updates/releases';
import { updatesCheck } from './updates/doctor';
import { lookup } from './updates/latest';
import { mockPrograms } from './updates/mock';
import { UpdatesService } from './updates/service';
import { UsageService } from './usage/service';
import { Billings, recordSmallSpend, turnCost } from './usage/billing';
import { ChatSpendDesk } from './usage/desk';
import { REPOSITORY, SERVER_VERSION, SERVER_BUILD } from './version';
import { theApp } from './desktop/app';
import { AppReleases } from './updates/app';
import { cliName } from './cli/command';

export { SERVER_VERSION };

/** How long Passwords waits on a provider's sign-in before using what it last said. */
const SIGN_IN_LOOK_MS = 1_500;

/**
 * Every past turn's money, oldest conversations included: what Conch worked
 * out (ADR 0079) where it did, so a plan's turns cost nothing; else what the
 * provider said.
 */
async function turnCosts(store: ConversationStore) {
  const turns: { at: number; costUsd: number }[] = [];
  for (const record of await store.list()) {
    for (const event of await store.events(record.id)) {
      if (event.type !== 'turn.completed') continue;
      const usd = event.cost
        ? event.cost.billing === 'metered'
          ? event.cost.usd
          : 0
        : event.usage?.costUsd;
      if (usd) turns.push({ at: event.at, costUsd: usd });
    }
  }
  return turns;
}

/** Everything the HTTP layer needs, wired once. Tests build this with a temp home. */
export class Services {
  readonly broadcast = new Emitter<ServerEvent>();
  /** What Conch fixed on its own, for the quiet list in Settings. */
  readonly healed: Healed;
  /** What features need from this computer, and getting it (ADR 0016). */
  readonly setup: Setup;
  /** Repair everything: every part's check, run at once (see `doctor/`). */
  readonly doctor: Doctor;
  readonly recovery: GatewayRecovery;
  /** Whether Conch can reach the internet (ADR 0023). */
  readonly network: NetworkWatch;
  /** A model on this computer: Ollama, found, started and fed models (ADR 0022). */
  readonly local: LocalService;
  /** Your company's cloud accounts, found on this computer (ADR 0109). */
  readonly clouds: CloudService;
  /** This computer, looked at only while someone has Settings → This computer open. */
  readonly computer: ComputerSampler;
  /** The assistant using this computer's apps, while you watch (ADR 0110). Off until you turn it on. */
  readonly computerUse: ComputerUseService;
  readonly settings: SettingsStore;
  /** Who may sign in (`~/.conch/access.json`). */
  readonly access: AccessStore;
  readonly gate: Gatekeeper;
  readonly here: ThisComputer;
  /** Files in CONCH_HOME whose permissions couldn't be tightened (see `secureHome`). */
  homeProblems: string[] = [];
  readonly memory: MemoryStore;
  /** It learns you (ADR 0032): meaning search, the tidy-up, skills you keep asking for. */
  readonly memoryIndex: MemoryIndex;
  readonly meaning: MeaningModel;
  readonly onDevice: OnDeviceModel;
  readonly tidy: MemoryTidy;
  readonly suggester: SkillSuggester;
  /** Save how I did this: skills offered from work that went well (ADR 0058). */
  readonly learner: SkillLearner;
  /** Quiet learning (ADR 0088): each chat read once it goes quiet, said afterwards, with Undo. */
  readonly learning: QuietLearning;
  /** What learning may spend a month: a person's choice, never the agent's. */
  readonly learningSpend: LearningSpend;
  /** Story headlines by a small model (ADR 0103). */
  readonly stories: StoryTitler;
  /** "Why?" on a step (ADR 0103). */
  readonly explainer: StoryExplainer;
  /** Site icons for chips, from each site itself (ADR 0103). */
  readonly favicons: Favicons;
  /** Prices and filings, cached across chats and the finance card's range switch. */
  readonly finance: FinanceSource;
  /** When each skill was last used, for the tidy shelf (ADR 0058). */
  readonly skillUsage: SkillUsage;
  readonly commands: CommandStore;
  /** Files and long pastes sent with messages (ADR 0017). */
  readonly attachments: AttachmentStore;
  readonly processes: ProcessService;
  readonly images: ImageService;
  /** Documents, spreadsheets, slides and charts made for any provider; a browser prints them. */
  readonly files: FileMaker;
  readonly #printer = new ChromiumPrinter();
  /** Passwords: Conch's own vault and the managers it reads (ADR 0025). */
  readonly vault: VaultService;
  readonly routines: RoutineService;
  /** Standing orders and the check-in that watches for them (ADR 0107). */
  readonly standingOrders: StandingOrderStore;
  readonly checkins: CheckIns;
  /** What routines spend, and the limits on it (ADR 0057). */
  readonly routineSpend: RoutineSpend;
  readonly conversations: ConversationManager;
  /** The folders in the chat list (ADR 0089). */
  readonly folders: ChatFolders;
  readonly drafts: DraftStore;
  /** The agents you talk to: personas of the same Conch (ADR 0101). */
  readonly agents: AgentStore;
  /** Agents elsewhere that speak A2A, added by pasting their address (ADR 0112). */
  readonly outside: OutsideAgents;
  /** Dashboards: Conch's numbers and traces for Prometheus and OpenTelemetry (ADR 0121). */
  readonly telemetry: TelemetryService;
  /** Agents taking turns in a chat when you mention them (ADR 0112). */
  readonly rounds: RoundService;
  /** Questions the assistant asked, waiting for your answer (ADR 0060 §4). */
  readonly questions = new QuestionDesk();
  /** Every offer to turn something on in a chat goes through here (ADR 0060). */
  readonly offers: OfferDesk;
  readonly browser: BrowserService;
  /** Where a chat's commands run: this computer, a container, your machine, the cloud (ADR 0106). */
  readonly workplaces: WorkPlaces;
  readonly terminal: TerminalService;
  readonly engines: Map<EngineId, Engine>;
  /** Where every provider's key lives, whether that's here or in 1Password. */
  readonly keys: ProviderKeys;
  /** Connecting providers, switching between them, and saying how they are. */
  readonly providers: ProviderService;
  /** Screenshots in words for models that can't see, by one that can (ADR 0070). */
  readonly describer: Describer;
  readonly usage: UsageService;
  readonly integrations: IntegrationService;
  /** Skills: Conch's own, and those in other agents' folders (ADR 0013). */
  readonly skills: SkillService;
  /** Whose signed skills you trust, and your own signing key (ADR 0031). */
  readonly skillTrust: SkillTrust;
  /** Discover (ADR 0074); undefined when it's turned off. */
  readonly market?: SkillMarket;
  /** The pretend SaaS vendor used with the mock engine. */
  readonly mockVendor?: MockVendor;
  /** Full-text search over every conversation; rebuilds its index when it breaks. */
  readonly search: SearchService;
  /** Updates for Conch and the programs it uses (ADR 0019). */
  readonly updates: UpdatesService;
  /** Back up and restore your Conch; a daily backup by itself (ADR 0020). */
  readonly backups: BackupService;
  /** When a chat last did anything: backups wait for a quiet moment. */
  #lastActivity = Date.now();
  /** Every chat app that reaches your assistant (ADR 0018, 0043, 0044, 0045). */
  readonly channels: ChannelService;
  /** Come home: bringing your things from OpenClaw or Hermes (ADR 0035). */
  readonly imports: ImportService;
  /** Your past chats from Claude Code, Codex and the rest, brought in to read and carry on (ADR 0111). */
  readonly chatImports: ChatImportService;
  /** Always on: starting at login, running with no window (ADR 0026). */
  readonly background: BackgroundService;
  /** Conch in the menu bar, tray or panel (ADR 0029). */
  tray!: TrayService;
  /** Your phone's secure address, over Tailscale (ADR 0027). */
  readonly tailscale: Tailscale;
  /** Notifications on your devices (ADR 0027). */
  readonly push: PushService;
  /** Revoked devices must be forgotten before shutdown releases their storage. */
  readonly #pushRevocations = new Set<Promise<void>>();
  /** Private dictation: whisper.cpp on this computer (ADR 0027). */
  readonly voice: VoiceService;
  /** Natural voices: Piper on this computer, or a connected provider's (ADR 0077). */
  readonly speech: SpeechService;
  /** "Hey Conch", in the desktop app (ADR 0078). */
  readonly wake: WakeWord;
  /** Work that runs in the background, and helpers side by side (ADR 0033). */
  readonly tasks: TaskService;
  /** Waiting for CI, a command, a page or a time without calling a model (ADR 0125). */
  readonly waits: WaitService;
  /** Other apps using Conch through its MCP door (ADR 0073). */
  readonly mcp: McpService;
  readonly mcpPairing: McpPairing;
  readonly mcpSessions = new McpSessions();
  /** Direct Google account connections, shared by every engine. */
  readonly google: GoogleService;
  /** Gmail, Google Calendar and Google Drive as apps in Apps (ADR 0048). */
  readonly googleApps: GoogleApps;
  /** Slack connected to Conch itself, so it works with every model (ADR 0049). */
  readonly slack: SlackService;
  /** Slack as an app on the Apps page, like Gmail (ADR 0052). */
  readonly slackApps: SlackApps;
  /** Everything the assistant did, in one place (ADR 0028). */
  readonly activity: Activity;
  /** Putting back what the assistant changed (ADR 0030). */
  readonly undo: UndoService;
  /** Things the assistant makes to see and use (ADR 0034). */
  readonly artifacts: ArtifactService;
  /** Apps you make, share and add (ADR 0061). */
  readonly conchApps: ConchAppService;
  /** The pretend Telegram and Discord used with the mock engine. */
  readonly mockTelegram?: MockTelegram;
  readonly mockDiscord?: MockDiscord;
  readonly mockSlack?: MockSlack;
  /** WhatsApp and Signal (ADR 0043): their keys, signal-cli, and the pretend ones with the mock engine. */
  readonly linked: LinkedChannels;
  /** Linking WhatsApp or Signal by QR code. */
  readonly channelLinking: ChannelLinking;
  /** Making a Feishu or Lark bot by scanning a code (ADR 0120). */
  readonly feishuScans: FeishuRegistrations;
  readonly mockMail?: MockMail;
  readonly mockMessages?: MockMessages;
  readonly mockTeams?: MockTeams;
  readonly mockMatrix?: MockMatrix;
  readonly mockWeChat?: MockWeChat;
  readonly mockTwilio?: MockTwilio;
  readonly mockMattermost?: MockMattermost;
  readonly mockLine?: MockLine;
  readonly mockFeishu?: MockFeishu;
  readonly mockDingTalk?: MockDingTalk;
  readonly mockQq?: MockQq;
  readonly mockRocketChat?: MockRocketChat;
  readonly mockGoogleChat?: MockGoogleChat;
  /** Providers and chat apps that Conch apps bring (ADR 0122). */
  readonly extensions: ExtensionService;
  /** The pretend model company and chat app those are tried with, with the mock engine. */
  readonly pretendWorld?: PretendWorld;
  /** The public door, for the channels that only deliver to a web address (ADR 0045). */
  readonly door: ChannelDoorService;
  /** Your own address, over HTTPS by Conch itself (ADR 0064). Started by main.ts, never by tests. */
  readonly address: AddressService;
  /** The gateway's own server, once it listens: where the address hands its requests. */
  #gateway?: HttpServer;
  #login?: { handle: LoginHandle; state: LoginState };
  #channelStore?: ChannelStore;
  #sweeper?: NodeJS.Timeout;
  #hereSweeper?: NodeJS.Timeout;
  #stopAsks?: () => void;
  #vaultDoctor?: NodeJS.Timeout;

  constructor(
    readonly config: Config,
    /** Tests: stand-ins for the parts of Conch apps (`conchapps/deps.ts`). */
    overrides: { conchAppParts?: ConchAppParts } = {},
  ) {
    this.healed = new Healed(config.CONCH_HOME, (note) =>
      this.broadcast.emit({ type: 'healed', note }),
    );
    setToolsHome(config.CONCH_HOME);
    this.setup = new Setup(KNOWN_NEEDS);
    this.network = new NetworkWatch({
      emit: (network) => this.broadcast.emit({ type: 'network.status', network }),
      // The scripted engine needs no internet: online unless a test pretends otherwise.
      ...(config.CONCH_ENGINE === 'mock' && { probe: async () => true }),
    });
    this.doctor = new Doctor({
      emit: (report) => this.broadcast.emit({ type: 'doctor.report', report }),
      onHeal: (message) => void this.healed.note('gateway', message),
    });
    /** Every store that repairs itself says so here (AGENTS.md agreement 11). */
    const heal: Heal = (area, message) => void this.healed.note(area, message);
    this.google = new GoogleService(
      new GoogleStore(config.CONCH_HOME),
      undefined,
      undefined,
      // Gmail with an app password: imap.gmail.com, or the pretend mail service with the mock engine.
      new GmailImap(() =>
        this.mockMail
          ? {
              imap: this.mockMail.endpoints.imap,
              smtp: this.mockMail.endpoints.smtp,
              insecure: true,
            }
          : GMAIL_IMAP,
      ),
    );
    this.googleApps = new GoogleApps(this.google, {
      emit: (event) => this.broadcast.emit(event),
      onHeal: (message) => void this.healed.note('integrations', message),
    });
    this.google.onConnected = (capabilities) => this.googleApps.showFor(capabilities);
    registerGoogleDoctor(this.doctor, this.google, this.googleApps);
    this.slack = new SlackService({
      store: new SlackStore(config.CONCH_HOME, heal),
      // With the mock engine, the pretend Slack the channels use answers for Slack too.
      base: () => (this.mockSlack ? this.mockSlack.api : SLACK_WEB_API),
      // Slack is an app like any other on the Apps page (ADR 0052).
      emit: () => void this.slackApps.changed().catch(() => undefined),
      onHeal: (message) => void this.healed.note('integrations', message),
    });
    this.slackApps = new SlackApps(this.slack, { emit: (event) => this.broadcast.emit(event) });
    registerSlackDoctor(this.doctor, this.slack);
    this.settings = new SettingsStore(config.CONCH_HOME, heal);
    this.agents = new AgentStore(config.CONCH_HOME, this.settings, heal, (list) =>
      this.broadcast.emit({ type: 'agents.changed', list }),
    );
    registerAgentsDoctor(this.doctor, this.agents);
    this.outside = new OutsideAgents({
      home: config.CONCH_HOME,
      heal: (message) => heal('agents', message),
    });
    this.access = new AccessStore(config.CONCH_HOME, heal);
    // "This computer", proven (ADR 0063): the key only your account can read.
    this.here = new ThisComputer(config.CONCH_HOME, {
      heal: (message) => heal('access', message),
      ...(process.platform === 'linux' && { browserHome: () => linuxBrowserHome() }),
    });
    this.gate = new Gatekeeper(config, this.access, this.here);
    // Every write is checked where it's made (ADR 0087), as Settings → Safety says.
    this.memory = new MemoryStore(join(config.CONCH_HOME, 'memory'), {
      checkOn: async () => (await this.settings.get()).preferences.checkMemories,
    });
    this.commands = new CommandStore(join(config.CONCH_HOME, 'commands'));
    // What a draft holds stays until it's sent or the draft is let go (ADR 0124).
    this.attachments = new AttachmentStore(join(config.CONCH_HOME, 'attachments'), {
      drafted: (now) => this.drafts.held(now),
    });
    this.processes = new ProcessService({
      protectedPaths: protectedPaths(config.CONCH_HOME),
      sealed: async () => (await this.settings.get()).preferences.sealedCommands,
      healed: (message) => void this.healed.note('gateway', message),
    });
    this.recovery = new GatewayRecovery({
      sample: () => this.processes.resourceSnapshot(),
      admit: () => this.processes.workload.phase === 'normal',
      relieve: () => this.processes.relievePressure(),
      pause: (reason) => this.processes.pauseAdmission(reason),
      resume: () => this.processes.resumeAdmission(),
      note: (message) => void this.healed.note('gateway', message),
      recoveryMode: process.env.CONCH_RECOVERY_MODE === '1',
      send: (message) => {
        if (process.send && process.connected) process.send(message, () => undefined);
      },
      recovered: async () => {
        await this.routines.start();
        this.tidy.stop();
        this.tidy.start();
        this.learning.stop();
        this.learning.start();
        this.checkins.stop();
        this.checkins.start();
      },
    });
    this.doctor.register(this.recovery.doctorCheck());
    this.doctor.register(recoveryHistoryCheck(config.CONCH_HOME));
    if (this.recovery.recoveryMode)
      this.processes.pauseAdmission(
        'Conch is recovering. Waiting work will carry on once it stays responsive.',
      );
    this.vault = new VaultService({
      home: config.CONCH_HOME,
      keystore: keystoreMode(config),
      emit: () => {
        this.broadcast.emit({ type: 'vault.changed' });
        // Repair everything says what's true now (unlocked, locked, turned off).
        clearTimeout(this.#vaultDoctor);
        this.#vaultDoctor = setTimeout(() => void this.doctor.refresh('passwords'), 400);
        this.#vaultDoctor.unref?.();
      },
      systemKeys: () => this.#systemKeys(),
    });
    // Conch's own keys (providers, integrations, channels) are sealed under this
    // computer's device key from here on (ADR 0025 § Keys Conch uses).
    registerSealer(
      config.CONCH_HOME,
      deviceSealer(() => this.vault.deviceKey()),
    );
    this.keys = new ProviderKeys(this.settings, new SecretVault());
    this.computer = new ComputerSampler({ home: config.CONCH_HOME });
    const desktopApp = theApp();
    this.computerUse = new ComputerUseService({
      home: config.CONCH_HOME,
      ...(desktopApp && { app: desktopApp }),
      // The mock engine's computer is a pretend Mac: nothing real is ever looked at or clicked.
      ...(config.CONCH_ENGINE === 'mock' && { driver: pretendComputer() }),
      // Stop on the glowing edge stops the chat's turn, as its own Stop does.
      interrupt: (conversationId) => this.conversations.interrupt(conversationId),
      heal: (area, message) => void this.healed.note(area, message),
    });
    this.local = new LocalService({
      home: config.CONCH_HOME,
      setup: this.setup,
      heal: (message) => void this.healed.note('providers', message),
      // A model arrived or Ollama started: the card and the picker see it now.
      onChange: () => local.forget(),
    });
    this.doctor.register(this.local.doctorCheck());
    // Your company's cloud (ADR 0109): an account chosen means its provider looks again.
    this.clouds = new CloudService({
      settings: this.settings,
      env: process.env,
      onChange: (id) => {
        void this.engines.get(id)?.setApiKey?.(undefined);
        void this.providers.get(id, { force: true }).catch(() => undefined);
      },
    });
    // Every provider Conch knows by name (ADR 0053); servers you add join as you add them.
    const registry = {
      clouds: this.clouds,
      settings: this.settings,
      keys: this.keys,
      home: config.CONCH_HOME,
      local: this.local,
      heal: (message: string) => void this.healed.note('providers', message),
      paths: { claude: config.CONCH_CLAUDE_PATH, codex: config.CONCH_CODEX_PATH },
    };
    const known = builtInEngines(registry);
    const local = known.get('ollama') as ApiEngine;
    this.engines = new Map<EngineId, Engine>([
      ...known,
      [
        'mock',
        new MockEngine({
          state: process.env.CONCH_MOCK_STATE,
          speed: Number(process.env.CONCH_MOCK_SPEED ?? 1),
          installAfter: process.env.CONCH_MOCK_INSTALL_AFTER
            ? Number(process.env.CONCH_MOCK_INSTALL_AFTER)
            : undefined,
          usage: process.env.CONCH_MOCK_USAGE,
        }),
      ],
    ]);
    this.providers = new ProviderService({
      engines: this.engines,
      settings: this.settings,
      keys: this.keys,
      makeServer: (server) => serverEngine(server, registry),
      lookAround: { env: process.env },
      clouds: this.clouds,
      pinned: config.CONCH_ENGINE,
      emit: (event) => this.broadcast.emit(event),
      // A different provider means different limits and a different model list.
      onSwitch: () => void this.usage.refresh({ force: true }),
    });
    this.describer = new Describer({ ready: () => this.providers.ready() });
    // With the mock engine, integrations talk to a pretend vendor on this machine too.
    this.mockVendor = config.CONCH_ENGINE === 'mock' ? new MockVendor() : undefined;
    // With the mock engine, apps that bring a provider or a chat app try them on pretend ones (ADR 0122).
    this.pretendWorld = config.CONCH_ENGINE === 'mock' ? new PretendWorld() : undefined;
    // Apps you make, share and add (ADR 0061): an app like any other on the Apps page.
    this.conchApps = new ConchAppService({
      home: config.CONCH_HOME,
      parts:
        overrides.conchAppParts ??
        conchAppParts({
          home: config.CONCH_HOME,
          heal: (message) => void this.healed.note('integrations', message),
          gatewayPort: config.CONCH_PORT,
          // Made further down; only asked for once Conch is running.
          trust: () => this.skillTrust,
          redact: () => this.vault.redactor(),
          pretend: config.CONCH_ENGINE === 'mock',
          ...(this.pretendWorld && { pretendRoute: this.pretendWorld.route }),
        }),
      emit: (event) => this.broadcast.emit(event),
      heal: (message) => void this.healed.note('integrations', message),
      // Your own keys: a file signed with one is your own app, and keeps what it kept.
      ownKeys: async () =>
        new Set((await this.skillTrust.list()).filter((p) => p.you).map((p) => p.fingerprint)),
      chats: {
        events: async (id) => (await this.conversations.detail(id)).events,
        note: (id, offer) => this.conversations.noteAppOffer(id, offer),
        exists: async (id) =>
          this.conversations.detail(id).then(
            () => true,
            () => false,
          ),
        taints: (id) => this.conversations.taintOf(id),
      },
      skillsChanged: () => {
        this.skills.store.invalidate();
        this.broadcast.emit({ type: 'skills.changed' });
      },
      updatesChanged: () => this.updates.changed(),
      pick: () => pickPath(PICK_PURPOSES['conch-app']),
      // `app_try` on a provider or a chat app (ADR 0122); `extensions` is made further down.
      partTester: (manifest, runtime, body) => this.extensions.testWith(manifest, runtime, body),
      manualChecks: config.CONCH_ENGINE === 'mock',
    });
    this.integrations = new IntegrationService({
      // Conch's own apps, kept by their own services and shown like every other (ADR 0052).
      hosted: hostedApps(this.googleApps, this.slackApps, this.conchApps.hosted),
      home: config.CONCH_HOME,
      heal,
      emit: (event) => this.broadcast.emit(event),
      engines: () => this.providers.ready(),
      cwd: () => this.settings.workspace(),
      blueprints: this.mockVendor && mockBlueprints(this.mockVendor),
      setup: this.setup,
      onHeal: (message) => void this.healed.note('integrations', message),
    });
    // Other agents' skill folders are read unless turned off; test runs (the mock engine) don't look.
    const skillSources =
      config.CONCH_SKILL_SOURCES ?? (config.CONCH_ENGINE === 'mock' ? 'off' : 'auto');
    this.skillTrust = new SkillTrust(config.CONCH_HOME);
    this.skillUsage = new SkillUsage(config.CONCH_HOME, heal);
    const skillStore = new SkillStore(
      config.CONCH_HOME,
      skillSources === 'auto' ? externalRoots() : [],
      () => this.#nativeSkillSources,
      heal,
      this.skillTrust,
    );
    // Discover (ADR 0074): skills people publish, pinned, read first, held to their lists.
    const marketMode =
      config.CONCH_SKILL_MARKET ?? (config.CONCH_ENGINE === 'mock' ? 'pretend' : 'on');
    this.market =
      marketMode === 'off'
        ? undefined
        : new SkillMarket({
            home: config.CONCH_HOME,
            store: skillStore,
            sources: marketSources(marketMode, SERVER_VERSION),
            heal,
            changed: () => this.broadcast.emit({ type: 'skills.changed' }),
          });
    if (this.market) {
      const market = this.market;
      skillStore.marketRoots = () => market.roots();
      skillStore.origins = () => market.origins();
      void market.load().then(() => skillStore.invalidate());
      this.doctor.register(marketCheck(market));
    }
    this.skills = new SkillService({
      store: skillStore,
      ...(this.market && { market: this.market }),
      engines: () => this.providers.ready(),
      emit: (event) => this.broadcast.emit(event),
      onSpend: (usage) => void this.usage.recordTurn(usage).catch(() => undefined),
      trust: this.skillTrust,
      usage: this.skillUsage,
      // "Save how I did this" saved: the offer is settled (ADR 0058).
      suggestionSaved: async (id) => {
        if (this.learner.owns(id)) await this.learner.saved(id);
      },
    });
    // Each Conch app's own skills, read where the app keeps them (ADR 0061).
    this.skills.store.appRoots = () => this.conchApps.skillRoots();
    this.doctor.register(conchAppsCheck(this.conchApps));
    void this.conchApps.load();
    // A signing key written in the clear (an older Conch, a restored backup) is locked now (ADR 0047).
    void this.skillTrust
      .lockIfClear()
      .then((locked) => {
        if (locked) heal('skills', 'Locked your skill-signing key to this computer');
      })
      .catch(() => undefined);
    this.doctor.register(signingKeyCheck(this.skillTrust));
    this.terminal = new TerminalService({
      home: config.CONCH_HOME,
      heal,
      workspace: () => this.settings.workspace(),
      emit: (event) => this.broadcast.emit(event),
    });
    // A device that's signed out takes the terminals it opened with it.
    this.gate.signedOut.on((ids) => this.terminal.endOwnedBy(ids.map((id) => `session:${id}`)));
    this.gate.devicesChanged.on(({ waiting }) =>
      this.broadcast.emit({ type: 'access.changed', waiting }),
    );
    this.browser = new BrowserService({
      home: config.CONCH_HOME,
      heal,
      gatewayPort: config.CONCH_PORT,
      workspace: () => this.settings.workspace(),
      emit: (event) => this.broadcast.emit(event),
      // What `browser_upload` may put on a page (ADR 0080): this chat's own files, or the work folder.
      uploads: {
        home: config.CONCH_HOME,
        forbidden: [
          ...protectedPaths(config.CONCH_HOME),
          ...secretPlaces().map((p) => p.path),
          join(config.CONCH_HOME, 'browser'),
        ],
        attachments: async (conversationId) => {
          const { events } = await this.conversations.detail(conversationId);
          const sent = events.flatMap((e) =>
            e.type === 'user.message' ? (e.attachments ?? []) : [],
          );
          return sent.map((a) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            read: async () => {
              const bytes = await this.attachments.bytes(a.id);
              if (!bytes) throw new Error(`“${a.name}” isn’t here any more.`);
              return bytes;
            },
          }));
        },
        made: async (conversationId) => {
          const all = await this.artifacts.store.list();
          return all
            .filter((a) => a.conversationId === conversationId)
            .map((a) => {
              const file = ARTIFACT_FILES[a.kind];
              return {
                id: a.id,
                name: `${a.title.replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120)}.${file.ext}`,
                mimeType: file.type,
                read: async () =>
                  Buffer.from((await this.artifacts.store.content(a.id)).content, 'utf8'),
              };
            });
        },
      },
    });
    // The browser fills sign-in fields from Passwords, with your OK (ADR 0025).
    this.browser.passwords = this.vault;
    const conversationStore = new ConversationStore(join(config.CONCH_HOME, 'conversations'), heal);
    // Past chats from other apps (ADR 0111): read-only, searched beside Conch's own.
    const pastChats = new PastChatStore(config.CONCH_HOME, heal);
    this.chatImports = this.#chatImports(config, pastChats, conversationStore);
    this.doctor.register(pastChatsCheck(this.chatImports));
    // What you were writing and hadn't sent, per chat (ADR 0124).
    this.drafts = new DraftStore(join(config.CONCH_HOME, 'conversations'), {
      attachment: async (id) => (await this.attachments.get(id))?.attachment,
      exists: async (id) => Boolean(await conversationStore.get(id)),
      heal,
    });
    this.folders = new ChatFolders(join(config.CONCH_HOME, 'conversations'), heal, (folders) =>
      this.broadcast.emit({ type: 'folders.changed', folders }),
    );
    // Undo (ADR 0030): never keeps or writes where keys live, or Conch's own folder.
    const secret = [...protectedPaths(config.CONCH_HOME), ...secretPlaces().map((p) => p.path)];
    this.undo = new UndoService({
      store: new UndoStore(config.CONCH_HOME),
      // Conch's own files are never kept or put back, except the default work folder inside them.
      forbidden: (path) => {
        const full = resolve(path);
        const under = (p: string) => full === p || full.startsWith(`${p}${sep}`);
        return (
          secret.some(under) || (under(config.CONCH_HOME) && !under(this.settings.workspaceDefault))
        );
      },
      restored: (set, direction, files) =>
        void this.conversations
          .noteRestored(set.conversationId, { changeSetId: set.id, direction, files })
          .catch(() => undefined),
    });
    this.doctor.register(this.undo.doctorCheck());
    void this.undo.sweep().catch(() => undefined);
    setInterval(() => void this.undo.sweep().catch(() => undefined), 6 * 60 * 60_000).unref();
    this.artifacts = new ArtifactService({
      store: new ArtifactStore(config.CONCH_HOME, heal),
      conversations: () => this.conversations,
      emit: (event) => this.broadcast.emit(event),
      access: new LiveDataAccess(config.CONCH_HOME, heal),
      gatewayPort: config.CONCH_PORT,
    });
    // It learns you (ADR 0032), by meaning (ADR 0041).
    const mock = config.CONCH_ENGINE === 'mock';
    this.meaning = new MeaningModel(this.local.client);
    // The mock engine never reaches for a real Ollama or Hugging Face.
    this.onDevice = new OnDeviceModel({
      dir: join(config.CONCH_HOME, 'models'),
      heal: (message) => void this.healed.note('settings', message),
      ...(mock && { specs: [MOCK_MEANING_SPEC], fetch: mockMeaningFetch, load: mockMeaningLoad }),
    });
    // Ollama's model when there is one (bigger, and the person chose it), else Conch's own.
    const meaning = async () =>
      (mock ? undefined : await this.meaning.embedder().catch(() => undefined)) ??
      (await this.onDevice.embedder());
    this.memoryIndex = new MemoryIndex({
      path: join(config.CONCH_HOME, 'memory-index.db'),
      store: this.memory,
      meaning,
      offer: (languages) => this.onDevice.offer(languages),
      heal: (message) => void this.healed.note('settings', message),
    });
    this.memory.changed.on(() => void this.memoryIndex.sync());
    // A download cut short by a restart carries on; then every memory is indexed.
    void this.onDevice
      .resume(() => this.meaningLanded())
      .then(() => this.memoryIndex.sync())
      .catch(() => undefined);
    this.tidy = new MemoryTidy({
      home: config.CONCH_HOME,
      store: this.memory,
      // The nightly pass is learning's spending (ADR 0107): within its cap, counted by it.
      // Past the cap, it still merges exact repeats, which needs no model.
      model: async () => {
        const engine = this.providers.engine();
        if (!(await this.learningSpend.allow(engine).catch(() => ({ ok: true }))).ok) return;
        const found = await cheapModel(engine);
        if (!found) return;
        return {
          ...found,
          complete: async (input: CompletionInput) => {
            const answer = await found.complete(input);
            await this.learningSpend.record(answer.usage, engine, found.model).catch(() => 0);
            return answer;
          },
        };
      },
      said: async (since) => {
        // A quiet chat stays private from nightly learning and legacy rechecks too.
        if (!this.learning) return [];
        const quiet = new Set(await this.learning.store.quiet());
        return (await yourWords(conversationStore, since)).filter(
          (s) => !quiet.has(s.conversationId),
        );
      },
      never: (content) => this.learning?.refuses(content) ?? Promise.resolve(true),
      settled: (memory) => this.learning?.settled(memory) ?? Promise.resolve(),
      healed: (message) => void this.healed.note('settings', message),
      settings: async () => {
        const { preferences } = await this.settings.get();
        return {
          autoMemory: preferences.autoMemory,
          tidyMemory: preferences.tidyMemory,
          checkMemories: preferences.checkMemories,
        };
      },
      busy: () => this.conversations.busy(),
      emit: () => this.broadcast.emit({ type: 'memory.changed' }),
    });
    if (!this.recovery.recoveryMode) this.tidy.start();
    this.suggester = new SkillSuggester({
      home: config.CONCH_HOME,
      asked: (since) => yourRequests(conversationStore, since),
      skills: async () =>
        (await this.skills.list()).skills.map((s) => ({
          title: s.title,
          description: s.description,
        })),
      model: () => cheapModel(this.providers.engine()),
      meaning,
    });
    registerLearningDoctor(this.doctor, {
      index: this.memoryIndex,
      store: this.memory,
      tidy: this.tidy,
      model: this.onDevice,
      reindex: () => this.memoryIndex.sync(),
    });
    const muted = async () => (await this.settings.get()).preferences.mutedSuggestions;
    this.offers = new OfferDesk({
      muted,
      // What this provider could turn on now: apps not connected, skills off or waiting to be asked.
      map: async (engine) => {
        const [apps, skills, yours] = await Promise.all([
          this.integrations.connectable(engine).catch(() => undefined),
          this.skills.offerable(engine).catch(() => []),
          // Apps you made or added, switched off (ADR 0061).
          this.conchApps.offerable().catch(() => []),
        ]);
        return {
          apps: [
            ...(apps ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              tagline: a.tagline,
              description: a.description,
              ...(a.color && { color: a.color }),
              featured: a.featured,
            })),
            ...yours,
          ],
          skills,
          providers: (await this.keys.has('openrouter'))
            ? []
            : [
                {
                  id: 'openrouter',
                  name: 'OpenRouter',
                  tagline: 'Make and edit pictures',
                  description:
                    'Generate and edit pictures from any chat model, billed through your OpenRouter API key.',
                  featured: true,
                },
              ],
          // Skills people share, found with `find_skills` (ADR 0074).
          market: Boolean(this.market),
        };
      },
      suggest: (text, engine, skip) => this.integrations.suggest(text, engine, skip),
      chat: {
        events: async (id) => (await this.conversations.detail(id)).events,
        taint: (id) => this.conversations.taintOf(id),
        unattended: async (id) =>
          Boolean((await this.conversations.detail(id)).conversation.origin),
        carryOn: (id, offerId, turn) => this.conversations.carryOn(id, offerId, turn),
        dismiss: (id, offerId) => this.conversations.dismissOffer(id, offerId),
      },
      providers: {
        connected: async (id) =>
          id === 'openrouter' &&
          (await this.providers.engineFor('openrouter').detect()).state === 'ready',
      },
      apps: { connected: (id) => this.integrations.connected(id) },
      skills: {
        modeOf: (id) => this.skills.modeOf(id),
        turnOn: (id) => this.skills.turnOn(id),
        once: (id, request) => this.skills.once(id, request),
      },
      ...(this.market && {
        market: {
          offerable: (id: string) => this.market?.offerable(id),
          installedFor: (id: string) => this.market?.installedFor(id),
        },
      }),
    });
    // How each provider charges, asked once a minute at most: chats and routines share it.
    const billings = new Billings();
    this.images = new ImageService({
      key: (id, signal) => this.keys.value(id, { signal }),
      hasKey: (id) => this.keys.has(id),
      // The person's own providers that make pictures themselves (ChatGPT through Codex) go first.
      makers: async () =>
        (await this.providers.ready()).flatMap((engine) =>
          engine.pictures ? [{ engine: engine.id, maker: engine.pictures }] : [],
        ),
      healed: (message) => void this.healed.note('providers', message),
      store: this.attachments,
      overBudget: async () => {
        const { usd, budgetUsd } = await this.usage.month();
        return budgetUsd !== undefined && usd >= budgetUsd;
      },
      spend: (usage, provider) => this.usage.recordTurn(usage, undefined, { engine: provider }),
      offer: async (ctx) => {
        const result = await this.offers.propose({
          conversationId: ctx.conversationId,
          engine: ctx.engine,
          unattended: ctx.unattended,
          kind: 'provider',
          target: 'openrouter',
          why: 'None of your providers can make pictures. OpenRouter can, for about $0.04 each.',
        });
        if ('offer' in result) {
          ctx.append({ type: 'offer', offer: result.offer });
          return 'None of their connected providers can make pictures (a ChatGPT plan through Codex, or an OpenAI or Gemini API key, would). A card to connect OpenRouter, which bills about $0.04 a picture, is under this reply; once connected, the image request carries on. Signing in with ChatGPT in Settings → Providers works too.';
        }
        return 'None of their connected providers can make pictures. Signing in with ChatGPT, or adding an OpenAI, Gemini or OpenRouter API key, in Settings → Providers makes it possible. No image was generated.';
      },
    });
    this.files = new FileMaker({ store: this.attachments, printer: this.#printer });
    const fetchPublicWeb = publicWebFetcher(config.CONCH_PORT);
    this.finance = new FinanceSource({ fetcher: fetchPublicWeb });
    this.favicons = new Favicons({ fetcher: faviconFetcher(config.CONCH_PORT) });
    this.workplaces = new WorkPlaces({
      home: config.CONCH_HOME,
      defaultPlace: async () => (await this.settings.get()).preferences.place,
      heal: (message) => void this.healed.note('terminal', message),
    });
    this.doctor.register(this.workplaces.doctorCheck());
    // Dashboards (ADR 0121): it only listens, and reads each gauge when asked.
    this.telemetry = new TelemetryService({
      home: config.CONCH_HOME,
      version: SERVER_VERSION,
      heal,
      redact: () => {
        const known = this.vault.redactor();
        return (text) => new Redaction({ known, home: homedir() }).text(text);
      },
      gauges: {
        resources: () => sampleResources(),
        disk: () => diskOf(config.CONCH_HOME),
        memories: async () => (await this.memory.list()).length,
        skills: async () => (await this.skills.list()).skills.length,
        agents: () => this.agents.list(),
        providers: async () => {
          const ready = new Set((await this.providers.ready()).map((engine) => engine.id));
          const connected = await this.providers.connected();
          return [...new Set([...connected, ...ready])].map((id) => ({ id, ready: ready.has(id) }));
        },
      },
    });
    this.doctor.register(this.telemetry.doctorCheck());
    // Waiting for something until it changes (ADR 0125): Conch watches; the model sleeps.
    let ghSignedIn: { at: number; path?: string } | undefined;
    this.waits = new WaitService({
      home: config.CONCH_HOME,
      processes: this.processes,
      fetcher: fetchPublicWeb,
      // GitHub's own program when it's signed in, else the GitHub app's token, else nobody's.
      github: async (owner) => {
        if (!ghSignedIn || Date.now() - ghSignedIn.at > 5 * 60_000) {
          const path = await findGh().catch(() => undefined);
          const ok = path
            ? await realRun(path, ['auth', 'status'], {}).then(
                () => true,
                () => false,
              )
            : false;
          ghSignedIn = { at: Date.now(), ...(ok && path && { path }) };
        }
        if (ghSignedIn.path) return ghClient(ghSignedIn.path);
        const token = await this.integrations.tokenOf('github').catch(() => undefined);
        return fetchClient(fetchPublicWeb, owner, token);
      },
      git: (cwd, args) => realRun('git', ['-C', cwd, ...args], {}),
      chat: {
        note: (id, event) => this.conversations.note(id, event),
        wake: (id, prompt) => this.conversations.wake(id, prompt),
        taint: (id, sources) => this.conversations.addTaint(id, sources),
      },
      tell: async (told) => {
        await this.push
          .notify('tasks', {
            title: told.title,
            body: told.body,
            url: `/c/${told.conversationId}`,
            tag: `wait-${told.waitId}`,
          })
          .catch(() => undefined);
        await this.channels.tellOwner(`**${told.title}**\n${told.body}`).catch(() => undefined);
      },
    });
    this.conversations = new ConversationManager({
      judged: (verdict, risk) => this.telemetry.auto(verdict, risk),
      // Who each chat is with: its persona and instructions in every turn (ADR 0101).
      agents: this.agents,
      // What each turn costs, what a chat has spent, and its limits (ADR 0079).
      spend: new ChatSpendDesk({
        billings,
        usage: () => this.usage,
        catalog: () => this.providers.models(),
        engineFor: (id) => this.providers.engineFor(id),
        task: (id) => this.tasks.get(id),
      }),
      store: conversationStore,
      settings: this.settings,
      memory: this.memory,
      memoryIndex: this.memoryIndex,
      // The memory check's second look (ADR 0087): the default provider's cheapest model.
      memoryLook: () => cheapModel(this.providers.engine()),
      // Auto's second look at an unusual command after reading (ADR 0100): the same model.
      riskLook: () => cheapModel(this.providers.engine()),
      // A new chat's title (ADR 0103): its own provider, else another with room, else this computer.
      titleModel: async (id) => {
        const picked = await this.#smallFor(id, 'plan');
        return 'small' in picked ? picked.small.engine : undefined;
      },
      engine: (id) => this.providers.engineFor(id),
      route: (engine, context) => this.route(engine, context),
      describe: (engine, model) => this.describer.for(engine, model),
      // An engine that can't run Conch's own tools is never offered them.
      tools: (ctx) =>
        ctx.engine.hostTools === false
          ? []
          : [
              currentTimeTool(),
              ...fileTools(ctx, () => this.#fileAccess(ctx), this.attachments),
              ...documentTools(ctx, () => this.#fileAccess(ctx), this.attachments),
              ...publishTools(ctx, () => this.#fileAccess(ctx), this.attachments),
              ...this.files.tools(ctx, () => this.#fileAccess(ctx)),
              ...researchTools(ctx, fetchPublicWeb),
              weatherTool(ctx, fetchPublicWeb),
              ...chartTools(),
              ...recipeTools(ctx, { fetcher: fetchPublicWeb, store: this.attachments }),
              ...productTools(ctx, { fetcher: fetchPublicWeb, store: this.attachments }),
              ...placesTools(ctx, fetchPublicWeb, this.attachments),
              ...musicTools(ctx, { fetcher: fetchPublicWeb, store: this.attachments }),
              ...videoTools(ctx, { fetcher: fetchPublicWeb, store: this.attachments }),
              ...knowledgeTools(ctx, { fetcher: fetchPublicWeb, store: this.attachments }),
              ...financeTools(ctx, { source: this.finance }),
              ...this.processes.tools(ctx),
              ...this.waits.tools(ctx),
              ...this.images.tools(ctx, () => this.#fileAccess(ctx)),
              ...this.routines.tools(ctx),
              // Offering a standing order (ADR 0107): a draft for a card, only where someone can press it.
              ...standingOrderTools(this.standingOrders, ctx),
              ...this.skills.tools(ctx),
              ...this.browser.tools(ctx),
              ...computerTools(this.computerUse, ctx),
              ...vaultTools(this.vault, ctx),
              ...this.artifacts.tools(ctx),
              // A routine's run hands nothing off: what it starts would spend past its own
              // limits (ADR 0057) and outlive it. A task doesn't either (one level, ADR 0033).
              ...(ctx.origin?.kind === 'routine' ? [] : this.tasks.tools(ctx)),
              // Only the Google apps that are connected and on, without the tools turned off.
              ...this.googleApps.tools(
                googleTools(
                  this.google,
                  ctx,
                  (draft) =>
                    this.tasks.createDraft({ parentConversationId: ctx.conversationId, draft }),
                  {
                    // Allow or Ask, as the person set "Send an email" and "Save a draft" (ADR 0104).
                    chosen: (name) => this.googleApps.chosen(name),
                    // An email's files: this chat's own, by id (as message_user sends them).
                    files: (ids) => filesOf(this.attachments, ids, ctx.conversationId),
                  },
                ),
                ctx,
              ),
              ...offeredSlackTools(this.slack, ctx),
              // Writing to you in your chat apps: Telegram, WhatsApp, Slack… (any that's connected).
              ...channelTools(this.channels, ctx),
              // Apps you made or added, and making them: never where nobody can press the card.
              ...this.conchApps.hosted.tools(ctx),
              ...makerTools(this.conchApps, {
                ...ctx,
                // A picture for an app's icon (ADR 0090): from the chat's files, or the public web.
                files: () => this.#fileAccess(ctx),
                fetcher: fetchPublicWeb,
                lastMessage: async () =>
                  (
                    await this.conversations.detail(ctx.conversationId).catch(() => undefined)
                  )?.events.findLast((e) => e.type === 'user.message')?.text,
              }),
              ...questionTools(this.questions, ctx),
              // One script that calls the tools above, every call through the same gate (ADR 0123).
              ...scriptTools(ctx),
              // Offer what this request is missing (ADR 0060): never to nobody.
              ...(ctx.unattended ? [] : offerTools(this.offers, ctx)),
              // Skills people share, to offer (ADR 0074): never to nobody.
              ...(ctx.unattended || !this.market ? [] : marketTools(this.market, ctx)),
              // Your earlier chats, never in a chat with someone else in it (ADR 0059).
              ...pastChatTools(
                {
                  search: this.search,
                  about: (id) => this.#chatFacts(id),
                  redact: this.vault.redactor(),
                },
                ctx,
              ),
            ],
      // In a fixed order, empty where a section has nothing: each is compared on its own (ADR 0085).
      context: async (engine, conversationId) => [
        engine.hostTools === false ? '' : await this.routines.promptSection(),
        // What the person asked for every chat, in their words; never a permission (ADR 0107).
        await this.standingOrders
          .promptSection({ tools: engine.hostTools !== false })
          .catch(() => ''),
        await this.skills.promptSection(engine).catch(() => ''),
        await this.browser.promptSection(engine).catch(() => ''),
        // Your apps (ADR 0110): only where the tool is, in a chat someone is watching.
        engine.hostTools === false ||
        (await this.conversations.detail(conversationId).catch(() => undefined))?.conversation
          .origin
          ? ''
          : computerPrompt(this.computerUse),
        await this.integrations.promptSection(),
        // The map, beside the apps: only for providers that can call `offer` (ADR 0060).
        engine.hostTools === false
          ? ''
          : await this.offers.section(engine, conversationId).catch(() => ''),
        engine.hostTools === false ? '' : await this.slack.promptSection().catch(() => ''),
        // Making apps (ADR 0061): only where the maker's tools are, and someone can press the card.
        engine.hostTools === false
          ? ''
          : await appsPrompt(this.conchApps, conversationId, {
              tools: !(await this.conversations.detail(conversationId).catch(() => undefined))
                ?.conversation.origin,
            }).catch(() => ''),
        engine.hostTools === false ? '' : this.vault.promptSection(),
        this.artifacts.promptSection(engine.hostTools !== false),
        await this.artifacts.editedSection(conversationId).catch(() => ''),
        engine.hostTools === false ? '' : await this.tasks.promptSection(engine).catch(() => ''),
        // Only where someone is there to answer (not a routine, a task or a chat app).
        engine.hostTools === false ||
        (await this.conversations.detail(conversationId).catch(() => undefined))?.conversation
          .origin
          ? ''
          : QUESTIONS_PROMPT,
        engine.hostTools === false ? '' : await this.#pastChatsPrompt(conversationId),
      ],
      expand: (text) => this.skills.expand(text),
      // A chat-only model and a message that needs an app: offer one that can (ADR 0050).
      appsNeeded: (input) =>
        appsNeeded(
          {
            about: (text) => this.integrations.about(text),
            catalog: () => this.providers.models(),
            defaults: async () => {
              const { preferences } = await this.settings.get();
              return {
                engine: this.engine().id,
                ...(preferences.model && { model: preferences.model }),
              };
            },
          },
          input,
        ),
      integrations: this.integrations,
      offers: this.offers,
      attachments: this.attachments,
      stopProcesses: (id) => this.processes.stopAll(id),
      recovery: {
        allowed: () => this.recovery.allowsWork,
        workload: () => this.processes.workload,
      },
      redact: this.vault.redactor(),
      protectedPaths: protectedPaths(config.CONCH_HOME),
      // The sealed box, only where this computer can do it (ADR 0028).
      undo: this.undo,
      sandbox: (workspace) =>
        sandboxSupport().available
          ? sandboxFor(workspace, {
              protectedPaths: protectedPaths(config.CONCH_HOME),
              home: config.CONCH_HOME,
            })
          : undefined,
      places: (id) => this.workplaces.forTurn(id),
      skillPermissions: (skillId) => this.skills.permissions(skillId),
      questions: this.questions,
      // A spend that can't be saved is lost, not fatal: an unhandled rejection would stop Conch.
      // Naming a chat on a plan costs no money (ADR 0079).
      onSpend: (usage, engine) =>
        void billings
          .of(engine)
          .then((info) => this.usage.recordTurn(usage, turnCost(usage, info, undefined)))
          .catch(() => undefined),
      // Over the monthly budget, a turn checks in sooner (ADR 0085); it never blocks (ADR 0005).
      overBudget: async () => {
        const { usd, budgetUsd } = await this.usage.month();
        return budgetUsd !== undefined && usd >= budgetUsd;
      },
      // Before a long chat's start is summarised, what you said there is learned (ADR 0055, ADR 0088).
      learn: async ({ conversationId, beforeSeq }) => {
        await this.learning.review(conversationId, { trigger: 'compaction', beforeSeq });
      },
      // Preferences near the question, quiet chats, what never to learn again (ADR 0088).
      learning: {
        nearby: (said) => this.learning.nearby(said),
        isQuiet: (id) => this.learning.isQuiet(id),
        refuses: (content) => this.learning.refuses(content),
      },
      heal: (message) => void this.healed.note('conversations', message),
    });
    // What unattended runs spend, and its guards (ADR 0057).
    this.routineSpend = new RoutineSpend({
      home: config.CONCH_HOME,
      engine: (id) => this.providers.engineFor(id),
      heal,
      billings,
      changed: () =>
        void this.routines
          .spending()
          .then((spending) => {
            if (spending) this.broadcast.emit({ type: 'routines.spending', spending });
          })
          .catch(() => undefined),
      // Once a month, wherever the person hears from Conch.
      paused: (spending) => {
        void this.push.routinesPaused(spending).catch(() => undefined);
        void this.channels.routinesPaused(spending).catch(() => undefined);
      },
    });
    this.routines = new RoutineService({
      allowed: () => this.recovery.allowsWork,
      store: new RoutineStore(join(config.CONCH_HOME, 'routines'), heal),
      conversations: this.conversations,
      engine: (id) => this.providers.engineFor(id),
      emit: (event) => this.broadcast.emit(event),
      onHeal: (message) => void this.healed.note('routines', message),
      spend: this.routineSpend,
      when: this.#when(config, heal),
    });
    this.doctor.register(routinesWatchCheck(this.routines));
    // The check-in (ADR 0107): the When-routines' own sources, routines' spending, no model until something's new.
    this.standingOrders = new StandingOrderStore(config.CONCH_HOME, {
      heal,
      changed: () => void this.checkins.look().catch(() => undefined),
    });
    this.checkins = new CheckIns({
      home: config.CONCH_HOME,
      orders: this.standingOrders,
      sources: {
        mail: mailSource(gmailAccess(this.google, this.googleApps)),
        calendar: calendarSource(calendarAccess(this.google, this.googleApps)),
      },
      model: () => cheapModel(this.providers.engine()),
      spend: {
        allow: async () => {
          const allowed = await this.routineSpend.allow('check-in', this.providers.engine());
          return allowed.ok ? { ok: true } : { ok: false, message: allowed.message };
        },
        record: async (usage, model) =>
          (
            await this.routineSpend.record('check-in', usage, {
              engine: this.providers.engine(),
              ...(model && { model }),
            })
          ).usd,
      },
      tell: async (thing) => {
        const words = tellWords(thing);
        await this.push
          .notify('routines', {
            title: words.title,
            body: words.body,
            quiet: words.quiet,
            url: '/routines?checkin=1',
            tag: `checkin-${thing.id}`,
          })
          .catch(() => undefined);
        await this.channels.tellOwner(words.markdown).catch(() => undefined);
      },
      allowed: () => this.recovery.allowsWork,
      heal,
      onHeal: (message) => void this.healed.note('routines', message),
    });
    this.doctor.register(checkInCheck(this.checkins));
    this.tasks = new TaskService({
      allowed: () => this.recovery.allowsWork,
      store: new TaskStore(config.CONCH_HOME, heal),
      conversations: this.conversations,
      engine: (id) => this.providers.engineFor(id),
      settings: this.settings,
      emit: (event) => this.broadcast.emit(event),
      home: config.CONCH_HOME,
      overBudget: async () => {
        const { spend } = await this.usage.snapshot();
        return spend.budget !== undefined && spend.month >= spend.budget;
      },
      // A helper may be handed to any provider that's ready, not only the chat's own.
      ready: () => this.providers.ready(),
    });
    this.doctor.register(tasksCheck(this.tasks));
    this.rounds = new RoundService({
      chats: this.conversations,
      agents: this.agents,
      outside: this.outside,
    });
    this.doctor.register(outsideCheck(this.outside));
    this.doctor.register(this.processes.doctorCheck());
    this.doctor.register(
      this.waits.doctorCheck(async (id) =>
        Boolean(await this.conversations.detail(id).catch(() => undefined)),
      ),
    );
    // Your other apps, reaching Conch through its door (ADR 0073).
    this.mcp = new McpService({
      store: new McpClientStore(config.CONCH_HOME),
      // Another agent may be given one of yours to talk to (ADR 0112).
      agents: () => this.agents.list().then((list) => list.agents),
      conversations: this.conversations,
      engineId: () => this.engine().id,
      memory: this.memory,
      checkMemories: async () => (await this.settings.get()).preferences.checkMemories,
      search: (query) => this.memoryIndex.search(query),
      skills: this.skills,
      apps: {
        list: async () => (await this.integrations.list()).integrations,
        hosted: (id) =>
          this.googleApps.owns(id) || this.slackApps.owns(id) || this.conchApps.hosted.owns(id),
        forTurn: (prompt) => this.integrations.forTurn(prompt),
        bridge: (servers, disallowed) => this.integrations.bridge(servers, disallowed),
      },
    });
    this.mcpPairing = new McpPairing({
      mcp: this.mcp,
      sessions: this.mcpSessions,
      port: config.CONCH_PORT,
      address: () => this.address.status().url,
      onHeal: (message) => void this.healed.note('integrations', message),
    });
    this.doctor.register(mcpCheck(this.mcpPairing));
    // Save how I did this (ADR 0058): work that went well, offered as a skill, never saved by itself.
    this.learner = new SkillLearner({
      home: config.CONCH_HOME,
      chat: async (id) => {
        const { conversation, events } = await this.conversations.detail(id);
        return {
          title: conversation.title,
          status: conversation.status,
          events,
          ...(conversation.origin && { origin: conversation.origin }),
        };
      },
      skills: async () =>
        (await this.skills.list()).skills.map((s) => ({
          title: s.title,
          description: s.description,
        })),
      // The chat's own provider has seen it already; else another with room; else one
      // on this computer (`providers/small.ts`).
      model: async (id) => {
        const own = id ? this.providers.engineFor(id) : undefined;
        const picked = await this.#smallModel(own, { private: false });
        return 'small' in picked ? picked.small : undefined;
      },
      workspace: () => this.settings.workspace(),
      redact: this.vault.redactor(),
      emit: (event) => this.broadcast.emit(event),
      onSpend: (usage) => void this.usage.recordTurn(usage).catch(() => undefined),
      heal,
    });
    this.broadcast.on((event) => this.learner.onEvent(event));
    this.broadcast.on((event) => this.telemetry.observe(event));
    // Every way a skill is used ends in `skill.used`: the tidy shelf counts them all.
    this.conversations.events.on((event) => {
      const used = skillUsedIn(event);
      if (used) this.skills.used(used);
    });
    this.conversations.events.on((event) => this.broadcast.emit(event));
    // Each task follows its own chat: what it's doing, what it did (ADR 0033).
    this.broadcast.on((event) => this.tasks.onEvent(event));
    // A deleted chat takes its browser tab, thumbnails and tasks' cards with it.
    this.conversations.events.on((event) => {
      if (event.type === 'conversation.deleted') {
        void this.browser.forget(event.conversationId);
        this.computerUse.forgetChat(event.conversationId);
        void this.tasks.forgetChat(event.conversationId).catch(() => undefined);
        // Its draft, and the files only that draft held.
        void this.drafts
          .remove(event.conversationId)
          .then((ids) => Promise.all(ids.map((id) => this.attachments.discard(id))))
          .catch(() => undefined);
        this.waits.forget(event.conversationId);
      }
    });
    this.memory.changed.on(() => this.broadcast.emit({ type: 'memory.changed' }));
    this.usage = new UsageService({
      home: config.CONCH_HOME,
      heal,
      engine: (id) => (id ? this.providers.engineFor(id) : this.engine()),
      engines: () => [...this.engines.values()],
      history: () => turnCosts(conversationStore),
    });
    this.usage.changed.on((usage) => this.broadcast.emit({ type: 'usage.changed', usage }));
    // Each turn's money is counted by the chat as it ends (ADR 0079), so it can say when the month nears its budget.
    this.usage.start();
    // Quiet learning (ADR 0088): each chat you were in, read once it goes quiet.
    this.learningSpend = new LearningSpend({
      home: config.CONCH_HOME,
      billings,
      heal,
      changed: () => this.broadcast.emit({ type: 'learning.changed' }),
    });
    this.learning = new QuietLearning({
      home: config.CONCH_HOME,
      memory: this.memory,
      search: (query, limit) => this.memoryIndex.search(query, limit),
      spend: this.learningSpend,
      chats: () => this.conversations.list(),
      // What's happened, not what's reached the disk yet.
      events: async (id) =>
        (await this.conversations.detail(id).catch(() => undefined))?.events ??
        conversationStore.events(id),
      // The provider that answered the chat has seen it already; else one on this
      // computer; else any connected one that can write a short answer.
      // The chat's own provider, else another with room, else one on this computer
      // (`providers/small.ts`). When none may be asked, its own, so the look says why it waits.
      model: async (id) => {
        const own = id ? this.providers.engineFor(id) : this.engine();
        const picked = await this.#smallModel(own, { private: false });
        if ('small' in picked) return picked.small;
        const cheap = await cheapModel(own);
        return cheap && { engine: own, ...cheap };
      },
      settings: async () => ({ autoMemory: (await this.settings.get()).preferences.autoMemory }),
      overBudget: async () => {
        const { usd, budgetUsd } = await this.usage.month();
        return budgetUsd !== undefined && usd >= budgetUsd;
      },
      note: (id, event) => this.conversations.note(id, event),
      changed: () => this.broadcast.emit({ type: 'learning.changed' }),
      meaning,
      redact: this.vault.redactor(),
      // Priced the way its provider charges, so a key's calls count against the budget.
      onSpend: (usage, engine) =>
        void recordSmallSpend(
          (u, priced) => this.usage.recordTurn(u, priced),
          billings,
          usage,
          engine,
        ).catch(() => undefined),
      heal,
      // The mock engine's chats go quiet in seconds, so tests and `pnpm dev:mock` see it.
      ...(mock && { idleMs: 8_000, sweepMs: 2_000 }),
    });
    this.conversations.events.on((event) => {
      // An archived chat is read at once.
      if (
        event.type === 'conversation.updated' &&
        event.conversation.archivedAt &&
        event.conversation.status === 'idle'
      )
        void this.learning
          .review(event.conversation.id, { trigger: 'archived' })
          .catch(() => undefined);
      // What the assistant remembered in a chat goes in the record too, for Why? and the timeline.
      if (
        event.type === 'conversation.event' &&
        event.event.type === 'memory.saved' &&
        event.event.memory.source === 'agent'
      ) {
        const { memory, conversationId } = event.event;
        void conversationStore
          .get(conversationId)
          .then((chat) =>
            this.learning.remembered(memory, {
              id: conversationId,
              ...(chat && { title: chat.title }),
            }),
          )
          .catch(() => undefined);
      }
    });
    if (!this.recovery.recoveryMode) this.learning.start();
    if (!this.recovery.recoveryMode) this.checkins.start();
    registerQuietLearningDoctor(this.doctor, this.learning);
    // Story headlines and "Why?" (ADR 0103): learning's rules for who reads a chat and what it costs.
    const small: SmallModelDeps = {
      pick: (id) => this.#smallFor(id),
      spent: (usage, engine, model) => {
        void recordSmallSpend(
          (u, priced) => this.usage.recordTurn(u, priced),
          billings,
          usage,
          engine,
          model,
        ).catch(() => undefined);
        void this.learningSpend.record(usage, engine, model).catch(() => 0);
      },
    };
    this.stories = new StoryTitler({
      ...small,
      enabled: async () => (await this.settings.get()).preferences.autoTitle,
      // A page fetching its data or an app's client: nobody watches its steps.
      watched: async (id) => {
        const { origin } = await this.conversations.answering(id);
        return origin?.kind !== 'artifact' && origin?.kind !== 'client';
      },
      note: (id, event) => this.conversations.noteStory(id, event),
    });
    this.conversations.events.on((event) => this.stories.onEvent(event));
    this.explainer = new StoryExplainer({
      ...small,
      events: async (id) => (await this.conversations.detail(id)).events,
    });
    void (this.mockVendor?.start() ?? Promise.resolve()).then(() => this.integrations.start());
    this.googleApps.start();
    this.activity = new Activity({
      list: () => conversationStore.list(),
      // What's happening now, not what's reached the disk yet: a "no" said a moment ago counts.
      events: async (id) =>
        (await this.conversations.detail(id).catch(() => undefined))?.events ??
        conversationStore.events(id),
      undoState: (id) => this.undo.state(id),
    });
    this.search = new SearchService({
      path: join(config.CONCH_HOME, 'search.db'),
      source: {
        // Conch's own chats, and the past chats brought in from other apps (ADR 0111).
        list: async () => [
          ...(await conversationStore.list()),
          ...(await pastSummaries(pastChats)),
        ],
        events: (id) => (isPastChatId(id) ? pastChats.events(id) : conversationStore.events(id)),
        detail: (id) => this.conversations.detail(id),
      },
      heal,
      log: (error) => console.error('[search]', error),
    });
    this.conversations.events.on((event) => this.search.onEvent(event));
    this.search.open();
    // Once you've brought past chats in, the new ones follow by themselves (ADR 0111).
    const keepUp = () => void this.chatImports.keepUp().catch(() => undefined);
    setTimeout(keepUp, 2 * 60_000).unref();
    setInterval(keepUp, 6 * 60 * 60_000).unref();
    // Repair everything looks at every part of Conch (see `doctor/checks.ts`).
    registerCoreChecks(this);
    // Back online: whatever waited goes now, in order.
    this.network.onChange((status) => {
      if (!status.online) return;
      void this.conversations.releaseHeld().then((sent) => {
        if (sent)
          void this.healed.note(
            'gateway',
            sent === 1
              ? 'Sent your message once you were back online'
              : `Sent ${sent} messages once you were back online`,
          );
      });
    });
    this.updates = this.#updates(config);
    this.doctor.register(updatesCheck(this.updates, config.CONCH_HOME));
    this.conversations.events.on((event) => {
      if (event.type === 'conversation.event') this.#lastActivity = Date.now();
    });
    this.backups = new BackupService({
      home: config.CONCH_HOME,
      conchVersion: SERVER_VERSION,
      busy: () => this.conversations.busy(),
      lastActivity: () => this.#lastActivity,
      emit: () => this.broadcast.emit({ type: 'backups.changed' }),
      heal,
      // Passwords travel only in a passphrase-locked backup, with the key that opens them.
      extraSecrets: () => this.vault.backupFiles(),
    });
    this.doctor.register(backupCheck(this.backups));
    this.doctor.register(vaultCheck(this.vault));

    // With the mock engine, channels talk to a pretend Telegram on this machine.
    this.mockTelegram = config.CONCH_ENGINE === 'mock' ? new MockTelegram() : undefined;
    this.mockDiscord = config.CONCH_ENGINE === 'mock' ? new MockDiscord() : undefined;
    this.mockSlack = config.CONCH_ENGINE === 'mock' ? new MockSlack() : undefined;
    this.mockTeams = config.CONCH_ENGINE === 'mock' ? new MockTeams() : undefined;
    this.mockMatrix = config.CONCH_ENGINE === 'mock' ? new MockMatrix() : undefined;
    this.mockWeChat = config.CONCH_ENGINE === 'mock' ? new MockWeChat() : undefined;
    this.mockTwilio = config.CONCH_ENGINE === 'mock' ? new MockTwilio() : undefined;
    this.mockMattermost = config.CONCH_ENGINE === 'mock' ? new MockMattermost() : undefined;
    this.mockLine = config.CONCH_ENGINE === 'mock' ? new MockLine() : undefined;
    this.mockRocketChat = config.CONCH_ENGINE === 'mock' ? new MockRocketChat() : undefined;
    this.mockGoogleChat = config.CONCH_ENGINE === 'mock' ? new MockGoogleChat() : undefined;
    this.mockFeishu = config.CONCH_ENGINE === 'mock' ? new MockFeishu() : undefined;
    this.mockDingTalk = config.CONCH_ENGINE === 'mock' ? new MockDingTalk() : undefined;
    this.mockQq = config.CONCH_ENGINE === 'mock' ? new MockQq() : undefined;
    // In mock mode the "internet" is this computer: what's sent to the public address reaches the door.
    const door: ChannelDoorService = new ChannelDoorService({
      home: config.CONCH_HOME,
      port: config.CONCH_ENGINE === 'mock' ? 0 : config.CONCH_DOOR_PORT,
      tailscale: {
        funnelStatus: (path, target) => this.tailscale.funnelStatus(path, target),
        funnel: (port, path, target) => this.tailscale.funnel(port, path, target),
        unfunnel: (port, path) => this.tailscale.unfunnel(port, path),
      },
      ...(config.CONCH_ENGINE === 'mock' && {
        fetch: (url: string | URL | Request, init?: RequestInit) =>
          fetch(door.localFor(String(url)), init),
      }),
      onHeal: (message) => void this.healed.note('channels', message),
      // Read when asked, so the address (made further on) is always the current one.
      conchAddress: () => {
        const name = this.address.name();
        return name && this.address.status().state === 'ready' ? `https://${name}` : undefined;
      },
    });
    this.door = door;
    if (this.mockTeams) this.mockTeams.resolve = (url) => door.localFor(url);
    if (this.mockTeams) this.mockTeams.deliveryOrigin = () => door.local;
    if (this.mockWeChat) this.mockWeChat.resolve = (url) => door.localFor(url);
    if (this.mockWeChat) this.mockWeChat.deliveryOrigin = () => door.local;
    if (this.mockTwilio) this.mockTwilio.resolve = (url) => door.localFor(url);
    if (this.mockTwilio) this.mockTwilio.deliveryOrigin = () => door.local;
    if (this.mockLine) this.mockLine.resolve = (url) => door.localFor(url);
    if (this.mockLine) this.mockLine.deliveryOrigin = () => door.local;
    if (this.mockGoogleChat) this.mockGoogleChat.resolve = (url) => door.localFor(url);
    if (this.mockGoogleChat) this.mockGoogleChat.deliveryOrigin = () => door.local;
    this.mockMail = config.CONCH_ENGINE === 'mock' ? new MockMail() : undefined;
    this.mockMessages = config.CONCH_ENGINE === 'mock' ? new MockMessages() : undefined;
    this.linked = linkedChannels({
      home: config.CONCH_HOME,
      mock: config.CONCH_ENGINE === 'mock',
      heal,
    });
    const endpoints: ChannelEndpoints = {
      door,
      home: config.CONCH_HOME,
      whatsapp: this.linked.whatsapp,
      signal: this.linked.signal,
      ...(this.mockMessages && { imessage: this.mockMessages.endpoints }),
    };
    const messages = this.mockMessages;
    this.#channelStore = new ChannelStore(config.CONCH_HOME, heal);
    this.channels = new ChannelService({
      store: this.#channelStore,
      conversations: this.conversations,
      attachments: this.attachments,
      settings: this.settings,
      agents: this.agents,
      models: () => this.providers.models(),
      address: () => this.address.status().url,
      saveSettings: async (patch) => {
        if (patch.preferences?.engine) await this.providers.use(patch.preferences.engine);
        const learnedBefore = (await this.settings.get()).preferences.autoMemory;
        await this.settings.update(patch);
        if (!learnedBefore && patch.preferences?.autoMemory === true)
          await this.learning.resumed().catch(() => undefined);
      },
      adapter: (secrets) => adapterFor(secrets, endpoints),
      slack: (parts) => slackCheckFor(parts, endpoints),
      emit: (event) => this.broadcast.emit(event),
      onHeal: (message) => void this.healed.note('channels', message),
      routineTitle: async (id) =>
        (await this.routines.detail(id).catch(() => undefined))?.routine.title,
      // `/name` in a chat app runs your command or skill of that name, as in Conch (ADR 0098).
      commands: {
        custom: () => this.commands.list(),
        skills: async () =>
          (await this.skills.store.list()).skills
            .filter((s) => s.mode !== 'off' && !s.problem)
            .map((s) => s.name),
      },
      // The pretend Messages works anywhere; the real one only on a Mac.
      platform: messages ? 'darwin' : process.platform,
      // Voice notes are heard on this computer (ADR 0077); `voice` is made just below.
      voice: {
        hearing: (wav) => this.voice.hearing(wav),
        transcribeNote: (bytes, language) => this.voice.transcribeNote(bytes, language),
        getModel: () => this.voice.getModel(),
      },
      speech: { voiceNote: (markdown, format) => this.speech.voiceNote(markdown, format) },
      // Chat apps that Conch apps bring (ADR 0122); `extensions` is made just below.
      apps: {
        catalog: () => this.extensions.catalog(),
        name: (app) => this.extensions.name(app),
        trusted: (app) => this.extensions.trusted(app),
      },
      imessage: {
        setup: () => imessageSetup(new ChatDb(messages?.db ?? MESSAGES_DB)),
        open: (place) =>
          openForImessage(
            place,
            messages ? async () => ({ stdout: '', stderr: '', code: 0 }) : undefined,
          ),
      },
    });
    this.feishuScans = new FeishuRegistrations(
      endpoints,
      async (made) => {
        const secrets = {
          kind: 'feishu' as const,
          region: made.region,
          appId: made.appId,
          appSecret: made.appSecret,
        };
        // Who scanned it, by their name in Feishu where the app may read it.
        const scanner = made.openId
          ? await new FeishuAdapter(secrets, endpoints)
              .person(made.openId)
              .catch(() => ({ id: personId(made.openId ?? ''), name: 'You', anonymous: true }))
          : undefined;
        return (await this.channels.createScanned(secrets, scanner)).id;
      },
      async () => (await this.settings.get()).persona.name,
    );
    this.channelLinking = new ChannelLinking({
      linker: (kind) => this.linked.linker(kind),
      finish: (_kind, found, channelId) => this.channels.linked(found, channelId),
      emit: (event) => this.broadcast.emit(event),
    });
    // Providers and chat apps that Conch apps bring (ADR 0122): theirs follow the apps you have.
    this.extensions = new ExtensionService({
      apps: this.conchApps,
      providers: this.providers,
      engine: (variant) => new ApiEngine(variant, this.settings, this.keys),
      channels: () => this.channels,
      door,
      home: config.CONCH_HOME,
      fetchOptions: {
        gatewayPort: config.CONCH_PORT,
        ...(this.pretendWorld && { pretend: this.pretendWorld.route }),
      },
      log: (message) => console.error(`[extensions] ${message}`),
    });
    endpoints.apps = (secrets) => this.extensions.adapter(secrets);
    this.broadcast.on((event) => {
      if (event.type === 'conch-apps.changed') void this.extensions.sync();
    });
    // Conversations and routine runs reach the channels through the same stream as the web app.
    this.broadcast.on((event) => this.channels.onEvent(event));
    door.onChange((now) => this.broadcast.emit({ type: 'channel.door', door: now }));
    this.doctor.register(doorCheck(door));
    this.address = new AddressService({
      home: config.CONCH_HOME,
      config,
      gateway: () => {
        if (!this.#gateway) throw new Error('Conch isn’t listening yet.');
        return this.#gateway;
      },
      // A proxy of the person's own sends requests here: the gateway, on this computer.
      target: () => {
        const host = config.CONCH_HOST;
        const local = /^(0\.0\.0\.0|::)$/.test(host) ? '127.0.0.1' : host;
        return `http://${local.includes(':') ? `[${local}]` : local}:${config.CONCH_PORT}`;
      },
      // Teams and WeChat reach the door at https://<name>/conch/… too, never the gateway.
      door: () => {
        const local = door.local;
        return local ? Number(new URL(local).port) : undefined;
      },
      heal,
    });
    this.address.onChange((now) => {
      this.gate.hosts.setOwnAddress(this.address.name());
      this.broadcast.emit({ type: 'address.changed', address: now });
      // Teams and WeChat's door can use it now (or can't any more).
      door.addressChanged();
    });
    this.doctor.register(addressCheck(this.address));
    this.background = this.#background(config);
    this.push = this.#push(config);
    this.broadcast.on((event) => void this.push.onEvent(event).catch(() => undefined));
    this.gate.signedOut.on((ids) => {
      const pending = this.push
        .forget(ids.map((id) => `session:${id}`))
        .catch((error: unknown) =>
          console.error('[push] Could not forget signed-out devices', error),
        )
        .finally(() => this.#pushRevocations.delete(pending));
      this.#pushRevocations.add(pending);
    });
    this.tailscale = new Tailscale({
      port: () => config.CONCH_PORT,
      onName: (name, serving) => this.gate.hosts.setTailscale(name, serving),
      ...(config.CONCH_ENGINE === 'mock' && pretendTailscale()),
    });
    this.doctor.register(pushCheck(this.push, this.tailscale));
    const need = (id: string) => {
      const spec = KNOWN_NEEDS.get(id);
      return spec ? this.setup.path(spec) : Promise.resolve(undefined);
    };
    const desktop = theApp();
    this.voice = new VoiceService({
      home: config.CONCH_HOME,
      wake: Boolean(desktop),
      // The mock engine never finds (or downloads) a real speech model.
      whisper: async () => (config.CONCH_ENGINE === 'mock' ? undefined : need('whisper')),
      ffmpeg: async () => (config.CONCH_ENGINE === 'mock' ? undefined : need('ffmpeg')),
      emit: (status) => {
        this.broadcast.emit({ type: 'voice.changed', status });
        // The speech model just arrived: voice notes that waited for it are heard now.
        if (status.private.state === 'ready') void this.channels.hearAgain().catch(() => undefined);
      },
    });
    void this.voice.sweep();
    this.doctor.register(this.voice.doctorCheck());
    this.speech = new SpeechService({
      home: config.CONCH_HOME,
      // The mock engine never finds Piper, so tests never download a voice.
      piper: async () => (config.CONCH_ENGINE === 'mock' ? undefined : need('piper')),
      ffmpeg: async () => (config.CONCH_ENGINE === 'mock' ? undefined : need('ffmpeg')),
      // Only a key that's already here: reading aloud never raises a 1Password prompt.
      openaiKey: () => this.keys.value('openai', { peek: true }),
      chosen: async () => (await this.settings.get()).preferences.voice,
    });
    this.doctor.register(this.speech.doctorCheck());
    this.wake = new WakeWord({
      ...(desktop && { app: { send: (message) => desktop.send(message) } }),
      voice: this.voice,
      // "Hey Pearl": the phrase follows the default agent's name (ADR 0108).
      name: async () => (await this.agents.default()).name,
    });
    // "Stop listening" in the tray: the window stops too.
    desktop?.listen((message) => {
      if (message.type !== 'wake.stop') return;
      void this.wake.state(false);
      this.broadcast.emit({ type: 'wake.stop' });
    });
    this.doctor.register(computerUseCheck(this.computerUse));
    this.doctor.register(this.artifacts.doctorCheck());
    this.doctor.register(this.artifacts.liveDataCheck());
    // A reply from a provider without Conch's tools may carry ```artifact blocks.
    this.broadcast.on((event) => void this.artifacts.onEvent(event).catch(() => undefined));
    this.doctor.register(
      safetyCheck(this.settings, undefined, {
        providers: () =>
          providerCoverage({
            providers: () => this.providers.ready(),
            sealing: async () => (await this.settings.get()).preferences.sealedCommands,
          }),
        skills: async () => (await this.skills.list()).skills,
      }),
    );
    this.doctor.register(this.background.doctorCheck());
    this.doctor.register(trayCheck(this.tray));
    this.imports = this.#imports(config);
    this.doctor.register(importCheck(this.imports));
    // Agents an older Conch brought cut short get the rest of their instructions, quietly (ADR 0101).
    if (!this.recovery.recoveryMode)
      void this.imports
        .finishCutShort()
        .then((done) => {
          for (const one of done)
            void this.healed.note(
              'agents',
              `Brought the rest of ${one.name}’s instructions from ${one.label}`,
            );
        })
        .catch(() => undefined);
    const linked = this.linked;
    this.#channelsReady = (async () => {
      if (this.mockTelegram) {
        const port = Number(process.env.CONCH_MOCK_TELEGRAM_PORT ?? 0);
        endpoints.telegram = await this.mockTelegram.start(port);
      }
      if (this.mockDiscord) {
        await this.mockDiscord.start(Number(process.env.CONCH_MOCK_DISCORD_PORT ?? 0));
        endpoints.discord = this.mockDiscord.api;
      }
      if (this.mockSlack) {
        await this.mockSlack.start(Number(process.env.CONCH_MOCK_SLACK_PORT ?? 0));
        endpoints.slack = this.mockSlack.api;
      }
      await linked.start();
      if (this.mockMail) {
        await this.mockMail.start({
          imap: Number(process.env.CONCH_MOCK_IMAP_PORT ?? 0),
          smtp: Number(process.env.CONCH_MOCK_SMTP_PORT ?? 0),
          control: Number(process.env.CONCH_MOCK_MAIL_PORT ?? 0),
        });
        endpoints.email = this.mockMail.endpoints;
      }
      if (this.mockMessages)
        await this.mockMessages.start(Number(process.env.CONCH_MOCK_MESSAGES_PORT ?? 0));
      if (this.mockTeams) {
        await this.mockTeams.start(Number(process.env.CONCH_MOCK_TEAMS_PORT ?? 0));
        endpoints.teamsLogin = this.mockTeams.login;
        endpoints.teamsOpenId = this.mockTeams.openId;
        endpoints.teamsConnectors = [this.mockTeams.serviceUrl];
      }
      // The Matrix homeserver is whatever's typed: the pretend one says where it is.
      if (this.mockMatrix)
        await this.mockMatrix.start(Number(process.env.CONCH_MOCK_MATRIX_PORT ?? 0));
      if (this.mockWeChat) {
        await this.mockWeChat.start(Number(process.env.CONCH_MOCK_WECHAT_PORT ?? 0));
        endpoints.wechat = this.mockWeChat.base;
        endpoints.wecom = this.mockWeChat.socket;
        endpoints.wechatFiles = [this.mockWeChat.base];
      }
      if (this.mockTwilio) {
        await this.mockTwilio.start(Number(process.env.CONCH_MOCK_TWILIO_PORT ?? 0));
        endpoints.twilio = this.mockTwilio.api;
      }
      // The Mattermost server is whatever's typed: the pretend one says where it is.
      if (this.mockMattermost)
        await this.mockMattermost.start(Number(process.env.CONCH_MOCK_MATTERMOST_PORT ?? 0));
      if (this.mockGoogleChat) {
        const base = await this.mockGoogleChat.start(
          Number(process.env.CONCH_MOCK_GOOGLECHAT_PORT ?? 0),
        );
        endpoints.googleChat = base;
        endpoints.googleToken = `${base}/token`;
        endpoints.googleCerts = `${base}/certs`;
        endpoints.googleChatCerts = `${base}/chatcerts`;
      }
      if (this.mockRocketChat)
        await this.mockRocketChat.start(Number(process.env.CONCH_MOCK_ROCKETCHAT_PORT ?? 0));
      if (this.mockLine) {
        await this.mockLine.start(Number(process.env.CONCH_MOCK_LINE_PORT ?? 0));
        endpoints.line = this.mockLine.base;
      }
      if (this.mockFeishu) {
        await this.mockFeishu.start(Number(process.env.CONCH_MOCK_FEISHU_PORT ?? 0));
        endpoints.feishu = this.mockFeishu.base;
        endpoints.feishuAccounts = { feishu: this.mockFeishu.base, lark: this.mockFeishu.base };
      }
      if (this.mockDingTalk) {
        await this.mockDingTalk.start(Number(process.env.CONCH_MOCK_DINGTALK_PORT ?? 0));
        endpoints.dingtalk = this.mockDingTalk.base;
        endpoints.dingtalkOld = this.mockDingTalk.base;
        endpoints.dingtalkFiles = [this.mockDingTalk.base];
      }
      if (this.mockQq) {
        await this.mockQq.start(Number(process.env.CONCH_MOCK_QQ_PORT ?? 0));
        endpoints.qq = this.mockQq.base;
        endpoints.qqFiles = [this.mockQq.base];
      }
      if (this.pretendWorld) await this.pretendWorld.start();
    })();
  }

  /**
   * Updates. The mock engine gets pretend programs, and Conch's own folder
   * only when `CONCH_CHECKOUT` names one: a test never moves a real checkout.
   */
  #updates(config: Config): UpdatesService {
    const mock = config.CONCH_ENGINE === 'mock';
    const programs = mock
      ? mockPrograms(config.CONCH_HOME)
      : { specs: KNOWN_NEEDS, setup: this.setup, lookup: lookup() };
    // The desktop app updates by installing its releases (ADR 0054), never a folder.
    const app = theApp();
    // The folder running: the release the supervisor started (ADR 0051), else the checkout.
    const root = app
      ? undefined
      : process.env.CONCH_RELEASE_ROOT?.trim() ||
        (mock && !config.CONCH_CHECKOUT
          ? undefined
          : findCheckout(import.meta.dirname, config.CONCH_CHECKOUT));
    const conch = root ? new ConchCheckout(root) : undefined;
    // The web app served is this checkout's own, under `pnpm start` (a window or at
    // login): it's kept built from the code that's there. Never a dev server's, a
    // release folder's (ADR 0051), the desktop app's, or one served from elsewhere.
    const running = runningAs();
    const freshWeb = Boolean(
      conch &&
      !process.env.CONCH_RELEASE_ROOT?.trim() &&
      !config.CONCH_WEB_DIST &&
      (running === 'window' || running === 'background') &&
      resolve(conch.dist) === resolve(import.meta.dirname, '../../web/dist'),
    );
    return new UpdatesService({
      home: config.CONCH_HOME,
      ...programs,
      conch,
      freshWeb,
      releases: root
        ? new ReleaseFollower(root, {
            home: config.CONCH_HOME,
            build: SERVER_BUILD,
            // Your things are backed up before a new version is swapped in (ADR 0020).
            backup: async () => void (await this.backups.backupNow()),
          })
        : undefined,
      app:
        app && REPOSITORY
          ? new AppReleases({
              app,
              repository: REPOSITORY,
              version: SERVER_VERSION,
              development: SERVER_BUILD.kind === 'dev',
            })
          : undefined,
      announce: (version) => void this.push.releaseReady(version).catch(() => undefined),
      keep: [process.env.CONCH_SUPERVISOR_ROOT, process.env.CONCH_LEGACY_SUPERVISOR_ROOT].filter(
        (f): f is string => Boolean(f),
      ),
      version: SERVER_VERSION,
      build: SERVER_BUILD,
      bootId: BOOT_ID,
      emit: (status) => this.broadcast.emit({ type: 'updates.changed', status }),
      // Apps from GitHub with an update waiting, beside the programs (ADR 0061).
      apps: () => this.conchApps.updateNotices(),
      heal: (message) => void this.healed.note('updates', message),
      busy: () => this.conversations.busy(),
      working: () => this.conversations.working(),
      pause: () => this.pauseWork('update'),
      unpause: () => this.unpauseWork(),
      landed: (id) => this.#recheckWaiting(id),
      restartable,
      restart,
      schedule: (config.CONCH_UPDATE_CHECKS ?? (mock ? 'off' : 'auto')) === 'auto',
    });
  }

  /**
   * When… (ADR 0056): what can start a routine, each through the part of
   * Conch that already reaches it. Built before the routines, so it reaches
   * the door, the tasks and the routines themselves only when it looks.
   */
  #when(config: Config, heal: Heal): WhenRoutines {
    const ownWrites = new OwnWrites();
    this.broadcast.on((event) => ownWrites.onEvent(event));
    const subscribe = (listener: (event: ServerEvent) => void) => this.broadcast.on(listener);
    const routineOf = async (conversationId: string) => {
      const origin = (await this.conversations.detail(conversationId).catch(() => undefined))
        ?.conversation.origin;
      return origin?.kind === 'routine' ? origin.routineId : undefined;
    };
    const secrets = new HookSecrets(config.CONCH_HOME);
    return new WhenRoutines({
      routinesDir: join(config.CONCH_HOME, 'routines'),
      secrets,
      heal,
      onHeal: (message) => void this.healed.note('routines', message),
      hookUrl: (hookId) => this.door.hookUrl(hookId),
      judge: judgeWith(() => cheapModel(this.providers.engine())),
      // What an only-if check spends counts toward routines' spending (ADR 0057).
      spend: {
        allow: async (routineId) =>
          (
            await this.routineSpend
              .allow(routineId, this.providers.engine())
              .catch(() => ({ ok: true }))
          ).ok,
        record: (routineId, usage, model) =>
          void this.routineSpend
            .record(routineId, usage, {
              engine: this.providers.engine(),
              ...(model && { model }),
            })
            .catch(() => undefined),
      },
      sources: {
        mail: mailSource(gmailAccess(this.google, this.googleApps)),
        calendar: calendarSource(calendarAccess(this.google, this.googleApps)),
        // Through the live-data guard (ADR 0046): never this computer, your network or Conch.
        page: pageSource((url, hosts) =>
          fetchLive(
            url,
            { local: false, gatewayPort: config.CONCH_PORT, hosts },
            { maxBytes: 3_000_000, timeoutMs: 20_000 },
          ),
        ),
        folder: folderSource({
          home: config.CONCH_HOME,
          forbidden: () => [
            ...protectedPaths(config.CONCH_HOME),
            ...secretPlaces().map((p) => p.path),
          ],
          ownWrite: (path) => ownWrites.has(path),
          running: (routineId) => this.routines.busy(routineId),
        }),
        task: taskSource({ subscribe, routineOf }),
        routine: routineSource({
          subscribe,
          routineOf,
          follows: (id) => this.routines.follows(id),
          exists: async (id) => Boolean(await this.routines.detail(id).catch(() => undefined)),
          title: (id) => this.routines.titleOf(id),
        }),
        hook: hookSource({
          secrets,
          door: {
            mount: (hookId, handler) => this.door.mount(hookId, undefined, handler),
            url: (hookId) => this.door.hookUrl(hookId),
            ready: () => this.door.status().state === 'ready',
            onChange: (listener) => this.door.onChange(() => listener()),
          },
        }),
      },
    });
  }

  /**
   * Always on. The mock engine's is pretend, so tests and `pnpm dev:mock`
   * never add anything to this computer's login items.
   */
  #background(config: Config): BackgroundService {
    const mock = config.CONCH_ENGINE === 'mock';
    // The desktop app (ADR 0054) carries its own Conch, and starts itself at login.
    const app = theApp();
    // Conch's checkout itself: the launcher finds the version to run (ADR 0051).
    const checkout = app
      ? resolve(import.meta.dirname, '..', '..', '..')
      : findRepository(import.meta.dirname, config.CONCH_CHECKOUT);
    const backend = mock
      ? pretendBackend()
      : backendFor(config.CONCH_HOME, process.platform, { app: Boolean(app) });
    const spec = {
      node: process.execPath,
      env: carriedEnv(process.env),
      path: process.env.PATH ?? '',
      ...(app && { app: app.exe }),
    };
    const url = `http://localhost:${config.CONCH_PORT}`;
    // The menu bar helper, a little computer's settings (ADR 0029). Pretend ones for the mock engine.
    this.tray = new TrayService({
      home: config.CONCH_HOME,
      checkout: mock ? (checkout ?? config.CONCH_HOME) : checkout,
      url,
      ask: askUrl(config.CONCH_HOST, config.CONCH_PORT),
      spec,
      wanted: async () => (await this.settings.get()).preferences.menuBar,
      setWanted: async (on) => void (await this.settings.update({ preferences: { menuBar: on } })),
      onToken: (token) => this.gate.setTrayToken(token),
      heal: (message) => void this.healed.note('gateway', message),
      ...(mock && pretendTray()),
      // The app's own icon is the menu bar.
      ...(app && { app: { show: (on: boolean) => app.send({ type: 'tray', on }) } }),
    });
    const little = mock
      ? pretendLittle()
      : {
          afterLogout: new AfterLogout({
            systemd: async () => (await backend)?.kind === 'systemd',
          }),
          keepAwake: new KeepAwake(),
        };
    return new BackgroundService({
      tray: this.tray,
      afterLogout: little.afterLogout,
      keepAwake: {
        service: little.keepAwake,
        wanted: async () => (await this.settings.get()).preferences.keepAwake,
        setWanted: async (on) =>
          void (await this.settings.update({ preferences: { keepAwake: on } })),
      },
      home: config.CONCH_HOME,
      checkout: mock ? (checkout ?? config.CONCH_HOME) : checkout,
      running: mock && runningAs() === 'dev' ? 'window' : runningAs(),
      since: Date.now(),
      backend,
      spec,
      needed: () => this.unattended(),
      url,
      // The mock engine's app lands in its own home, never in your Applications. The
      // desktop app was put there by its installer.
      shortcut: app
        ? undefined
        : new Shortcut({
            version: SERVER_VERSION,
            ...(mock && {
              platform: 'linux' as const,
              places: {
                macApp: join(config.CONCH_HOME, 'shortcut', 'Conch.app'),
                startMenu: join(config.CONCH_HOME, 'shortcut', 'Conch.lnk'),
                desktopEntry: join(config.CONCH_HOME, 'shortcut', 'conch.desktop'),
              },
            }),
          }),
      handover: () =>
        stopSoon(
          '🐚  Conch now runs in the background, so you can close this window.\n    It starts by itself when you log in. To stop it: ' +
            cliName() +
            ' quit',
        ),
      heal: (message) => void this.healed.note('gateway', message),
    });
  }

  /** What the menu bar helper shows: counts only, nothing from a chat (ADR 0029). */
  async trayInfo(): Promise<TrayInfo> {
    const [settings, status, conversations, requests, updates] = await Promise.all([
      this.settings.get(),
      this.background.status(),
      this.conversations.list().catch(() => []),
      this.access.requests().catch(() => []),
      this.updates.status().catch(() => undefined),
    ]);
    const latest = updates?.conch.source === 'releases' ? updates.conch.latest : undefined;
    return {
      // The default agent's name, kept in step in settings (ADR 0101).
      name: settings.persona.name,
      alwaysOn: status.on,
      approvals: conversations.filter((c) => c.status === 'awaiting-permission').length,
      devices: requests.filter((r) => !r.rejected && !r.script).length,
      // A new release, in words (ADR 0051): the menu offers to open Updates.
      ...(latest && {
        update: `Conch ${latest.version.replace(/^(\d+\.\d+)\.0$/, '$1')} is ready`,
      }),
      url: `http://localhost:${this.config.CONCH_PORT}`,
    };
  }

  /** Notifications: who's still allowed in, and what each thing is called. */
  #push(config: Config): PushService {
    const push = new PushService({
      store: new PushStore(
        config.CONCH_HOME,
        (area, message) => void this.healed.note(area, message),
      ),
      // The agent of the chat it's about (ADR 0101), else the default agent.
      persona: async (conversationId) =>
        (
          (conversationId &&
            (await this.conversations.agentOf(conversationId).catch(() => undefined))) ||
          (await this.agents.default())
        ).name,
      conversation: async (id) => {
        const chat = await this.conversations.detail(id).catch(() => undefined);
        if (!chat) return undefined;
        const origin = chat.conversation.origin;
        return {
          title: chat.conversation.title,
          routine: origin?.kind === 'routine',
          channel: origin?.kind === 'channel',
          task: origin?.kind === 'task',
          ...(origin?.kind === 'task' && { taskId: origin.taskId }),
          ...(origin?.kind === 'client' && { app: origin.name }),
          workspace: await this.settings.workspace(),
        };
      },
      tasks: async () => (await this.tasks.list()).tasks,
      task: (id) => this.tasks.get(id).catch(() => undefined),
      routineTitle: async (id) =>
        (await this.routines.detail(id).catch(() => undefined))?.routine.title,
      ownerExists: async (owner) => {
        if (owner === 'local') return true;
        const [kind, id = ''] = owner.split(':');
        if (kind === 'device') return this.access.deviceActive(id);
        if (kind === 'session') return this.access.sessionActive(id);
        return false;
      },
    });
    // A device asking to sign in: the devices already in hear about it, once.
    const told = new Set<string>();
    this.gate.devicesChanged.on(() => {
      void this.access.requests().then(async (requests) => {
        for (const r of requests) {
          if (r.rejected || r.script || told.has(r.code)) continue;
          told.add(r.code);
          await push.deviceWaiting(r);
        }
      });
    });
    return push;
  }

  /**
   * What only works while Conch is running, in one sentence: routines that
   * are on, and the chat apps that reach it. Undefined when there's nothing.
   */
  async unattended(): Promise<string | undefined> {
    const routines = (await this.routines.list().catch(() => [])).filter(
      (r) => r.status === 'active',
    ).length;
    const apps = [
      ...new Set(
        (await this.channels.list().catch(() => ({ channels: [] }))).channels
          .filter((c) => c.enabled)
          .map((c) => channelName(c)),
      ),
    ];
    const parts = [
      ...(routines ? [routines === 1 ? 'Your routine' : `Your ${routines} routines`] : []),
      ...apps,
    ];
    if (!parts.length) return undefined;
    const list =
      parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
    const verb =
      parts.length > 1 || routines > 1 ? 'only work' : routines === 1 ? 'only runs' : 'only works';
    return `${list} ${verb} while Conch is running.`;
  }

  #people?: {
    at: number;
    value: Promise<{ people: { address: string; name?: string }[]; note?: string }>;
  };

  /**
   * People you've written to lately, for picking whose mail starts a routine
   * (ADR 0056). Read from Sent at most every ten minutes.
   */
  mailPeople() {
    if (this.#people && Date.now() - this.#people.at < 10 * 60_000) return this.#people.value;
    const value = mailPeople(this.google, this.googleApps)
      .then((people) =>
        people.length
          ? { people }
          : { people, note: 'No one you’ve written to lately. Type an address instead.' },
      )
      .catch(() => ({
        people: [],
        note: 'Connect Gmail to pick from people you write to, or type an address.',
      }));
    this.#people = { at: Date.now(), value };
    return value;
  }

  /**
   * Your past chats from other apps (ADR 0111): found where each app keeps
   * them, read only, kept with secrets taken out, and carried on in a chat of
   * Conch's own with the same provider when it's connected here.
   */
  #chatImports(
    config: Config,
    store: PastChatStore,
    conversations: ConversationStore,
  ): ChatImportService {
    return new ChatImportService({
      store,
      // Pointed at a pretend home (tests, the journeys): nothing the real environment moves counts.
      ...(config.CONCH_IMPORT_HOME && { sourceHome: config.CONCH_IMPORT_HOME, env: {} }),
      redact: this.vault.redactor(),
      // Conch drives Claude Code itself: its sessions behind Conch's own chats are already here.
      ownSessions: async () => {
        const ids = new Set<string>();
        for (const record of await conversations.list()) {
          if (record.resumeId) ids.add(record.resumeId);
          for (const session of Object.values(record.sessions ?? {}))
            if (session?.resumeId) ids.add(session.resumeId);
        }
        return ids;
      },
      changed: () => void this.search?.refresh().catch(() => undefined),
      carryOn: async ({ chat, messages }) => {
        const ready = new Set((await this.providers.ready()).map((e) => e.id));
        const engine = CARRY_ON_WITH[chat.source].find((id) => ready.has(id as EngineId));
        const { conversation, lastSeq } = await this.conversations.adopt({
          title: chat.title,
          messages,
          ...(engine && { options: { engine: engine as EngineId } }),
          taint: { kind: 'app', label: CHAT_SOURCE_LABELS[chat.source] },
        });
        // What another app's chat said is never learned from: only what's said here next.
        await this.learning.broughtIn(conversation.id, lastSeq).catch(() => undefined);
        return conversation.id;
      },
      log: (error) => console.error('[past chats]', error),
    });
  }

  /** Come home: what Conch already has, and where things go when they come over. */
  #imports(config: Config): ImportService {
    return new ImportService({
      home: config.CONCH_HOME,
      ...(config.CONCH_IMPORT_HOME && { sourceHome: config.CONCH_IMPORT_HOME }),
      targets: {
        // About you and the model. A personality comes over as an agent of its own
        // (`agents`, ADR 0101), never into settings: the agent store keeps that in step.
        settings: this.settings,
        memory: this.memory,
        checkMemories: async () => (await this.settings.get()).preferences.checkMemories,
        skills: {
          // Conch's own: another app's skills are only read in place, and go with it.
          names: async () =>
            (await this.skills.store.list()).skills
              .filter((s) => s.source === 'conch')
              .map((s) => s.name),
          // Brought in by Conch: the tidy shelf may offer it back one day (ADR 0058).
          adopt: async (folder, base) => {
            const skill = await this.skills.store.adopt(folder, base);
            await this.skillUsage.note(skill.id, 'imported').catch(() => undefined);
            return skill;
          },
          remove: (id) => this.skills.remove(id),
        },
        routines: {
          // With the agent it ran as there, when that one came over too (ADR 0101).
          create: (input) => this.routines.create(input, { createdBy: 'user' }),
          remove: (id) => this.routines.remove(id),
        },
        // Each agent another app ran becomes one of Conch's (ADR 0101).
        agents: this.agents,
        channels: {
          setAgent: (id, agentId) => this.channels.update(id, { agentId }),
          connect: async (c) => {
            const channel = await this.channels.create(
              c.kind === 'slack'
                ? { kind: 'slack', botToken: c.token ?? '', appToken: c.appToken ?? '' }
                : { kind: c.kind, token: c.token ?? '' },
            );
            return { id: channel.id, name: channel.bot.name, view: channel };
          },
          check: (parts) => this.channels.check({ kind: 'slack', ...parts }),
          remove: (id) => this.channels.remove(id),
        },
        models: {
          catalog: async (fresh) =>
            (await this.providers.models({ force: fresh })).providers.map((p) => ({
              engine: p.engine,
              label: p.label,
              local: p.local,
              models: p.models.map((m) => ({ id: m.id, label: m.label })),
            })),
          // A default model belongs to a default provider, as the model picker sets them.
          choose: async ({ engine, model }) => {
            // Exactly as asked (Undo puts back what was there), then the provider service
            // follows; a provider pinned with CONCH_ENGINE stays the only one.
            await this.settings.update({ preferences: { engine, model } });
            await this.providers.use(engine).catch(() => undefined);
          },
        },
        keys: {
          has: async (provider) => Boolean(await this.keys.describe(provider)),
          set: (provider, value) => this.providers.setKey(provider, value),
          clear: (provider) => this.providers.clearKey(provider),
        },
        backup: () => this.backups.backupNow(),
        progress: (done, total, current) =>
          this.broadcast.emit({ type: 'import.progress', done, total, current }),
      },
    });
  }

  #channelsReady: Promise<void>;

  /** Each provider's sign-in as last detected, for when a fresh look takes too long. */
  readonly #signIns = new Map<EngineId, boolean>();

  async #signedIn(engine: Engine): Promise<boolean> {
    const looked = engine
      .detect()
      .then((status) => {
        const subscribed = status.auth?.method === 'subscription';
        this.#signIns.set(engine.id, subscribed);
        return subscribed;
      })
      .catch(() => this.#signIns.get(engine.id) ?? false);
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(this.#signIns.get(engine.id) ?? false), SIGN_IN_LOOK_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([looked, waited]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A cheap model for a small job around a chat (`providers/small.ts`): `own`
   * first, then another connected provider with room, then one on this
   * computer. `plan` checks only that a plan has room and money stays within
   * the month's budget (a title, counted with the chat); `learning` adds
   * learning's monthly cap (headlines, Why?, quiet learning, skill drafts).
   */
  async #smallModel(
    own: Engine | undefined,
    options: { private: boolean; gate?: 'learning' | 'plan' },
  ): Promise<SmallPick> {
    const order = smallModelOrder(own, await this.providers.ready().catch(() => []), options);
    return pickSmallModel(order, {
      cheap: cheapModel,
      allow: smallAllow(
        { spend: this.learningSpend, month: () => this.usage.month() },
        options.gate,
      ),
    });
  }

  /** The small model for this chat: a private one goes only to its own provider or this computer. */
  async #smallFor(conversationId: string, gate?: 'learning' | 'plan'): Promise<SmallPick> {
    const { engine, origin } = await this.conversations.answering(conversationId);
    const quiet = await this.learning.isQuiet(conversationId).catch(() => true);
    return this.#smallModel(this.providers.engineFor(engine), {
      private: quiet || notYours(origin),
      ...(gate && { gate }),
    });
  }

  /** What looking through earlier chats needs to know about one (ADR 0059); undefined once it's gone. */
  async #chatFacts(id: string): Promise<ChatFacts | undefined> {
    // A past chat from another app (ADR 0111): from outside, so what it says is information.
    if (isPastChatId(id)) {
      const past = await this.chatImports.store.get(id);
      if (!past) return undefined;
      const app = CHAT_SOURCE_LABELS[past.source];
      return {
        title: past.title,
        place: past.project ? `${app}, in ${past.project}` : app,
        taint: [{ kind: 'app', label: app }],
      };
    }
    const found = await this.conversations.detail(id).catch(() => undefined);
    if (!found) return undefined;
    const { conversation, events } = found;
    return {
      title: conversation.title,
      ...(conversation.archivedAt !== undefined && { archivedAt: conversation.archivedAt }),
      ...(conversation.origin && { origin: conversation.origin }),
      taint: heldTaints(events),
    };
  }

  /**
   * How to look back, for the chats that can: not one with someone else's
   * words in it, nor a routine's run, a task or a page's refresh, which don't
   * get Conch's tools.
   */
  async #pastChatsPrompt(conversationId: string): Promise<string> {
    const facts = await this.#chatFacts(conversationId);
    if (!facts || withOthers(facts.taint)) return '';
    if (facts.origin && facts.origin.kind !== 'channel') return '';
    return PAST_CHATS_PROMPT;
  }

  /**
   * The keys Conch itself uses, for Passwords (ADR 0025 § Keys Conch uses):
   * provider keys, integration keys and sign-ins, channel bot keys. Shown
   * read-only; each is changed where it's used.
   */
  async #systemKeys(): Promise<SystemKey[]> {
    const id = (...parts: string[]) =>
      `sys_${createHash('sha256').update(parts.join('\0')).digest('base64url').slice(0, 22)}`;
    const tail = (v: string) => (v.length > 8 ? `…${v.slice(-4)}` : 'saved');
    const out: SystemKey[] = [];
    const engines = [...this.engines].filter(([engineId]) => engineId !== 'mock');
    const described = new Map<EngineId, Awaited<ReturnType<typeof this.keys.describe>>>();
    for (const [engineId] of engines)
      described.set(engineId, await this.keys.describe(engineId).catch(() => undefined));
    // A sign-in is only known by detecting its provider, which can mean starting its program
    // (Codex: ~10s). Passwords never waits on that: the looks run side by side, briefly, and
    // one still going counts as what it last said. Only providers Conch shows are looked at:
    // with CONCH_ENGINE pinned, that one alone.
    const listed = new Set(this.providers.listed());
    const signedIn = new Map(
      await Promise.all(
        engines
          .filter(
            ([engineId, e]) => !described.get(engineId) && e.disconnect && listed.has(engineId),
          )
          .map(async ([engineId, e]) => [engineId, await this.#signedIn(e)] as const),
      ),
    );
    for (const [engineId, engine] of engines) {
      const key = described.get(engineId);
      if (!key) {
        if (signedIn.get(engineId))
          out.push({
            id: id('provider', engineId, 'subscription'),
            title: `${engine.label} sign-in`,
            usedBy: engine.label,
            hint: 'Connected',
            manage: { label: 'Open Providers', place: 'providers', focus: engineId },
            reveal: () =>
              Promise.reject(
                new Error('Conch renews this sign-in itself; there is no key to copy.'),
              ),
          });
        continue;
      }
      out.push({
        id: id('provider', engineId),
        title: `${engine.label} key`,
        usedBy: engine.label,
        hint: key.hint,
        savedAt: key.savedAt || undefined,
        manage: { label: 'Open Providers', place: 'providers', focus: engineId },
        reveal: async () => (await this.keys.value(engineId)) ?? '',
      });
    }
    const googleStatus = await this.google.status();
    if (googleStatus.configured)
      out.push({
        id: id('google', 'app'),
        title: 'Google app credentials',
        usedBy: 'Google integration',
        hint: 'Saved securely',
        manage: { label: 'Open Apps', place: 'integrations' },
        reveal: () =>
          Promise.reject(
            new Error('Google app credentials are managed in Apps; there is nothing to copy.'),
          ),
      });
    for (const account of googleStatus.accounts) {
      if (account.via === 'app-password') {
        out.push({
          id: id('google', account.id),
          title: `Gmail · ${account.email}`,
          usedBy: 'Gmail',
          hint: 'App password',
          manage: { label: 'Open Apps', place: 'integrations' },
          reveal: async () =>
            (await this.google.store.read()).passwords[account.id]?.password ?? '',
        });
        continue;
      }
      out.push({
        id: id('google', account.id),
        title: `Google · ${account.email}`,
        usedBy: 'Google integration',
        hint: 'Sign-in saved',
        manage: { label: 'Open Apps', place: 'integrations' },
        reveal: () =>
          Promise.reject(
            new Error(
              'This Google sign-in is kept and renewed by Conch; there is nothing to copy.',
            ),
          ),
      });
    }
    const slack = await this.slack.connection().catch(() => undefined);
    if (slack)
      out.push({
        id: id('slack', 'user'),
        title: slack.team ? `Slack · ${slack.team}` : 'Slack',
        usedBy: 'Slack integration',
        hint: tail(slack.token),
        manage: { label: 'Open Apps', place: 'integrations' },
        reveal: async () => slack.token,
      });
    // A 1Password service account's token, for Passwords: listed, never copied back out.
    const serviceAccount = await this.vault.serviceAccount.read().catch(() => undefined);
    if (serviceAccount?.token)
      out.push({
        id: id('1password', 'service-account'),
        title: '1Password service account',
        usedBy: 'Passwords',
        hint: 'Saved securely',
        ...(serviceAccount.savedAt && { savedAt: serviceAccount.savedAt }),
        manage: { label: 'Open Passwords', place: 'passwords', focus: '1password' },
        reveal: () =>
          Promise.reject(
            new Error(
              'Conch keeps this token only to read 1Password. Replace it in Passwords › Password managers.',
            ),
          ),
      });
    // A cloud browser's key, or a browser's address with its token (ADR 0080).
    const browser = await this.browser.secrets.read().catch(() => undefined);
    const browserKeys = [
      browser?.browserbase?.key && {
        kind: 'browserbase',
        title: 'Browserbase',
        value: browser.browserbase.key,
      },
      browser?.steel?.key && { kind: 'steel', title: 'Steel', value: browser.steel.key },
      browser?.cdp?.address && {
        kind: 'cdp',
        title: 'Browser address',
        value: browser.cdp.address,
      },
    ].filter((k): k is { kind: string; title: string; value: string } => Boolean(k));
    for (const key of browserKeys)
      out.push({
        id: id('browser', key.kind),
        title: key.title,
        usedBy: 'The browser',
        hint: key.kind === 'cdp' ? 'saved' : tail(key.value),
        manage: { label: 'Open Browser settings', place: 'browser' },
        reveal: async () => key.value,
      });
    // The cloud sandbox where chats' work can run (ADR 0106).
    const daytona = await this.workplaces.cloudKey().catch(() => undefined);
    if (daytona)
      out.push({
        id: id('workplaces', 'daytona'),
        title: 'Daytona',
        usedBy: 'Where work runs',
        hint: tail(daytona),
        manage: { label: 'Open Security', place: 'security' },
        reveal: async () => daytona,
      });
    for (const item of await this.integrations.store.all().catch(() => [])) {
      const secrets = await this.integrations.store.secrets(item.id).catch(() => undefined);
      for (const [key, value] of Object.entries(secrets?.values ?? {})) {
        if (!value) continue;
        out.push({
          id: id('integration', item.id, key),
          title: `${item.name} · ${key}`,
          usedBy: `${item.name} integration`,
          hint: tail(value),
          manage: { label: 'Open Apps', place: 'integrations', focus: item.id },
          reveal: async () => value,
        });
      }
      if (secrets?.oauth?.tokens)
        out.push({
          id: id('integration', item.id, 'oauth'),
          title: `${item.name} sign-in`,
          usedBy: `${item.name} integration`,
          hint: 'Signed in',
          manage: { label: 'Open Apps', place: 'integrations', focus: item.id },
          reveal: () =>
            Promise.reject(
              new Error(
                'This sign-in is kept by Conch and renewed by itself; there’s nothing to copy.',
              ),
            ),
        });
    }
    // Outside agents' keys (ADR 0112): listed so you know they're here, never shown.
    for (const { agent, hint } of await this.outside.keyed().catch(() => []))
      out.push({
        id: id('outside', agent.id),
        title: `${agent.name} key`,
        usedBy: `${agent.name}, an outside agent`,
        hint,
        manage: { label: 'Open Agents', place: 'agents' },
        reveal: () =>
          Promise.reject(
            new Error(
              'This key is kept by Conch for that agent. Paste it again in Agents to change it.',
            ),
          ),
      });
    for (const channel of (await this.#channelStore?.all().catch(() => [])) ?? []) {
      const secrets = await this.#channelStore?.secrets(channel.id).catch(() => undefined);
      if (!secrets) continue;
      const name = channel.bot.name ? `${channel.bot.name} (${channel.kind})` : channel.kind;
      // A linked device's keys (ADR 0043): listed so you know they're here, never shown.
      if (secrets.kind === 'whatsapp' || secrets.kind === 'signal') {
        out.push({
          id: id('channel', channel.id, 'link'),
          title: `${name} link`,
          usedBy: `${name} channel`,
          hint: channel.bot.phone ?? 'Linked',
          manage: { label: 'Open in Apps', place: 'channels', focus: channel.id },
          reveal: () =>
            Promise.reject(
              new Error(
                'These are this computer’s keys as a linked device; there’s nothing to copy. On another computer, link it again.',
              ),
            ),
        });
        continue;
      }
      for (const [label, value] of channelKeys(secrets))
        out.push({
          id: id('channel', channel.id, label),
          title: `${name} ${label}`,
          usedBy: `${name} channel`,
          hint: tail(value),
          manage: { label: 'Open in Apps', place: 'channels', focus: channel.id },
          reveal: async () => value,
        });
    }
    // The keys your Conch apps use (ADR 0061), typed into each app's settings.
    for (const key of await this.conchApps.systemKeys().catch(() => []))
      out.push({
        id: id('conch-app', key.appId, key.label),
        title: `${key.name} · ${key.label}`,
        usedBy: `${key.name} app`,
        hint: tail(key.value),
        manage: { label: 'Open Apps', place: 'integrations', focus: `capp_${key.appId}` },
        reveal: async () => key.value,
      });
    // Your key for signing skills (ADR 0047): shown, never copied out.
    const signing = await this.skillTrust.signingKey({ lock: false }).catch(() => undefined);
    if (signing?.state === 'locked' || signing?.state === 'clear')
      out.push({
        id: id('skills', 'signing'),
        title: 'Key for signing skills',
        usedBy: 'Skills you sign',
        hint: fingerprintOf(signing.publicKey),
        manage: { label: 'Open Skills', place: 'skills' },
        reveal: () =>
          Promise.reject(
            new Error(
              `Your signing key never leaves this computer. Share your public key instead: ${cliName()} skills key`,
            ),
          ),
      });
    return out;
  }

  /** The default provider: your choice, or `CONCH_ENGINE` when it's set. */
  engine(): Engine {
    return this.providers.engine();
  }

  /**
   * Skill folders a provider reads by itself, and who that is. Every listed
   * provider counts, not only connected ones: the answer must be quick, and a
   * provider that isn't connected isn't reading anything.
   */
  get #nativeSkillSources(): Map<SkillSource, string> {
    const map = new Map<SkillSource, string>();
    for (const engine of this.engines.values())
      for (const source of engine.skillSources ?? []) map.set(source, engine.label);
    return map;
  }

  /** What every connected provider offers, for the model picker. */
  models(force = false) {
    return this.providers.models({ force });
  }

  /** Read the remembered provider before the first request arrives. */
  /**
   * Conch is about to restart on purpose (its own update, a restart someone
   * asked for): every turn that's working stops at a safe point, and each
   * chat, task and routine run says so, so the next start carries it on.
   * Bounded: steps already running get a few seconds to finish. Resolves with
   * how many chats were paused.
   */
  pauseWork(reason: 'update' | 'restart'): Promise<number> {
    // Once: an update pauses first, and the restart it asks for finds it done.
    this.#pausing ??= (async () => {
      const paused = await this.conversations.pause(reason);
      await Promise.all([
        this.tasks.markPaused(reason).catch(() => 0),
        this.routines.markPaused(reason).catch(() => 0),
      ]);
      return paused;
    })();
    return this.#pausing;
  }

  #pausing?: Promise<number>;

  /** The restart didn't happen after all: what was paused goes on. */
  unpauseWork(): void {
    this.#pausing = undefined;
    this.conversations.unpause();
    void this.tasks.markPaused(undefined).catch(() => 0);
    void this.routines.markPaused(undefined).catch(() => 0);
  }

  async start() {
    // This computer's key, and no launcher file a crash left behind (ADR 0063).
    await this.here.start().catch((error: unknown) => console.error('[here]', error));
    this.#hereSweeper ??= setInterval(() => void this.here.sweep(), 30_000);
    this.#hereSweeper.unref();
    // Launchers ask for a link through a folder only you can write, never over the network.
    this.#stopAsks ??= this.here.watch(() => this.config.CONCH_PORT);
    // The servers you added are providers too: built before the first request needs them.
    await this.providers.loadServers().catch(() => undefined);
    // So are the ones your Conch apps bring (ADR 0122), before a chat or a channel needs them.
    await this.extensions.sync().catch(() => undefined);
    await this.providers.load();
    this.network.start();
    this.telemetry.start();
    // Containers a crash left behind are removed; nothing is started for it (ADR 0106).
    void this.workplaces.start();
    // Chats a restart cut off say so, and carry on by themselves.
    void this.conversations
      .recoverInterrupted()
      .then((sent) => {
        if (sent)
          void this.healed.note(
            'gateway',
            sent === 1
              ? 'Picked up a chat after a restart'
              : `Picked up ${sent} chats after a restart`,
          );
      })
      .catch((error: unknown) => console.error('[conversations]', error));
    await this.#channelsReady;
    void this.door.start().catch((error: unknown) => console.error('[door]', error));
    void this.channels.start().catch((error: unknown) => console.error('[channels]', error));
    // Uploads nobody sent (a closed tab, a dropped draft) are cleared on start and hourly.
    void this.attachments.sweep().catch(() => undefined);
    this.#sweeper ??= setInterval(
      () => void this.attachments.sweep().catch(() => undefined),
      60 * 60 * 1000,
    );
    this.#sweeper.unref();
    this.updates.start();
    this.conchApps.start();
    this.slack.start();
    void this.tasks.start().catch((error: unknown) => console.error('[tasks]', error));
    // Waits that let go of their turn carry on after a restart (ADR 0125).
    void this.waits.start().catch((error: unknown) => console.error('[waits]', error));
    // Apps paired with Conch still find it: its launcher, and their settings (ADR 0073).
    void this.mcpPairing.heal().catch((error: unknown) => console.error('[mcp]', error));
    this.backups.start();
  }

  /** The gateway listens: Conch answers at its own address too, if it has one (ADR 0064). */
  async serveAddress(gateway: HttpServer): Promise<void> {
    this.#gateway = gateway;
    await this.address.start();
    // conch setup and conch address change it by writing its file (ADR 0063, 0064).
    this.address.watch();
  }

  async stop() {
    this.recovery.stop();
    void this.telemetry.stop();
    void this.#printer.close();
    this.computer.stop();
    this.tasks.close();
    this.rounds.close();
    await this.conversations
      .drain()
      .catch(() => console.warn('[shutdown] Could not save all chat checkpoints.'));
    this.processes.close();
    this.waits.close();
    void this.address.stop();
    this.googleApps.stop();
    void this.conchApps.stop();
    this.slack.stop();
    this.channels.stop();
    this.speech.stop();
    this.wake.stop();
    this.channelLinking.stop();
    this.linked.stop();
    this.door.stop();
    this.tailscale.stop();
    this.tidy.stop();
    this.checkins.stop();
    this.learning.stop();
    this.learner.stop();
    this.memoryIndex.close();
    void this.onDevice.unload();
    void this.mockTelegram?.stop();
    void this.mockDiscord?.stop();
    void this.mockSlack?.stop();
    void this.mockMail?.stop();
    void this.mockMessages?.stop();
    void this.mockTeams?.stop();
    void this.mockMatrix?.stop();
    void this.mockWeChat?.stop();
    void this.mockTwilio?.stop();
    void this.mockMattermost?.stop();
    void this.mockLine?.stop();
    void this.mockFeishu?.stop();
    this.feishuScans.stop();
    void this.mockDingTalk?.stop();
    void this.mockQq?.stop();
    void this.mockRocketChat?.stop();
    void this.mockGoogleChat?.stop();
    clearInterval(this.#sweeper);
    clearInterval(this.#hereSweeper);
    this.#stopAsks?.();
    this.#stopAsks = undefined;
    this.#sweeper = undefined;
    this.network.stop();
    this.updates.stop();
    this.backups.stop();
    // Let go of the index file, so a restore (or a test) can replace it.
    this.search.close();
    await Promise.all(this.#pushRevocations);
  }

  /** A provider on this computer that's ready to answer, for when the internet isn't there. */
  async localReady(): Promise<Engine | undefined> {
    // Only a provider Conch uses: one merely installed here isn't a choice you made
    // (and a pinned provider, like the mock engine, is the only one there is).
    const ready = await this.providers.ready().catch(() => []);
    return ready.find((engine) => engine.local);
  }

  /**
   * Who answers a turn (ADR 0023). Offline, the model on this computer answers
   * (if you let it) or the message waits for the internet; at a usage limit,
   * your pick carries on until it resets. Otherwise, the chat's own provider.
   */
  async route(
    engine: Engine,
    context: { failed?: TurnProblem; model?: string; pictures?: boolean },
  ): Promise<TurnRoute> {
    const { preferences } = await this.settings.get();
    // The model another provider answers with: your default, if it's your default provider.
    const modelFor = (other: Engine) =>
      other.id === this.engine().id ? preferences.model : undefined;
    const carry = (other: Engine, choose: boolean) =>
      carryTools(engine, other, {
        ...(context.model && { fromModel: context.model }),
        ...(modelFor(other) && { toModel: modelFor(other) }),
        choose,
        ...(context.pictures && { sight: true }),
      }).catch(() => false as const);
    if (!engine.local) {
      // A provider that stopped answering is the moment to look again.
      const online =
        context.failed === 'unavailable'
          ? (await this.network.check()).online
          : this.network.online;
      if (!online) {
        const local = preferences.offlineFallback ? await this.localReady() : undefined;
        // Free, and it stays on this computer: another of its models may carry the
        // apps the chat's model could use, when the one it would pick can't (ADR 0050).
        const carried = local ? await carry(local, true) : false;
        return local && carried
          ? {
              kind: 'use',
              engine: local,
              ...(carried.model && { model: carried.model }),
              routed: {
                reason: 'offline',
                message: `You’re offline, so ${local.label} answered from this computer.`,
              },
            }
          : { kind: 'hold' };
      }
    }
    const fallback = preferences.limitFallback;
    if (fallback && fallback !== engine.id) {
      const usage = await this.usage.snapshot({ engine: engine.id }).catch(() => undefined);
      if (context.failed === 'limit' || usage?.blocked) {
        const other = this.providers.engineFor(fallback);
        const ready = other.id !== engine.id && (await other.detect().catch(() => undefined));
        // Your pick answers with the model it would anyway: choosing a pricier one
        // would be a spending choice you didn't make.
        const carried = ready && ready.state === 'ready' ? await carry(other, false) : false;
        if (carried) {
          const until = usage?.blocked?.until;
          return {
            kind: 'use',
            engine: other,
            ...(carried.model && { model: carried.model }),
            routed: {
              reason: 'limit',
              message: `${engine.label} reached its limit${until ? ` until ${clock(until)}` : ' for now'}, so ${other.label} answered.`,
            },
          };
        }
      }
    }
    return { kind: 'use', engine };
  }

  /** Conch's own model for meaning arrived (ADR 0041): index every memory, and look at habits again. */
  meaningLanded(): void {
    this.suggester.refresh();
    // Then every open search asks again: it understands more now.
    void this.memoryIndex.sync().finally(() => this.broadcast.emit({ type: 'memory.changed' }));
  }

  /**
   * Something Conch installed has landed: whatever was waiting on it looks
   * again now, instead of on its next check (the `op` state is cached for
   * half a minute, provider detection for twenty seconds).
   */
  async needLanded(id: string): Promise<void> {
    await this.#recheckWaiting(id);
    // Updates reads its version again (an update from Repair or a provider's page).
    await this.updates.landed(id);
  }

  async #recheckWaiting(id: string): Promise<void> {
    if (id === 'op') await this.keys.vault.onePassword.state({ force: true });
    // Ollama just landed: start it (quietly), so getting a model can follow straight on.
    if (id === 'ollama') await this.local.ensureRunning({ note: false });
    // Codex just landed: Codex and Codex CLI both use it.
    const engines = ({
      codex: ['codex-cli', 'codex-agent'],
      'claude-code': ['claude-code'],
      ollama: ['ollama'],
    }[id] ?? []) as EngineId[];
    for (const engine of engines) await this.engines.get(engine)?.detect({ force: true });
    await this.integrations.recheckNeeding(id);
    await this.channels.recheckNeeding(id);
    // Tailscale just landed: the public door carries on turning itself on.
    if (id === 'tailscale') await this.door.check().catch(() => undefined);
  }

  async engineStatus(force = false) {
    const status = await this.engine().detect({ force });
    if (force) {
      this.broadcast.emit({ type: 'engine.status', status });
      // Signing in, out or switching accounts changes which limits apply.
      void this.usage.refresh({ force: true });
    }
    return status;
  }

  async #fileAccess(ctx: ToolContext) {
    return {
      cwd: await (ctx.workspace?.() ?? this.settings.workspace()),
      protectedPaths: protectedPaths(this.config.CONCH_HOME),
      readableDirs: (await this.attachments.forConversation(ctx.conversationId)).map((a) =>
        this.attachments.folder(a.id),
      ),
    };
  }

  /** One provider's models, commands and modes: the default's unless another is named. */
  async capabilities(force = false, id?: EngineId) {
    const engine = this.providers.engineFor(id);
    // Saved choices name the provider, whatever a stand-in calls itself.
    return {
      ...(await engine.capabilities({ force })),
      engine: engine.id,
      places: engine.places === true,
      attachments: {
        images: engine.attachments?.images ?? false,
        files: engine.attachments?.files === true || engine.hostTools !== false,
      },
    };
  }

  get login() {
    return this.#login?.state;
  }

  startLogin(method: 'subscription' | 'console', id?: EngineId) {
    this.#login?.handle.cancel();
    const engine = (id && this.engines.get(id)) ?? this.engine();
    if (!engine.login) throw new Error(`${engine.label} doesn't support signing in from Conch.`);
    const handle = engine.login(method, (state) => {
      if (this.#login) this.#login.state = state;
      this.broadcast.emit({ type: 'engine.login', login: state });
      if (state.phase === 'done') void this.engineStatus(true);
    });
    this.#login = { handle, state: { loginId: 'pending', phase: 'starting' } };
  }

  submitLoginCode(code: string) {
    this.#login?.handle.submitCode(code);
  }

  cancelLogin() {
    this.#login?.handle.cancel();
    this.#login = undefined;
  }

  /**
   * The active provider's key. Kept for the first-run flow, which knows about
   * one provider; Settings uses `/api/providers/:id/key`.
   */
  async setApiKey(apiKey: string | undefined) {
    const id = this.providers.activeIdNow();
    if (apiKey === undefined) await this.providers.clearKey(id);
    else await this.providers.setKey(id, apiKey);
    return this.engineStatus(true);
  }
}

/**
 * Mock-mode catalog: web integrations point at the pretend vendor, local
 * ones run a tiny test server. Token vendors accept one fixed token each.
 */
function mockBlueprints(vendor: MockVendor) {
  vendor.validTokens.set('github', 'github_pat_mock_0123456789abcdefghij');
  vendor.validTokens.set('home-assistant', 'mock-home-token');
  const fixture = resolve(import.meta.dirname, 'test/mcpFixture.ts');
  return (id: string): Blueprint | undefined => {
    const entry = CATALOG.get(id);
    if (!entry?.blueprint) return undefined;
    if (entry.blueprint.type === 'stdio')
      return { type: 'stdio', command: process.execPath, args: [fixture] };
    return { type: 'http', url: () => vendor.url(id) };
  };
}

/** "15:00" in this computer's time: when a limit resets. */
function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Past chats as the search index lists conversations (ADR 0111). */
async function pastSummaries(store: PastChatStore): Promise<ConversationSummary[]> {
  return (await store.list().catch(() => [])).map((chat) => ({
    id: chat.id,
    title: chat.title,
    preview: '',
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    status: 'idle',
    options: {},
  }));
}
