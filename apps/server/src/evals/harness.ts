/**
 * Runs one task on one model, through Conch itself (ADR 0071): a whole
 * gateway's services in a throwaway home, the real engine for the provider,
 * the real browser, apps, memory and questions — the same `Engine` interface
 * and conversation manager the app uses. Nothing is mocked but the person,
 * who is played by code: the approver answers permission requests, a script
 * answers question cards, and a sign-in handed over is done by the harness in
 * the page itself.
 *
 * Every engine is wrapped so each tool call and its usage are counted as they
 * stream; the turn's own `usage` is the word on tokens and cost.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  ConversationEvent,
  EngineId,
  EngineStatus,
  PermissionMode,
  Question,
  QuestionAnswer,
  ServerEvent,
} from '@conch/protocol';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { costAt, priceOf } from '../usage/prices';
import { Services } from '../services';
import { approve, bypassAllowed, unsafeHome, type World } from './approver';
import { SITE, startSite, type FixtureSite } from './fixtures/site';
import {
  DEFAULT_ANSWER,
  type EvalTask,
  type Scene,
  type Target,
  type Turn,
  type Verdict,
} from './tasks';

const LEDGER = resolve(import.meta.dirname, 'fixtures/ledger.ts');
const DEFAULT_TIMEOUT_MS = 8 * 60_000;

export interface Tally {
  steps: number;
  tools: Record<string, number>;
  tokens: { input: number; output: number; cached: number };
  costUsd?: number;
  turns: number;
  latencyMs: number;
  denials: string[];
  /** The model that answered the model under test's turns, as the provider named it. */
  answeredWith?: string;
}

export interface TaskOutcome extends Verdict, Tally {}

/** A model ready to run: its provider, its model id, and its key (never logged). */
export interface Ready extends Target {
  key?: string;
  /** Save the key for this provider instead, as is (see `EvalModel.keyFor`). */
  keyFor?: EngineId;
}

export interface RunOptions {
  /** The model under test, and the one a switch hands over from. */
  model: Ready;
  partner?: Ready;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  /** Write every chat's events here (`<model>.<task>.json`), to see what happened. */
  traceTo?: string;
  /**
   * Engines that stand in for a provider: the suite's own tests run a task
   * with a scripted one, to prove its checker tells a good run from a bad one.
   */
  engines?: Partial<Record<EngineId, Engine>>;
}

