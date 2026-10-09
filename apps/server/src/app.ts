import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import {
  AdoptIntegrationBody,
  ApiKeyBody,
  AppState,
  AcceptOfferBody,
  CatalogId,
  DismissOfferBody,
  ClientCommand,
  CommandName,
  CreateIntegrationBody,
  CreateSkillBody,
  DescribeSkillBody,
  DraftSkillBody,
  WriteSkillBody,
  TidyShelfBody,
  Id,
  LoginCodeBody,
  type Health,
  type Memory,
  PROTOCOL_VERSION,
  CreateRoutineBody,
  EngineId,
  ProviderKeyBody,
  ProbeServerBody,
  AddServerBody,
  UpdateServerBody,
  UpdateConversationBody,
  BulkChatsBody,
  FolderId,
  NewFolderBody,
  UpdateFolderBody,
  CompactBody,
  type ClearResult,
  type CompactResult,
  SetGoalBody,
  ServerId,
  ReleaseTurnBody,
  CappedChoiceBody,
  ChatSpendLimitBody,
  SchedulePreviewBody,
  UpdateRoutineBody,
  WhenPreviewBody,
  MailPeople,
  HookSecret,
  SaveCommandBody,
  SearchPreviewQuery,
  SearchQuery,
  type SearchRepairResult,
  StartLoginBody,
  UpdateIntegrationBody,
  UpdateSettingsBody,
  UpdateSkillBody,
  UsageBudgetBody,
  RoutineSpendingBody,
  UpdatesSettingsBody,
  type ServerEvent,
  UnderstandProfileBody,
  AvatarBody,
} from '@conch/protocol';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { registerAttachmentRoutes } from './attachments/routes';
import { carriedIn, registerListenRoutes } from './research/listen';
import { secretPlaces } from './conversations/sandbox';
import { protectedPaths } from './lib/protect';
import { folderRules } from './pick/folders';
import { registerTrajectoryRoutes } from './trajectory/routes';
import { TrajectoryService } from './trajectory/service';
import { registerFolderRoutes, registerPickRoutes } from './pick/routes';
import { registerVaultRoutes } from './vault/routes';
import { AttachmentError } from './attachments/store';
import { isLoopbackAddress } from './auth/network';
import { ConversationError } from './conversations/manager';
import { FolderError } from './conversations/folders';
import { OfferError } from './offers/desk';
import { BOOT_ID, restart, restartable } from './lib/lifecycle';
import { googleRoutes } from './google/routes';
import { slackRoutes } from './slack/routes';
import { IntegrationError, type SignIn } from './integrations/service';
import { preview } from './routines/schedule';
import { RoutineError } from './routines/service';
import { registerHereRoutes } from './auth/here-routes';
import { registerAddressRoutes } from './address/routes';
import { registerAuthRoutes } from './auth/routes';
import { registerPhoneRoutes } from './phone/routes';
import { pushOwner, registerPushRoutes } from './push/routes';
import { registerVoiceRoutes } from './voice/routes';
import { registerSafetyRoutes } from './conversations/safety-routes';
import { registerUndoRoutes } from './undo/routes';
import { registerStoryRoutes } from './conversations/stories/routes';
import { registerFaviconRoutes } from './favicons/routes';
import { registerFinanceRoutes } from './research/finance-routes';
import { registerArtifactRoutes } from './artifacts/routes';
import { registerCardRoutes } from './cards/routes';
import { registerMarketRoutes } from './skills/market/routes';
import { registerConchAppRoutes } from './conchapps/routes';
import { registerTaskRoutes } from './tasks/routes';
import { registerAgentRoutes } from './agents/routes';
import { AgentError } from './agents/store';
import { registerMcpEndpoint } from './mcp/endpoint';
import { registerA2aDoor } from './a2a/door';
import { registerTelemetryRoutes } from './telemetry/routes';
import { registerOutsideRoutes } from './a2a/routes';
import { registerMcpRoutes } from './mcp/routes';
import { registerQuestionRoutes } from './questions/routes';
import { registerFirstJobRoutes } from './onboarding/first-job';
import { registerBackgroundRoutes } from './background/routes';
import { registerImportRoutes } from './import/routes';
import { registerChatImportRoutes } from './import/chats/routes';
import { registerLearningRoutes } from './memory/routes';
import { registerQuietLearningRoutes } from './learning/routes';
import { registerCheckInRoutes } from './checkins/routes';
import { AvatarError, AvatarStore } from './profile/avatar';
import { ProfileUnavailable, understandProfile } from './profile/understand';
import { registerBackupRoutes } from './backup/routes';
import { registerBrowserRoutes } from './browser/routes';
import { registerWorkPlaceRoutes } from './workplaces/routes';
import { registerChannelLinkRoutes } from './channels/link-routes';
import { registerChannelRoutes } from './channels/routes';
import { registerTerminalRoutes } from './terminal/routes';
import { registerLocalRoutes } from './local/routes';
import { registerCloudRoutes } from './clouds/routes';
import { registerComputerRoutes } from './computer/routes';
import { registerComputerUseRoutes } from './computer-use/routes';
import { ProviderError } from './providers/service';
import { SkillError } from './skills/store';
import { UpdatesError } from './updates/service';
import { registerSecurity } from './security';
import { SERVER_VERSION, type Services } from './services';

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
  return undefined;
}

/**
 * Where a service sends you back after signing in: this same address, so it
 * works however you reached Conch (`Host` was already checked against the
 * allowlist). HTTPS when the request was, directly or via a local TLS proxy.
 */
function signInFor(request: FastifyRequest): SignIn {
  const https =
    request.protocol === 'https' ||
    (isLoopbackAddress(request.socket.remoteAddress) &&
      request.headers['x-forwarded-proto'] === 'https');
  const query = request.query as { display?: string; chat?: unknown; offer?: unknown } | undefined;
  const display = query?.display === 'tab' ? 'tab' : 'popup';
  // From a chat's offer, in this tab: the way back is that chat, which takes the offer by itself.
  const chat = Id.safeParse(query?.chat);
  const offer = Id.safeParse(query?.offer);
  return {
    redirectUrl: `${https ? 'https' : 'http'}://${request.headers.host ?? 'localhost'}/oauth/callback`,
    display,
    ...(display === 'tab' &&
      chat.success &&
      offer.success && { returnTo: { conversationId: chat.data, offerId: offer.data } }),
  };
}

const oauthParam = (value: unknown, max = 4096) =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof FolderError) {
    const status = { 'not-found': 404, 'too-many': 409 }[error.code];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof ProviderError) {
    const status = { 'not-found': 404, invalid: 400, pinned: 409 }[error.code];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof IntegrationError) {
    const status = { 'not-found': 404, invalid: 400, unavailable: 503 }[error.code];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof SkillError) {
    const status = { 'not-found': 404, invalid: 400, 'read-only': 409, 'needs-review': 409 }[
      error.code
    ];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof RoutineError) {
    const status = { 'not-found': 404, invalid: 400, busy: 409, 'engine-unavailable': 503 }[
      error.code
    ];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof UpdatesError) {
    const status = { 'not-found': 404, busy: 409, unavailable: 503 }[error.code];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof OfferError) {
    const status = error.code === 'not-found' ? 404 : 409;
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof ConversationError) {
    const status = error.code === 'not-found' ? 404 : error.code === 'busy' ? 409 : 503;
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  throw error;
}

/** A page coming back looks for a new Conch only if the last look is older than this. */
const LOOK_AGAIN_MS = 5 * 60_000;

export async function buildApp(services: Services) {
  const { config } = services;
  const app = Fastify({
    // WebAuthn credential IDs can be 1,023 bytes (1,364 base64url characters).
    // Each route still validates its own parameter; ordinary :id stays bounded below.
    routerOptions: { maxParamLength: 1400 },
    logger:
      config.CONCH_LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.CONCH_LOG_LEVEL,
            // Never log query strings (search terms, legacy tokens) or headers.
            serializers: {
              req: (req: { method: string; url: string }) => ({
                method: req.method,
                url: req.url.split('?')[0],
              }),
            },
          },
  });
  const { gate } = services;
  /**
   * Allowing a step that matters (ADR 0108): this computer, proven, as it always
   * was; any other device only with a passkey or password from the last ten
   * minutes. Read afresh, so confirming on a socket's page counts at once.
   */
  const stepUpDone = async (request: FastifyRequest): Promise<boolean> => {
    if (gate.isLocal(request)) return true;
    const access = await gate.resolve(request);
    return typeof access === 'object' && gate.verified(access);
  };
  registerSecurity(app, gate);
  // 1 MB per message is plenty for a 200k-character prompt; ws defaults to 100 MiB.
  await app.register(fastifyWebsocket, { options: { maxPayload: 1_000_000 } });
  registerAuthRoutes(app, services, gate);
  registerHereRoutes(app, gate);
  registerAddressRoutes(app, services.address, gate);
  // Other apps using Conch (ADR 0073): the door they knock on, and pairing them from Settings.
  registerMcpEndpoint(app, services.mcp, gate, services.mcpSessions);
  registerMcpRoutes(app, services.mcpPairing, gate);
  // Agents talking to each other (ADR 0112): the door for other agents, and outside agents.
  registerA2aDoor(app, gate, {
    store: services.mcp.store,
    agents: services.agents,
    chats: services.conversations,
  });
  registerOutsideRoutes(app, { outside: services.outside, rounds: services.rounds });
  // Dashboards (ADR 0119): Settings → Dashboards, and `/metrics` for Prometheus.
  registerTelemetryRoutes(app, services.telemetry, gate, stepUpDone);
  registerBrowserRoutes(app, services, gate);
  registerWorkPlaceRoutes(app, services, gate);
  registerTerminalRoutes(app, services, gate);
  registerLocalRoutes(app, services, gate);
  registerComputerRoutes(app, services.computer);
  registerCloudRoutes(app, services.clouds);
  registerComputerUseRoutes(app, services.computerUse, gate);
  registerAttachmentRoutes(app, services.attachments);
  registerVaultRoutes(app, services.vault, gate);
  registerPickRoutes(app);
  // Choosing a folder from any device: names only, never Conch's own or where keys are kept.
  const folders = () =>
    folderRules({
      conchHome: services.config.CONCH_HOME,
      workspace: services.settings.workspaceDefault,
      denied: [
        ...protectedPaths(services.config.CONCH_HOME),
        ...secretPlaces().map((place) => place.path),
      ],
    });
  registerFolderRoutes(app, folders);
  // How I did it (ADR 0113): a chat's timeline, and saving chats as a trajectory on this computer.
  registerTrajectoryRoutes(
    app,
    new TrajectoryService({
      list: () => services.conversations.list(),
      detail: (id) => services.conversations.detail(id),
      agents: () => services.agents.list(),
      profile: async () => (await services.settings.get()).profile,
      known: () => services.vault.redactor(),
      rules: folders,
      version: SERVER_VERSION,
    }),
  );
  registerBackupRoutes(app, services.backups, gate);
  registerImportRoutes(app, services.imports, gate);
  registerChatImportRoutes(app, services.chatImports, gate);
  registerBackgroundRoutes(
    app,
    services.background,
    gate,
    () => services.conversations.busy(),
    () => services.trayInfo(),
  );
  // Keep and Undo on a memory a chat learned are written into that chat, so it shows them after a reload.
  const memoryDecided = async (
    memory: { id: string; conversationId?: string; content: string; source?: Memory['source'] },
    kept: boolean,
    how: { edited?: boolean; anyway?: boolean } = {},
  ) => {
    if (memory.conversationId)
      await services.conversations.note(memory.conversationId, {
        type: 'memory.decided',
        memoryId: memory.id,
        kept,
        content: memory.content.slice(0, 500),
        ...(how.edited && { edited: true }),
        ...(how.anyway && { anyway: true }),
      });
    // What Conch learned keeps its record (ADR 0088): kept, or never learned again.
    if (kept) await services.learning.kept(memory);
    else await services.learning.forgotten(memory);
  };
  registerQuietLearningRoutes(app, {
    learning: services.learning,
    spend: services.learningSpend,
    memory: services.memory,
  });
  // Standing orders and the check-in (ADR 0107): a person's choices only.
  registerCheckInRoutes(app, { orders: services.standingOrders, checkins: services.checkins });
  registerLearningRoutes(app, {
    decided: memoryDecided,
    store: services.memory,
    index: services.memoryIndex,
    tidy: services.tidy,
    suggester: services.suggester,
    learner: services.learner,
    getMeaningModel: (languages) =>
      services.onDevice.get(languages, () => services.meaningLanded()),
    meaningState: () => services.onDevice.status(),
  });
  registerPhoneRoutes(app, { tailscale: services.tailscale, gate });
  registerPushRoutes(app, {
    push: services.push,
    conversations: services.conversations,
    verified: (request) => stepUpDone(request),
  });
  registerVoiceRoutes(app, services.voice, services.speech, services.wake);
  registerSafetyRoutes(app, services.activity, {
    providers: () => services.providers.ready(),
    sealing: async () => (await services.settings.get()).preferences.sealedCommands,
  });
  registerUndoRoutes(app, services.undo);
  // "Why?" on a step (ADR 0103).
  registerStoryRoutes(app, services.explainer);
  // Site icons for chips, from each site itself, never a third party (ADR 0103).
  registerFaviconRoutes(app, services.favicons);
  // What a finance card's range switch asks for: daily closes, from the same cached reader.
  registerFinanceRoutes(app, services.finance);
  // What a music card plays, streamed through Conch: only what that chat's own card carries.
  registerListenRoutes(app, {
    carried: async (chat, src) =>
      carriedIn((await services.conversations.detail(chat)).events, chat, src),
    gatewayPort: config.CONCH_PORT,
  });
  registerArtifactRoutes(app, services.artifacts);
  // Save, copy or send a card in the chat as a picture (ADR 0105): only this
  // chat's own picture, and only ever to this person's own chat app.
  registerCardRoutes(app, {
    channels: services.channels,
    attachments: services.attachments,
    knows: async (id) => (await services.conversations.list()).some((c) => c.id === id),
  });
  registerTaskRoutes(app, services.tasks);
  registerAgentRoutes(app, { agents: services.agents, faces: services.images });
  registerQuestionRoutes(app, services.questions);
  registerFirstJobRoutes(app, services);
  registerChannelRoutes(
    app,
    services.channels,
    gate,
    services.mockTelegram &&
      (() => ({
        telegram: services.mockTelegram?.base,
        discord: services.mockDiscord?.base,
        slack: services.mockSlack?.base,
        whatsapp: services.linked.mockWhatsApp?.base,
        signal: services.linked.mockSignal?.base,
        email: services.mockMail?.base,
        imessage: services.mockMessages?.base,
        microsoftteams: services.mockTeams?.base,
        matrix: services.mockMatrix?.base,
        wechat: services.mockWeChat?.base,
        sms: services.mockTwilio?.base,
        mattermost: services.mockMattermost?.base,
        line: services.mockLine?.base,
        rocketchat: services.mockRocketChat?.base,
        googlechat: services.mockGoogleChat?.base,
      })),
    services.door,
    // Gmail's app password, offered for talking by email too (ADR 0052).
    () => services.google.gmailLogin(),
  );
  registerChannelLinkRoutes(app, services.channelLinking, gate);
  app.addHook('onClose', () => services.browser.stop());
  app.addHook('onClose', async () => services.stop());
  app.addHook('onClose', async () => services.terminal.stop());

  // Every `:id` / `:name` in a URL is checked before any handler sees it, so
  // `..%2F..%2Fanything` can never become a path on disk.
  app.addHook('preValidation', async (request, reply) => {
    const params = request.params as Record<string, string> | undefined;
    if (params?.id !== undefined && !Id.safeParse(params.id).success)
      return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
    const name = params?.name === undefined ? undefined : CommandName.safeParse(params.name);
    if (name && !name.success)
      return reply.code(400).send({ error: 'bad-request', message: name.error.issues[0]?.message });
  });

  // The remembered provider is read once, before the first request is served.
  app.addHook('onReady', () => services.start());

  const appState = async () => {
    const settings = await services.settings.get();
    return AppState.parse({
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      onboarded: settings.onboarded,
      // The default agent, as Settings knew it before agents (ADR 0101).
      persona: await services.agents.persona(),
      profile: settings.profile,
      preferences: settings.preferences,
      engine: await services.engineStatus(),
      workspace: await services.settings.workspace(),
      network: services.network.status,
    });
  };

  // ── App & settings ─────────────────────────────────────────────────────
  app.get('/api/health', (): Health => ({
    ok: true,
    serverVersion: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    bootId: BOOT_ID,
    restartable: restartable(),
  }));
  /**
   * Start Conch again, when it can (after an update or a restore). It cuts
   * off every device's connection and anything running, so it needs a recent
   * password or key (sudo mode, like the update and restore that lead here),
   * and waits while a chat is working rather than cut it short.
   */
  app.post('/api/gateway/restart', (request, reply) => {
    if (!gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to restart Conch.' });
    if (services.conversations.busy())
      return reply.code(409).send({
        error: 'busy',
        message: 'A chat is still working. Wait for it to finish, then restart Conch.',
      });
    return restart()
      ? reply.code(202).send({ ok: true })
      : reply.code(409).send({
          error: 'not-restartable',
          message: 'Conch can’t restart itself here. Stop it (Ctrl+C) and run pnpm start again.',
        });
  });
  app.get('/api/state', appState);
  /** What Conch fixed on its own, newest first. */
  app.get('/api/healed', async () => ({ notes: await services.healed.list() }));

  // ── Repair everything ───────────────────────────────────────────────────
  // Looking changes nothing; repairing only tries safe fixes (no wiping, no
  // signing out), so neither needs a recent password. Both answer at once and
  // the report fills in over the `doctor.report` event.
  app.get('/api/doctor', () => {
    const report = services.doctor.report;
    if (!report.checkedAt && !report.running) void services.doctor.run();
    return services.doctor.report;
  });
  app.post('/api/doctor/check', () => {
    void services.doctor.run();
    return services.doctor.report;
  });
  app.post('/api/doctor/repair', () => {
    void services.doctor.run({ repair: true });
    return services.doctor.report;
  });
  app.patch('/api/settings', async (request, reply) => {
    const body = parse(UpdateSettingsBody, request.body, reply);
    if (!body) return;
    // Lowering a safety guard is a change that grants trust (ADR 0028): it asks that it's you.
    const lowering =
      body.preferences?.checkAfterReading === false ||
      body.preferences?.sealedCommands === false ||
      body.preferences?.checkMemories === false;
    if (lowering && !gate.verified(request.access))
      return reply.code(403).send({
        error: 'verify-required',
        message: 'Confirm it’s you to turn a safety check off.',
      });
    // A new default provider goes through the provider service, which knows about pins.
    const engine = body.preferences?.engine;
    if (engine) {
      try {
        await services.providers.use(engine);
      } catch (error) {
        return sendError(reply, error);
      }
    }
    const learnedBefore = (await services.settings.get()).preferences.autoMemory;
    // The personality is the default agent's (ADR 0101): changed there, and kept in step here.
    if (body.persona) {
      try {
        await services.agents.adoptPersona(body.persona);
      } catch (error) {
        if (error instanceof AgentError)
          return reply.code(409).send({ error: error.code, message: error.message });
        throw error;
      }
    }
    // The agents write the personality back to settings themselves, as an older Conch reads it.
    const { persona: _persona, ...rest } = body;
    await services.settings.update(rest);
    // Learn from your chats, on again: it starts from here, never reading what was said while off.
    if (!learnedBefore && body.preferences?.autoMemory === true)
      await services.learning.resumed().catch(() => undefined);
    return appState();
  });

  // Your photo (About you): kept as you framed it, served only as the picture it is.
  const avatars = new AvatarStore(services.config.CONCH_HOME, services.settings);
  app.put('/api/profile/avatar', async (request, reply) => {
    const body = parse(AvatarBody, request.body, reply);
    if (!body) return;
    try {
      await avatars.save(body.data);
    } catch (error) {
      if (error instanceof AvatarError)
        return reply.code(400).send({ error: 'bad-request', message: error.message });
      throw error;
    }
    return appState();
  });
  app.get('/api/profile/avatar', async (_request, reply) => {
    const avatar = await avatars.read();
    if (!avatar) return reply.code(404).send({ error: 'not-found', message: 'No photo.' });
    return reply
      .type(avatar.type)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(avatar.bytes);
  });
  app.delete('/api/profile/avatar', async () => {
    await avatars.remove();
    return appState();
  });

  // About you, read into cards (suggestions only: nothing is saved until you keep it).
  app.post('/api/profile/understand', async (request, reply) => {
    const body = parse(UnderstandProfileBody, request.body, reply);
    if (!body) return;
    try {
      const abort = new AbortController();
      request.raw.on('close', () => abort.abort());
      return { facts: await understandProfile(services.engine(), body.about, abort.signal) };
    } catch (error) {
      return reply.code(503).send({
        error: 'engine-unavailable',
        message:
          error instanceof ProfileUnavailable
            ? error.message
            : 'That couldn’t be read just now. Try again, or add the cards yourself.',
      });
    }
  });

  // ── Engine ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { refresh?: string } }>('/api/engine', (request) =>
    services.engineStatus(request.query.refresh === '1'),
  );
  app.post('/api/engine/login', async (request, reply) => {
    const body = parse(StartLoginBody, request.body ?? {}, reply);
    if (!body) return;
    if (body.method === 'api-key')
      return reply
        .code(400)
        .send({ error: 'bad-request', message: 'Use PUT /api/engine/api-key.' });
    services.startLogin(body.method);
    return { ok: true };
  });
  app.post('/api/engine/login/code', async (request, reply) => {
    const body = parse(LoginCodeBody, request.body, reply);
    if (!body) return;
    services.submitLoginCode(body.code);
    return { ok: true };
  });
  app.post('/api/engine/login/cancel', async () => {
    services.cancelLogin();
    return { ok: true };
  });
  app.put('/api/engine/api-key', async (request, reply) => {
    const body = parse(ApiKeyBody, request.body, reply);
    if (!body) return;
    return services.setApiKey(body.apiKey.trim());
  });
  app.delete('/api/engine/api-key', () => services.setApiKey(undefined));

  // ── Providers (what powers the assistant) ──────────────────────────────
  const providerId = (params: unknown, reply: FastifyReply) =>
    parse(EngineId, (params as { id?: string } | undefined)?.id, reply);

  app.get<{ Querystring: { refresh?: string } }>('/api/providers', (request) =>
    services.providers.list({ force: request.query.refresh === '1' }),
  );
  app.post<{ Params: { id: string } }>('/api/providers/:id/use', async (request, reply) => {
    const id = providerId(request.params, reply);
    if (!id) return;
    try {
      return await services.providers.use(id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post<{ Params: { id: string } }>('/api/providers/:id/check', async (request, reply) => {
    const id = providerId(request.params, reply);
    if (!id) return;
    try {
      return await services.providers.get(id, { force: true });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.put<{ Params: { id: string } }>('/api/providers/:id/key', async (request, reply) => {
    const id = providerId(request.params, reply);
    if (!id) return;
    const body = parse(ProviderKeyBody, request.body, reply);
    if (!body) return;
    try {
      return await services.providers.setKey(id, body.value);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.delete<{ Params: { id: string } }>('/api/providers/:id/key', async (request, reply) => {
    const id = providerId(request.params, reply);
    if (!id) return;
    try {
      return await services.providers.clearKey(id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post<{ Params: { id: string } }>('/api/providers/:id/signin', async (request, reply) => {
    const id = providerId(request.params, reply);
    if (!id) return;
    const { redirectUrl, display } = signInFor(request);
    try {
      const origin = new URL(redirectUrl).origin;
      const { authorizeUrl } = services.providers.startSignIn({ id, origin, display });
      return { authorizeUrl };
    } catch (error) {
      return reply.code(400).send({ error: 'bad-request', message: (error as Error).message });
    }
  });
  app.post<{ Params: { id: string } }>('/api/providers/:id/login', async (request, reply) => {
    const id = providerId(request.params, reply);
    if (!id) return;
    const body = parse(StartLoginBody, request.body ?? {}, reply);
    if (!body) return;
    if (body.method === 'api-key')
      return reply
        .code(400)
        .send({ error: 'bad-request', message: 'Use PUT /api/providers/:id/key.' });
    try {
      services.startLogin(body.method, id);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: 'bad-request', message: (error as Error).message });
    }
  });

  // Servers you run yourself, each a provider of its own (ADR 0053).
  const serverId = (params: unknown, reply: FastifyReply) =>
    parse(ServerId, (params as { id?: string } | undefined)?.id, reply);
  app.post('/api/providers/servers/probe', async (request, reply) => {
    const body = parse(ProbeServerBody, request.body, reply);
    if (!body) return;
    return services.providers.probeServer(body.url, body.key);
  });
  app.post('/api/providers/servers', async (request, reply) => {
    const body = parse(AddServerBody, request.body, reply);
    if (!body) return;
    try {
      return await services.providers.addServer(body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.patch<{ Params: { id: string } }>('/api/providers/servers/:id', async (request, reply) => {
    const id = serverId(request.params, reply);
    if (!id) return;
    const body = parse(UpdateServerBody, request.body, reply);
    if (!body) return;
    try {
      return await services.providers.updateServer(id, body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.delete<{ Params: { id: string } }>('/api/providers/servers/:id', async (request, reply) => {
    const id = serverId(request.params, reply);
    if (!id) return;
    try {
      return await services.providers.removeServer(id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  // Something found on this computer — a key in the environment, a server running —
  // used only when someone presses it. The key itself never comes to the browser.
  app.post<{ Params: { id: string } }>('/api/providers/found/:id/use', async (request, reply) => {
    const id = parse(Id, request.params.id, reply);
    if (!id) return;
    try {
      return await services.providers.useFound(id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Every connected provider's models at once, for the picker (ADR 0012).
  app.get<{ Querystring: { refresh?: string } }>('/api/models', (request) =>
    services.models(request.query.refresh === '1'),
  );

  // One provider's offer: the default's, or `?engine=` for another.
  app.get<{ Querystring: { refresh?: string; engine?: string } }>(
    '/api/capabilities',
    async (request, reply) => {
      const { engine, refresh } = request.query;
      const id = engine === undefined ? undefined : providerId({ id: engine }, reply);
      if (engine !== undefined && !id) return;
      try {
        return await services.capabilities(refresh === '1', id);
      } catch (error) {
        return reply
          .code(503)
          .send({ error: 'engine-unavailable', message: (error as Error).message });
      }
    },
  );

  // ── Usage limits ───────────────────────────────────────────────────────
  // The default provider's limits, or `?engine=` for another's (the one a chat uses).
  app.get<{ Querystring: { refresh?: string; engine?: string } }>(
    '/api/usage',
    (request, reply) => {
      const { engine, refresh } = request.query;
      const id = engine === undefined ? undefined : providerId({ id: engine }, reply);
      if (engine !== undefined && !id) return;
      return services.usage.snapshot({ force: refresh === '1', ...(id && { engine: id }) });
    },
  );
  app.put('/api/usage/budget', async (request, reply) => {
    const body = parse(UsageBudgetBody, request.body, reply);
    if (!body) return;
    return services.usage.setBudget(body.budget);
  });

  // ── Custom commands ────────────────────────────────────────────────────
  app.get('/api/commands', () => services.commands.list());
  app.put<{ Params: { name: string } }>('/api/commands/:name', async (request, reply) => {
    const body = parse(
      SaveCommandBody,
      { ...(request.body as object), name: request.params.name },
      reply,
    );
    if (!body) return;
    return services.commands.save(body);
  });
  app.delete<{ Params: { name: string } }>('/api/commands/:name', async (request, reply) => {
    const removed = await services.commands.remove(request.params.name);
    return removed
      ? { ok: true }
      : reply.code(404).send({ error: 'not-found', message: 'Command not found.' });
  });

  // ── Routines ───────────────────────────────────────────────────────────
  app.get('/api/routines', () => services.routines.list());
  app.post('/api/routines/preview', async (request, reply) => {
    const body = parse(SchedulePreviewBody, request.body, reply);
    if (!body) return;
    return preview(body.schedule, body.timezone);
  });
  // What routines spend (ADR 0057). Changing the limit is a person's choice
  // here; no tool the agent has can reach it.
  app.get('/api/routines/spending', () => services.routines.spending());
  app.put('/api/routines/spending', async (request, reply) => {
    const body = parse(RoutineSpendingBody, request.body, reply);
    if (!body) return;
    if (body.limitUsd !== undefined) await services.routineSpend.setLimit(body.limitUsd);
    if (body.planRoomPercent !== undefined) {
      await services.routineSpend.setPlanRoom(body.planRoomPercent);
      // Runs that waited for room look again: they may go now.
      void services.routines.recheckHeld();
    }
    return services.routines.spending();
  });
  app.post('/api/routines/spending/keep-paused', async () => {
    await services.routineSpend.keepPaused();
    return services.routines.spending();
  });
  app.post('/api/routines', async (request, reply) => {
    const body = parse(CreateRoutineBody, request.body, reply);
    if (!body) return;
    try {
      return await services.routines.create(body, { createdBy: 'user' });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.get<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
    try {
      return await services.routines.detail(request.params.id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.patch<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
    const body = parse(UpdateRoutineBody, request.body, reply);
    if (!body) return;
    try {
      return await services.routines.update(request.params.id, body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.delete<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
    try {
      await services.routines.remove(request.params.id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post<{ Params: { id: string } }>('/api/routines/:id/run', async (request, reply) => {
    try {
      return await services.routines.runNow(request.params.id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  // When… (ADR 0056): how a trigger reads, the people you mail with, another app's secret.
  app.post('/api/routines/when/preview', async (request, reply) => {
    const body = parse(WhenPreviewBody, request.body, reply);
    if (!body) return;
    return services.routines.previewWhen(body.when, body.onlyIf);
  });
  app.get('/api/routines/people', async () => MailPeople.parse(await services.mailPeople()));
  app.post<{ Params: { id: string } }>('/api/routines/:id/secret', async (request, reply) => {
    try {
      // Shown once, here: never stored where the page can read it again.
      const secret = await services.routines.newHookSecret(request.params.id);
      return reply.header('cache-control', 'no-store').send(HookSecret.parse({ secret }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  googleRoutes(app, services.google, gate, {
    apps: services.googleApps,
    gmailLogin: () => services.channels.gmailLogin(),
  });
  slackRoutes(app, services.slack, services.slackApps, () => services.channels.slackApp());

  // ── Integrations ───────────────────────────────────────────────────────
  // Running a program of your choosing, or letting an integration act without
  // asking, persists power beyond this chat: it needs a recent password or key.
  const verifyRequired = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return false;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    return true;
  };
  const guarded = async <T>(reply: FastifyReply, task: () => Promise<T>) => {
    try {
      return await task();
    } catch (error) {
      return sendError(reply, error);
    }
  };
  // Apps you make, share and add (ADR 0061): adding someone else's asks that it's you.
  registerConchAppRoutes(app, services.conchApps, {
    verifyRequired,
    emit: (event) => services.broadcast.emit(event),
  });
  app.get('/api/integrations', () => services.integrations.list());
  app.get<{ Querystring: { refresh?: string } }>('/api/integrations/external', (request) =>
    services.integrations.external(request.query.refresh === '1'),
  );
  app.post('/api/integrations', async (request, reply) => {
    const body = parse(CreateIntegrationBody, request.body, reply);
    if (!body) return;
    if ('custom' in body && body.custom.type === 'stdio' && verifyRequired(request, reply)) return;
    return guarded(reply, () => services.integrations.create(body, signInFor(request)));
  });
  app.post('/api/integrations/adopt', async (request, reply) => {
    const body = parse(AdoptIntegrationBody, request.body, reply);
    if (!body) return;
    return guarded(reply, () => services.integrations.adopt(body, signInFor(request)));
  });
  app.get<{ Params: { id: string } }>('/api/integrations/:id', (request, reply) =>
    guarded(reply, () => services.integrations.get(request.params.id)),
  );
  app.patch<{ Params: { id: string } }>('/api/integrations/:id', async (request, reply) => {
    const body = parse(UpdateIntegrationBody, request.body, reply);
    if (!body) return;
    if (body.policy === 'trust' && verifyRequired(request, reply)) return;
    return guarded(reply, () => services.integrations.update(request.params.id, body));
  });
  app.delete<{ Params: { id: string } }>('/api/integrations/:id', (request, reply) =>
    guarded(reply, async () => {
      await services.integrations.remove(request.params.id);
      return { ok: true };
    }),
  );
  app.post<{ Params: { id: string } }>('/api/integrations/:id/connect', (request, reply) =>
    guarded(reply, () => services.integrations.connect(request.params.id, signInFor(request))),
  );
  app.post<{ Params: { id: string } }>('/api/integrations/:id/cancel', (request, reply) =>
    guarded(reply, () => services.integrations.cancelConnect(request.params.id)),
  );
  app.post<{ Params: { id: string } }>('/api/integrations/:id/check', (request, reply) =>
    guarded(reply, async () => {
      await services.integrations.check(request.params.id);
      return services.integrations.get(request.params.id);
    }),
  );
  // Anything Conch knows how to get (ADR 0016): a provider's CLI, the 1Password
  // CLI, uv. Only needs in `setup/known.ts` exist here; installing or updating
  // runs a package manager as you, so it needs a recent password or key.
  const needOf = (reply: FastifyReply, id: string) => {
    const spec = services.setup.spec(id);
    if (!spec)
      void reply.code(404).send({ error: 'not-found', message: 'Nothing like that to get.' });
    return spec;
  };
  app.get<{ Params: { needId: string } }>('/api/needs/:needId', async (request, reply) => {
    const spec = needOf(reply, request.params.needId);
    return spec && services.setup.readiness([spec]);
  });
  for (const action of ['install', 'update', 'open'] as const) {
    app.post<{ Params: { needId: string } }>(
      `/api/needs/:needId/${action}`,
      async (request, reply) => {
        const spec = needOf(reply, request.params.needId);
        if (!spec) return;
        if (action !== 'open' && verifyRequired(request, reply)) return;
        try {
          await services.setup[action](spec);
          // Whatever was waiting on it looks again as soon as it lands, not on its next check.
          if (action !== 'open')
            void services.setup.settled(spec.id).then(() => services.needLanded(spec.id));
        } catch (error) {
          return reply.code(503).send({ error: 'unavailable', message: (error as Error).message });
        }
        return services.setup.readiness([spec]);
      },
    );
  }
  // ── Updates (ADR 0019) ─────────────────────────────────────────────────
  // Looking is free and quiet. Updating runs a package manager, or moves
  // Conch's own folder and restarts it, so it needs a recent password or key;
  // so does turning automatic updates on (it lets Conch install by itself).
  // Nothing from the request becomes part of a command: a program is one of
  // the needs Conch knows, and Conch's update takes no input at all.
  app.get('/api/updates', () => services.updates.status());
  app.post('/api/updates/check', async () => {
    void services.updates.check();
    return services.updates.status();
  });
  // A page coming back into view: look for a new Conch, unless someone just did.
  // At most one quick look every few minutes, however often it's asked.
  app.post('/api/updates/look', async () => {
    void services.updates.lookConch({ ifOlderThan: LOOK_AGAIN_MS });
    return services.updates.status();
  });
  app.post('/api/updates/conch', async (request, reply) => {
    if (verifyRequired(request, reply)) return;
    return guarded(reply, async () => {
      await services.updates.updateConch();
      return services.updates.status();
    });
  });
  app.post('/api/updates/programs', async (request, reply) => {
    if (verifyRequired(request, reply)) return;
    return guarded(reply, async () => {
      await services.updates.updateAll();
      return services.updates.status();
    });
  });
  app.post<{ Params: { needId: string } }>(
    '/api/updates/programs/:needId',
    async (request, reply) => {
      if (verifyRequired(request, reply)) return;
      return guarded(reply, async () => {
        await services.updates.updateProgram(request.params.needId);
        return services.updates.status();
      });
    },
  );
  app.patch('/api/updates/settings', async (request, reply) => {
    const body = parse(UpdatesSettingsBody, request.body, reply);
    if (!body) return;
    // Anything that lets Conch install by itself, or take less settled releases, asks that it's you.
    const raises =
      body.auto === true ||
      body.everyChange === true ||
      (body.channel !== undefined && body.channel !== 'stable');
    if (raises && verifyRequired(request, reply)) return;
    return services.updates.setSettings(body);
  });
  // Back to the version before, at once (ADR 0051): it changes the code that runs, so it asks that it's you.
  app.post('/api/updates/conch/back', async (request, reply) => {
    if (verifyRequired(request, reply)) return;
    return guarded(reply, async () => {
      await services.updates.goBack();
      return services.updates.status();
    });
  });

  // What a catalog entry needs from this computer (ADR 0016). Installing
  // software runs a package manager as you, so it needs a recent password or key.
  app.get<{ Params: { catalogId: string } }>(
    '/api/integrations/catalog/:catalogId/needs',
    (request, reply) =>
      guarded(reply, () => services.integrations.readiness(request.params.catalogId)),
  );
  app.post<{ Params: { catalogId: string; needId: string } }>(
    '/api/integrations/catalog/:catalogId/needs/:needId/install',
    (request, reply) => {
      if (verifyRequired(request, reply)) return;
      return guarded(reply, () =>
        services.integrations.installNeed(request.params.catalogId, request.params.needId),
      );
    },
  );
  app.post<{ Params: { catalogId: string; needId: string } }>(
    '/api/integrations/catalog/:catalogId/needs/:needId/open',
    (request, reply) =>
      guarded(reply, () =>
        services.integrations.openNeed(request.params.catalogId, request.params.needId),
      ),
  );

  // ── Skills ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { refresh?: string } }>('/api/skills', (request) =>
    services.skills.list(request.query.refresh === '1'),
  );
  app.post('/api/skills/draft', async (request, reply) => {
    const body = parse(DraftSkillBody, request.body, reply);
    if (!body) return;
    return services.skills.draft(body.instructions);
  });
  // A whole skill from an idea (the steps, a title, a description), to read before it's saved.
  app.post('/api/skills/write', async (request, reply) => {
    const body = parse(WriteSkillBody, request.body, reply);
    if (!body) return;
    return services.skills.write(body.idea);
  });
  app.post('/api/skills', async (request, reply) => {
    const body = parse(CreateSkillBody, request.body, reply);
    if (!body) return;
    return guarded(reply, () => services.skills.create(body));
  });
  // Discover (ADR 0074): before `/api/skills/:id`, so its own paths win.
  if (services.market)
    registerMarketRoutes(app, services.market, {
      detail: (id) => services.skills.detail(id),
      emit: (event) => services.broadcast.emit(event),
    });
  // A tidy shelf (ADR 0058): what's sat unused, and your answer. Only ever turns skills off.
  app.get('/api/skills/suggestions/shelf', () => services.skills.shelf());
  app.post('/api/skills/suggestions/shelf', async (request, reply) => {
    const body = parse(TidyShelfBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => ({
      changed: await services.skills.tidyShelf(body.action, body.ids),
    }));
  });
  // Whose signed skills you trust (ADR 0031). Trusting is a lasting power, like sudo.
  app.get('/api/skills/publishers', async () => ({
    publishers: await services.skills.publishers(),
  }));
  app.post<{ Params: { id: string } }>('/api/skills/:id/trust-publisher', (request, reply) => {
    if (!gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to trust a publisher.' });
    return guarded(reply, () => services.skills.trustPublisher(request.params.id));
  });
  app.delete<{ Params: { fingerprint: string } }>(
    '/api/skills/publishers/:fingerprint',
    async (request, reply) => {
      if (!(await services.skills.forgetPublisher(request.params.fingerprint)))
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'That publisher isn’t trusted.' });
      return { ok: true };
    },
  );
  app.get<{ Params: { id: string } }>('/api/skills/:id', (request, reply) =>
    guarded(reply, () => services.skills.detail(request.params.id)),
  );
  app.patch<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
    const body = parse(UpdateSkillBody, request.body, reply);
    if (!body) return;
    return guarded(reply, () => services.skills.update(request.params.id, body));
  });
  app.delete<{ Params: { id: string } }>('/api/skills/:id', (request, reply) =>
    guarded(reply, async () => {
      await services.skills.remove(request.params.id);
      return { ok: true };
    }),
  );
  app.post<{ Params: { id: string } }>('/api/skills/:id/copy', (request, reply) =>
    guarded(reply, () => services.skills.copy(request.params.id)),
  );
  /** A description for one of your skills that has none, to look over before saving it. */
  app.post<{ Params: { id: string } }>('/api/skills/:id/describe', (request, reply) => {
    if (!parse(DescribeSkillBody, request.body ?? {}, reply)) return;
    return guarded(reply, () => services.skills.describe(request.params.id));
  });

  /**
   * A provider sends you back here after making a key for you. Like the
   * integration callback below it's a cross-site top-level navigation, so it
   * lives outside /api; the single-use, 256-bit flow id in the path is what
   * ties it to the sign-in you started. OpenRouter's flow has no `state`
   * parameter of its own, which is why the id is in the path.
   */
  app.get<{ Params: { flowId: string } }>('/oauth/provider/:flowId', async (request, reply) => {
    const flowId = oauthParam(request.params.flowId, 256);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const code = oauthParam(query.code);
    const error = oauthParam(query.error, 200);
    const pending = flowId ? services.providers.signIns.peek(flowId) : undefined;
    const back = (result: string) => {
      // A popup lands on its own page; a tab comes back into the app, which
      // opens Settings → Providers and says how it went.
      const base = pending?.display === 'popup' ? '/providers/done' : '/';
      const provider = pending?.providerId ?? '';
      return reply.redirect(`${base}?provider=${provider}&result=${result}`, 303);
    };
    if (!flowId || !pending) return back('expired');
    if (error || !code) {
      services.providers.signIns.cancel(flowId);
      return back(error === 'access_denied' ? 'denied' : 'failed');
    }
    try {
      await services.providers.finishSignIn(flowId, code);
      return back('connected');
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'provider sign-in failed');
      return back('failed');
    }
  });

  /**
   * The service sends you back here after you sign in. It's a top-level
   * navigation from another site, so it isn't under /api (which refuses
   * cross-site requests) and can't rely on the SameSite session cookie: the
   * single-use, 256-bit `state` is what ties it to the sign-in you started.
   * The code is spent at once and the redirect drops it from the address bar.
   */
  app.get('/oauth/callback', async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const state = oauthParam(query.state, 256);
    const code = oauthParam(query.code);
    const error = oauthParam(query.error, 200);
    const back = (
      flow:
        | {
            integrationId: string;
            display: string;
            returnTo?: { conversationId: string; offerId: string };
          }
        | undefined,
      result: string,
    ) => {
      // Apps (ADR 0052); `/integrations/done` is the sign-in window's own page.
      if (!flow) return reply.redirect(`/apps?result=${result}`, 303);
      // Back to the chat it was offered in, which carries on by itself (ADR 0060).
      if (flow.display === 'tab' && flow.returnTo) {
        const { conversationId, offerId } = flow.returnTo;
        return reply.redirect(
          `/c/${encodeURIComponent(conversationId)}?offer=${encodeURIComponent(offerId)}&result=${result}`,
          303,
        );
      }
      const base = flow.display === 'popup' ? `/integrations/done` : `/apps/${flow.integrationId}`;
      return reply.redirect(`${base}?id=${flow.integrationId}&result=${result}`, 303);
    };
    if (!state) return back(undefined, 'expired');
    if (error || !code) {
      const flow = await services.integrations.failOAuth(state, error ?? 'no_code');
      return back(flow, error === 'access_denied' ? 'denied' : 'failed');
    }
    try {
      return back(await services.integrations.finishOAuth(state, code), 'connected');
    } catch (failure) {
      const flow = (
        failure as {
          flow?: {
            integrationId: string;
            display: string;
            returnTo?: { conversationId: string; offerId: string };
          };
        }
      ).flow;
      return back(flow, flow ? 'failed' : 'expired');
    }
  });

  // ── Memory ─────────────────────────────────────────────────────────────
  app.get('/api/memories', () => services.memory.list());
  // Adding and editing a memory by hand are in `memory/routes.ts`: the person's answer (ADR 0087).
  app.delete<{ Params: { id: string } }>('/api/memories/:id', async (request, reply) => {
    const removed = await services.memory.remove(request.params.id);
    if (removed) await memoryDecided(removed, false).catch(() => undefined);
    return removed
      ? { ok: true }
      : reply.code(404).send({ error: 'not-found', message: 'Memory not found.' });
  });

  // ── Search ─────────────────────────────────────────────────────────────
  // The index rebuilds itself when it breaks (`search/service.ts`); `unavailable`
  // only after it broke again, and Repair tries once more.
  const searchUnavailable = (reply: FastifyReply) =>
    reply.code(503).send({
      error: 'search-unavailable',
      message: 'Search isn’t working right now. Repair it to rebuild it from your chats.',
    });
  app.get('/api/search', async (request, reply) => {
    const query = parse(SearchQuery, request.query, reply);
    if (!query) return;
    const results = await services.search.search(query.q, { in: query.in, limit: query.limit });
    return results === 'unavailable' ? searchUnavailable(reply) : results;
  });
  app.get('/api/search/preview', async (request, reply) => {
    const query = parse(SearchPreviewQuery, request.query, reply);
    if (!query) return;
    const preview = await services.search.preview(query.conversationId, query.anchor, query.q);
    if (preview === 'unavailable') return searchUnavailable(reply);
    return (
      preview ?? reply.code(404).send({ error: 'not-found', message: 'Conversation not found.' })
    );
  });
  app.post('/api/search/repair', async (): Promise<SearchRepairResult> => ({
    state: await services.search.repair(),
  }));

  // ── Conversations ──────────────────────────────────────────────────────
  app.get('/api/conversations', () => services.conversations.list());
  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (request, reply) => {
    try {
      return await services.conversations.detail(request.params.id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  /** Rename a conversation, archive it or put it back, pin it, file it, or mark it seen. */
  app.patch<{ Params: { id: string } }>('/api/conversations/:id', async (request, reply) => {
    const body = parse(UpdateConversationBody, request.body, reply);
    if (!body) return;
    try {
      const { title, seen, agentId, ...change } = body;
      if (change.folder && !(await services.folders.has(change.folder)))
        throw new FolderError('not-found', 'That folder isn’t there any more.');
      if (title !== undefined) await services.conversations.rename(request.params.id, title);
      if (Object.keys(change).length)
        await services.conversations.change(request.params.id, change);
      if (seen) await services.conversations.seen(request.params.id);
      // Another agent answers from the next message on (ADR 0101).
      if (agentId) await services.conversations.setAgent(request.params.id, agentId);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  /** The same change to many chats, or deleting them: Select in the chat list (ADR 0089). */
  app.post('/api/conversations/bulk', async (request, reply) => {
    const body = parse(BulkChatsBody, request.body, reply);
    if (!body) return;
    try {
      if (body.change?.folder && !(await services.folders.has(body.change.folder)))
        throw new FolderError('not-found', 'That folder isn’t there any more.');
      let done = 0;
      const failed: string[] = [];
      for (const id of new Set(body.ids)) {
        try {
          if (body.remove) await services.conversations.remove(id);
          else if (body.change) await services.conversations.change(id, body.change);
          done++;
        } catch (error) {
          // One that went meanwhile is skipped; one that couldn't change doesn't stop the
          // rest, and is named, so the list puts back only that one.
          if (!(error instanceof ConversationError && error.code === 'not-found')) failed.push(id);
        }
      }
      return { ok: true, done, failed };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  // ── Folders in the chat list (ADR 0089) ──────────────────────────────────
  app.get('/api/folders', () => services.folders.list());
  app.post('/api/folders', async (request, reply) => {
    const body = parse(NewFolderBody, request.body, reply);
    if (!body) return;
    try {
      return await services.folders.create(body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.patch<{ Params: { id: string } }>('/api/folders/:id', async (request, reply) => {
    const id = parse(FolderId, request.params.id, reply);
    const body = id && parse(UpdateFolderBody, request.body, reply);
    if (!id || !body) return;
    try {
      return await services.folders.update(id, body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  /** A folder goes; its chats go back to the list, untouched. */
  app.delete<{ Params: { id: string } }>('/api/folders/:id', async (request, reply) => {
    const id = parse(FolderId, request.params.id, reply);
    if (!id) return;
    await services.conversations.unfile(id);
    await services.folders.remove(id);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (request) => {
    await services.conversations.remove(request.params.id);
    return { ok: true };
  });
  /** A waiting message goes now: with another provider, or switched to a model that can use its apps. */
  app.post<{ Params: { id: string } }>('/api/conversations/:id/release', async (request, reply) => {
    const body = parse(ReleaseTurnBody, request.body ?? {}, reply);
    if (!body) return;
    try {
      const sent = await services.conversations.release(request.params.id, body.engine, body.model);
      if (sent) return { ok: true };
      return services.network.online
        ? reply.code(409).send({ error: 'conflict', message: 'That message has already gone.' })
        : reply
            .code(409)
            .send({ error: 'offline', message: 'You’re still offline. It goes when you’re back.' });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  /**
   * A message at a spending limit goes on as the person chose (ADR 0079): raise
   * the limit, carry on with a model that costs less, or stop. Only from the UI.
   */
  app.post<{ Params: { id: string } }>('/api/conversations/:id/capped', async (request, reply) => {
    const body = parse(CappedChoiceBody, request.body, reply);
    if (!body) return;
    try {
      if (await services.conversations.settleCapped(request.params.id, body.choice))
        return { ok: true };
      return reply
        .code(409)
        .send({ error: 'conflict', message: 'Nothing is waiting at a limit in this chat now.' });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  /** This chat's own spending limit (ADR 0079), or none. Only from the UI. */
  app.put<{ Params: { id: string } }>(
    '/api/conversations/:id/spend-limit',
    async (request, reply) => {
      const body = parse(ChatSpendLimitBody, request.body, reply);
      if (!body) return;
      try {
        return await services.conversations.setSpendLimit(request.params.id, body.capUsd);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
  /** `/compact`: summarise the start of a long chat now (ADR 0055). */
  app.post<{ Params: { id: string } }>('/api/conversations/:id/compact', async (request, reply) => {
    const body = parse(CompactBody, request.body ?? {}, reply);
    if (!body) return;
    try {
      const result: CompactResult = await services.conversations.compact(
        request.params.id,
        body.focus || undefined,
      );
      return result;
    } catch (error) {
      return sendError(reply, error);
    }
  });
  /** `/clear`: the model forgets the conversation so far, with every provider. */
  app.post<{ Params: { id: string } }>('/api/conversations/:id/clear', async (request, reply) => {
    try {
      const result: ClearResult = await services.conversations.clear(request.params.id);
      return result;
    } catch (error) {
      return sendError(reply, error);
    }
  });
  /** Undo on `/clear`, while nothing new was sent. */
  app.post<{ Params: { id: string } }>(
    '/api/conversations/:id/clear/undo',
    async (request, reply) => {
      try {
        const result: ClearResult = await services.conversations.restoreContext(request.params.id);
        return result;
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
  /** `/goal`: what the chat is for, kept in every turn's context; `null` takes it away. */
  app.put<{ Params: { id: string } }>('/api/conversations/:id/goal', async (request, reply) => {
    const body = parse(SetGoalBody, request.body ?? {}, reply);
    if (!body) return;
    try {
      await services.conversations.setGoal(request.params.id, body.goal);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  // Tests and demos (mock mode only): pretend the internet is gone, or back.
  if (services.config.CONCH_ENGINE === 'mock')
    app.post<{ Body: { online?: unknown } }>('/api/mock/network', (request) => {
      services.network.simulate(request.body?.online === true);
      return services.network.status;
    });
  // Stop holding this chat to a skill's list (ADR 0047): a person in Conch, never a script's key.
  app.post<{ Params: { id: string; skillId: string } }>(
    '/api/conversations/:id/skills/:skillId/stop-holding',
    async (request, reply) => {
      if (request.access?.kind === 'bearer')
        return reply.code(403).send({
          error: 'person-only',
          message: 'Only you can do this, in Conch itself, not with an access key.',
        });
      try {
        await services.conversations.stopHolding(request.params.id, request.params.skillId);
        return { ok: true };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
  // “Not now” on an offer to connect an app, for the rest of this conversation.
  app.post<{ Params: { id: string; catalogId: string } }>(
    '/api/conversations/:id/suggestions/:catalogId/dismiss',
    async (request, reply) => {
      if (!CatalogId.safeParse(request.params.catalogId).success)
        return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
      try {
        await services.conversations.dismissSuggestion(request.params.id, request.params.catalogId);
        return { ok: true };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
  // Taking an offer (ADR 0060): what was offered must be on now; then the chat carries on, once.
  app.post<{ Params: { id: string; offerId: string } }>(
    '/api/conversations/:id/offers/:offerId/accept',
    async (request, reply) => {
      if (!Id.safeParse(request.params.offerId).success)
        return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
      const body = parse(AcceptOfferBody, request.body ?? {}, reply);
      if (!body) return;
      try {
        const state = await services.offers.accept(request.params.id, request.params.offerId, body);
        return { ok: true, state };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
  // “Not now” on an offer, for the rest of this conversation.
  app.post<{ Params: { id: string; offerId: string } }>(
    '/api/conversations/:id/offers/:offerId/dismiss',
    async (request, reply) => {
      if (!Id.safeParse(request.params.offerId).success)
        return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
      if (!parse(DismissOfferBody, request.body ?? {}, reply)) return;
      try {
        await services.offers.dismiss(request.params.id, request.params.offerId);
        return { ok: true };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ── Live stream ────────────────────────────────────────────────────────
  app.get('/ws', { websocket: true }, (socket, request) => {
    const subscribed = new Set<string>();
    // Signing this device out (or its session expiring) closes the socket.
    const session = request.access?.kind === 'session' ? request.access.session : undefined;
    const untrack = session ? gate.track(session.id, socket, gate.isLocal(request)) : undefined;
    socket.on('close', () => untrack?.());
    // Whether this page is in front of someone: notifications wait while one is.
    const owner = pushOwner(request.access);
    const presence = owner ? services.push.presence.open(owner) : undefined;
    socket.on('close', () => presence?.close());
    const stillSignedIn = async () => {
      const resolved = await gate.resolve(request);
      if (typeof resolved === 'object') return true;
      socket.close(4401, 'Signed out');
      return false;
    };
    const send = (event: ServerEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    };
    const off = services.broadcast.on((event) => {
      if (event.type === 'conversation.event' && !subscribed.has(event.event.conversationId))
        return;
      send(event);
    });
    socket.on('close', off);
    send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, serverVersion: SERVER_VERSION });

    socket.on('message', async (raw: Buffer) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        return send({ type: 'error', code: 'bad-request', message: 'Invalid JSON.' });
      }
      const parsed = ClientCommand.safeParse(json);
      if (!parsed.success) {
        return send({
          type: 'error',
          code: 'bad-request',
          message: parsed.error.issues[0]?.message ?? 'Invalid command.',
        });
      }
      const command = parsed.data;
      if (!(await stillSignedIn())) return;
      try {
        switch (command.type) {
          case 'ping':
            return send({ type: 'pong' });
          case 'presence':
            presence?.set(command.visible);
            return;
          case 'conversation.subscribe': {
            if (subscribed.size >= 200) subscribed.delete(subscribed.values().next().value ?? '');
            subscribed.add(command.conversationId);
            try {
              // A tab ahead of the log (Conch restarted and lost the end of a turn) starts over.
              const ahead =
                command.afterSeq !== undefined &&
                command.afterSeq > (await services.conversations.lastSeq(command.conversationId));
              if (ahead)
                send({ type: 'conversation.reset', conversationId: command.conversationId });
              const events = await services.conversations.eventsAfter(
                command.conversationId,
                ahead ? undefined : command.afterSeq,
              );
              for (const event of events) send({ type: 'conversation.event', event });
            } finally {
              // Even when the log couldn't be read: the tab draws what it has, never waits on.
              send({ type: 'conversation.synced', conversationId: command.conversationId });
            }
            return;
          }
          case 'conversation.unsubscribe':
            subscribed.delete(command.conversationId);
            return;
          case 'conversation.send': {
            // Subscribe before sending so the first events aren't missed.
            if (command.conversationId) subscribed.add(command.conversationId);
            const unsubscribeCreated = services.broadcast.on((event) => {
              if (
                event.type === 'conversation.created' &&
                event.clientMessageId === command.clientMessageId
              ) {
                subscribed.add(event.conversation.id);
              }
            });
            try {
              // Started from a folder (ADR 0089): filed there from its first moment,
              // unless the folder went meanwhile; then it starts in the list, as any chat.
              const { folder, ...rest } = command;
              const filed =
                folder && !command.conversationId && (await services.folders.has(folder))
                  ? folder
                  : undefined;
              // Mentioning agents starts a round (ADR 0112); anything else is sent as it is.
              await services.rounds.send({ ...rest, ...(filed && { folder: filed }) });
            } finally {
              unsubscribeCreated();
            }
            return;
          }
          case 'conversation.configure':
            return await services.conversations.configure(command.conversationId, command.options);
          case 'conversation.interrupt':
            return await services.conversations.interrupt(command.conversationId);
          case 'permission.respond': {
            // A step that matters is allowed from another device only after a recent
            // passkey or password, as on the approval sheet (ADR 0108); the card asks.
            const confirm =
              command.decision !== 'deny' &&
              services.push.confirmFor(command.conversationId, command.permissionId);
            if (confirm && !(await stepUpDone(request)))
              return send({
                type: 'error',
                code: 'verify-required',
                message: `Confirm it’s you to allow this. ${confirm}`,
                conversationId: command.conversationId,
                permissionId: command.permissionId,
              });
            return await services.conversations.respond(
              command.conversationId,
              command.permissionId,
              command.decision,
              command.edit,
            );
          }
        }
      } catch (error) {
        const code =
          error instanceof ConversationError
            ? error.code
            : error instanceof AttachmentError
              ? 'bad-request'
              : 'internal';
        send({
          type: 'error',
          code,
          message: (error as Error).message,
          ...('conversationId' in command &&
            command.conversationId && { conversationId: command.conversationId }),
          ...(command.type === 'conversation.send' && { clientMessageId: command.clientMessageId }),
        });
      }
    });
  });

  // ── Web app ────────────────────────────────────────────────────────────
  const dist = config.CONCH_WEB_DIST ?? resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(join(dist, 'index.html'))) {
    // `wildcard: true` resolves files per request, so a rebuilt web app is served
    // without restarting the gateway. Unknown app routes fall back to the SPA;
    // missing assets (anything with a file extension) stay a real 404.
    await app.register(fastifyStatic, { root: dist, wildcard: true });
    // The app built just before a rebuild swapped it out (updates/conch.ts), kept
    // until the next start: a page loaded from it still gets the parts it asks for.
    const replaced = `${dist}.old`;
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      const part = /^\/assets\/([\w.-]+)$/.exec(path)?.[1];
      if (part && !part.startsWith('.') && existsSync(join(replaced, 'assets', part)))
        return reply.sendFile(`assets/${part}`, replaced);
      if (path.startsWith('/api') || /\.[a-z0-9]+$/i.test(path)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