/** A throwaway Conch: its own home, services, fixture site and (when asked) the Ledger app. */
export async function bootConch(options: {
  home?: string;
  env?: Record<string, string | undefined>;
}) {
  const env = options.env ?? process.env;
  const home = options.home ?? (await mkdtemp(join(tmpdir(), 'conch-eval-')));
  const unsafe = unsafeHome(home, env);
  if (unsafe) throw new Error(unsafe);
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      CONCH_UPDATE_CHECKS: 'off',
      CONCH_SKILL_SOURCES: 'off',
      // A key file in the throwaway home, never this computer's keychain.
      CONCH_VAULT_KEYSTORE: 'file',
    }),
  );
  const app = await buildApp(services);
  await app.ready();
  await services.settings.update({
    onboarded: true,
    preferences: { autoTitle: false, tidyMemory: false },
  });
  await services.browser.updateSettings({ allowLocal: true, autoOpen: false });
  const stop = async () => {
    await services.browser.stop().catch(() => undefined);
    await services.stop().catch(() => undefined);
    await app.close().catch(() => undefined);
    // Windows holds files a little after a process lets go of them.
    for (let i = 0; i < 5; i++) {
      try {
        await rm(home, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  };
  return { home, services, stop };
}

/** The engine, with every event it streams also shown to `see`. */
export function tapped(engine: Engine, see: (event: EngineEvent) => void): Engine {
  return new Proxy(engine, {
    get(target, property) {
      if (property === 'runTurn')
        return (input: TurnInput) => {
          const stream = target.runTurn(input);
          return (async function* () {
            for await (const event of stream) {
              see(event);
              yield event;
            }
          })();
        };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** A provider that can't answer: signed out, and a turn that ends at once if one starts. */
export function signedOut(engine: Engine): Engine {
  return new Proxy(engine, {
    get(target, property) {
      if (property === 'detect')
        return async (): Promise<EngineStatus> => ({
          engine: target.id,
          label: target.label,
          state: 'signed-out',
          install: [],
          canSignIn: false,
          checkedAt: Date.now(),
        });
      if (property === 'runTurn')
        return async function* (): AsyncIterable<EngineEvent> {
          yield { type: 'done', outcome: 'error', error: 'Signed out for this run.' };
        };
      if (property === 'complete') return undefined;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** Save the key a model needs into the throwaway home, checked like Settings checks it. */
export async function connect(services: Services, target: Ready): Promise<void> {
  const engine = services.engines.get(target.engine as EngineId);
  if (!engine) throw new Error(`This build has no ${target.engine} provider.`);
  if (target.key && target.keyFor) {
    await services.settings.setProviderSecret(target.keyFor, {
      source: 'conch',
      value: target.key,
      savedAt: Date.now(),
    });
    await engine.setApiKey?.(target.key);
  } else if (target.key) await services.providers.setKey(target.engine as EngineId, target.key);
  const status = await engine.detect({ force: true });
  if (status.state !== 'ready')
    throw new Error(status.message ?? `${engine.label} isn’t ready (${status.state}).`);
}

/** Run one task on one model, start to finish, and say how it went. */
export async function runTask(task: EvalTask, options: RunOptions): Promise<TaskOutcome> {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => undefined);
  const tally: Tally = {
    steps: 0,
    tools: {},
    tokens: { input: 0, output: 0, cached: 0 },
    turns: 0,
    latencyMs: 0,
    denials: [],
  };
  let site: FixtureSite | undefined;
  let conch: Awaited<ReturnType<typeof bootConch>> | undefined;
  try {
    site = await startSite();
    conch = await bootConch({ env });
    const { services, home } = conch;
    const bypass = bypassAllowed(home, env);
    const mode: PermissionMode = bypass ? 'bypassPermissions' : 'default';
    // Stand-ins replace their provider, and every other one is signed out for the run: a
    // scripted test must never reach a real (paid) provider by a fallback.
    if (options.engines)
      for (const [id, engine] of [...services.engines])
        services.engines.set(id, options.engines[id] ?? signedOut(engine));

    await connect(services, options.model);
    if (task.needs?.includes('partner')) {
      if (!options.partner)
        return { status: 'error', reason: 'no other model to switch from', ...tally };
      await connect(services, options.partner);
    }

    const workspace = await services.settings.workspace();
    const ledgerLog = join(home, 'ledger.jsonl');
    const servers: string[] = [];
    if (task.needs?.includes('ledger')) {
      const { integration } = await services.integrations.create(
        {
          custom: {
            type: 'stdio',
            name: 'Ledger',
            command: process.execPath,
            args: [LEDGER],
            env: { LEDGER_LOG: ledgerLog },
          },
        },
        { redirectUrl: 'http://localhost/oauth/callback', display: 'popup' },
      );
      await services.integrations.update(integration.id, { policy: 'trust' });
      servers.push(integration.server);
    }
    const world: World = { origins: [site.url], home, cwd: workspace, servers };

    const seen: Scene['seen'] = { questions: [], handoffs: 0, toolInputs: [] };
    let answer: (question: Question) => QuestionAnswer | null = DEFAULT_ANSWER;
    let costKnown = true;
    let cost = 0;
    // Who is answering now: only the model under test's turns are counted (a
    // switch's first model is another's work). Messages go one at a time.
    let speaking: Target = options.model;
    const testing = () => speaking === options.model;

    // Count what every engine does, as it streams.
    for (const [id, engine] of [...services.engines]) {
      services.engines.set(
        id,
        tapped(engine, (event) => {
          if (event.type !== 'tool-start') return;
          const name = event.name.replace(/^mcp__conch__/, '');
          seen.toolInputs.push({ name, input: event.input });
          if (!testing()) return;
          tally.steps++;
          tally.tools[name] = (tally.tools[name] ?? 0) + 1;
        }),
      );
    }

    // The person, played by code.
    const completed = new Map<string, number>();
    const wake = new Set<() => void>();
    const off = services.conversations.events.on((wire: ServerEvent) => {
      if (wire.type !== 'conversation.event') return;
      const event = wire.event;
      const chat = event.conversationId;
      if (event.type === 'permission.requested') {
        const verdict = approve(
          {
            toolName: event.toolName,
            input: event.input,
            ...(event.browser && {
              browser: {
                site: event.browser.site,
                url: event.browser.url,
                kind: event.browser.kind,
              },
            }),
          },
          world,
        );
        if (verdict.decision === 'deny') tally.denials.push(verdict.why);
        log(`  ${verdict.decision === 'allow' ? 'allowed' : 'DENIED'}: ${verdict.why}`);
        void services.conversations
          .respond(chat, event.permissionId, verdict.decision)
          .catch(() => undefined);
      }
      if (event.type === 'question') {
        seen.questions.push(event.question);
        const reply = answer(event.question);
        setTimeout(() => {
          try {
            services.questions.answer(chat, event.question.questionId, reply);
          } catch (error) {
            // An answer the card refuses is skipped, as a person would, so the
            // reply never waits for nobody. (Already settled: nothing to do.)
            log(`  question answer refused (${String(error)}); skipping it`);
            try {
              services.questions.answer(chat, event.question.questionId, null);
            } catch {
              // The turn stopped first.
            }
          }
        }, 50);
      }
      if (event.type === 'browser.handoff' && event.handoff.state === 'waiting') {
        seen.handoffs++;
        void signIn(services, chat, site?.url ?? '').catch((e: unknown) =>
          log(`  sign-in failed: ${String(e)}`),
        );
      }
      if (event.type === 'turn.completed') {
        completed.set(chat, (completed.get(chat) ?? 0) + 1);
        const usage = event.usage;
        if (testing() && event.model) tally.answeredWith = event.model;
        if (usage && testing()) {
          tally.tokens.input += usage.inputTokens;
          tally.tokens.output += usage.outputTokens;
          tally.tokens.cached += usage.cachedInputTokens ?? 0;
          const price = priceOf(event.model);
          if (usage.costUsd !== undefined) cost += usage.costUsd;
          else if (price) cost += costAt(price, usage);
          else costKnown = false;
        }
        for (const w of wake) w();
      }
      if (event.type === 'turn.needs-apps' || event.type === 'turn.held') for (const w of wake) w();
    });

    const deadline = Date.now() + (task.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const say: Scene['say'] = async (text, opts = {}) => {
      const as = opts.as ?? options.model;
      speaking = as;
      const before = opts.chat ? (completed.get(opts.chat) ?? 0) : 0;
      const began = Date.now();
      const convo = await services.conversations.send({
        ...(opts.chat && { conversationId: opts.chat }),
        clientMessageId: `eval-${Math.random().toString(36).slice(2)}`,
        text,
        options: {
          engine: as.engine as EngineId,
          ...(as.model && { model: as.model }),
          permissionMode: mode,
        },
      });
      const chat = convo.id;
      const firstSeq =
        (await services.conversations.detail(chat)).events.findLast(
          (e) => e.type === 'user.message',
        )?.seq ?? 0;
      const turnEvents = async () =>
        (await services.conversations.detail(chat)).events.filter((e) => e.seq >= firstSeq);
      let outcome: Turn['outcome'] | undefined;
      while (!outcome) {
        if ((completed.get(chat) ?? 0) > before) break;
        const events = await turnEvents();
        if (events.some((e) => e.type === 'turn.needs-apps')) outcome = 'needs-apps';
        else if (events.some((e) => e.type === 'turn.held')) outcome = 'held';
        else if (Date.now() > deadline) {
          outcome = 'timeout';
          await services.conversations.interrupt(chat).catch(() => undefined);
        } else
          await new Promise<void>((r) => {
            const done = () => {
              wake.delete(done);
              clearTimeout(timer);
              r();
            };
            const timer = setTimeout(done, 1000);
            wake.add(done);
          });
      }
      if (as === options.model) {
        tally.latencyMs += Date.now() - began;
        tally.turns++;
      }
      const events = await turnEvents();
      const end = events.findLast(
        (e): e is Extract<ConversationEvent, { type: 'turn.completed' }> =>
          e.type === 'turn.completed',
      );
      const said = events
        .flatMap((e) => (e.type === 'assistant.delta' && e.kind === 'text' ? [e.delta] : []))
        .join('');
      log(
        `  [${as.id}] ${(outcome ?? end?.outcome ?? '?').padEnd(8)} ${said.replace(/\s+/g, ' ').slice(0, 160)}`,
      );
      return {
        chat,
        text: said,
        outcome: outcome ?? end?.outcome ?? 'error',
        ...(end?.error && { error: end.error }),
      };
    };

    const scene: Scene = {
      siteUrl: site.url,
      submissions: site.submissions,
      workspace,
      say,
      ledgerCalls: async () =>
        (await readFile(ledgerLog, 'utf8').catch(() => ''))
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { tool: string; args: Record<string, unknown> }),
      memories: async () => (await services.memory.list()).map((m) => m.content),
      // As if the chat had gone quiet (ADR 0088): with the model under test's provider.
      review: async (chat) => {
        const result = await services.learning.review(chat, { trigger: 'idle' });
        return 'learned' in result
          ? { learned: result.learned.map((e) => e.after.content) }
          : { learned: [], why: result.why };
      },
      onQuestion: (fn) => (answer = fn),
      seen,
      ...(options.partner && { partner: options.partner }),
    };

    let verdict: Verdict;
    try {
      verdict = await task.run(scene);
    } finally {
      off();
      if (options.traceTo) {
        const chats = await services.conversations.list().catch(() => []);
        const trace = await Promise.all(
          chats.map(async (c) => ({
            id: c.id,
            events: await services.conversations.eventsAfter(c.id).catch(() => []),
          })),
        );
        await mkdir(options.traceTo, { recursive: true });
        await writeFile(
          join(options.traceTo, `${options.model.id}.${task.id}.json`),
          JSON.stringify({ tally, seen, trace }, null, 2),
        ).catch(() => undefined);
      }
    }
    if (costKnown) tally.costUsd = Math.round(cost * 1e6) / 1e6;
    // Asking for something outside the task is a failure, whatever else happened.
    if (verdict.status === 'pass' && tally.denials.length)
      verdict = { status: 'fail', reason: `asked to step outside the task: ${tally.denials[0]}` };
    return { ...verdict, ...tally };
  } catch (error) {
    return {
      status: 'error',
      reason: String((error as Error).message ?? error).slice(0, 300),
      ...tally,
    };
  } finally {
    await conch?.stop();
    await site?.close();
  }
}

/**
 * The person signs in themselves, in the page Conch handed over, then hands it
 * back — what a person does with the live view.
 */
async function signIn(services: Services, chat: string, siteUrl: string): Promise<void> {
  let tab = services.browser.tabIfOpen(chat);
  for (let i = 0; i < 40 && tab?.control !== 'user'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    tab = services.browser.tabIfOpen(chat);
  }
  if (!tab) return;
  const page = tab.page;
  if (!(await page.locator('#password').count())) await page.goto(`${siteUrl}/login?next=/account`);
  await page.fill('#username', SITE.login.username);
  await page.fill('#password', SITE.login.password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded').catch(() => undefined),
    page.click('button[type=submit]'),
  ]);
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  tab.setControl('idle');
}
