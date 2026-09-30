/**
 * The built-in checks for Repair everything. A new part of Conch that can
 * break adds its own (AGENTS.md agreement 11): look without changing anything,
 * and on repair try every safe fix first; say where things stand in one plain
 * sentence, and give what only a person can do as one action.
 */
import { statfs } from 'node:fs/promises';

import type { DoctorItem, Provider } from '@conch/protocol';

import { secureHome } from '../auth/checkup';
import type { Services } from '../services';
import type { DoctorCheck } from './service';

/** Below this much free space, saving chats and backups starts to fail. */
const LOW_DISK_BYTES = 1024 ** 3;

const PROVIDERS = 'Providers';
const INTEGRATIONS = 'Integrations';
const COMPUTER = 'This computer';
const CHANNELS = 'Channels';

const APP: Record<string, string> = { telegram: 'Telegram', discord: 'Discord', slack: 'Slack' };

function providerItem(provider: Provider, fixed: boolean): DoctorItem {
  const { status } = provider;
  const base = { id: `providers:${provider.id}`, group: PROVIDERS, title: provider.name };
  if (status.state === 'ready')
    return {
      ...base,
      state: fixed ? 'fixed' : 'ok',
      message: fixed
        ? 'Working again.'
        : status.auth?.description
          ? `Ready · ${status.auth.description}`
          : 'Ready.',
    };
  if (status.state === 'signed-out')
    return {
      ...base,
      state: 'needs-you',
      message: 'Signed out.',
      action: { kind: 'open', label: 'Sign in', place: 'providers', focus: provider.id },
    };
  if (status.fix)
    return {
      ...base,
      state: 'needs-you',
      message:
        status.state === 'not-installed'
          ? 'Not on this computer yet.'
          : (status.message ?? 'Needs an update.'),
      action: {
        kind: 'need',
        label: `${status.fix.kind === 'update' ? 'Update' : 'Install'} ${provider.name}`,
        need: status.fix.need,
        mode: status.fix.kind,
      },
    };
  return {
    ...base,
    state: status.state === 'checking' ? 'checking' : 'needs-you',
    message: status.message ?? 'Not answering.',
    action: { kind: 'open', label: 'Open', place: 'providers', focus: provider.id },
  };
}

/** A provider worth mentioning: the default, or one set up (ready, signed in once, or with a key). */
const inUse = (p: Provider) =>
  p.active ||
  (!p.hidden && (p.status.state === 'ready' || p.status.state === 'signed-out' || Boolean(p.key)));

export function providersCheck(services: Services): DoctorCheck {
  return {
    id: 'providers',
    group: PROVIDERS,
    title: 'Your providers',
    async run({ repair }) {
      const before = repair ? await services.providers.list() : undefined;
      // A repair asks each provider afresh: Claude Code falls back to its own copy, and so on.
      const { providers } = await services.providers.list({ force: repair });
      return providers.filter(inUse).map((provider) => {
        const was = before?.providers.find((p) => p.id === provider.id)?.status.state;
        return providerItem(
          provider,
          Boolean(repair && was && was !== 'ready' && provider.status.state === 'ready'),
        );
      });
    },
  };
}

export function integrationsCheck(services: Services): DoctorCheck {
  return {
    id: 'integrations',
    group: INTEGRATIONS,
    title: 'Your apps',
    async run({ repair }) {
      const items = (await services.integrations.store.all()).filter((i) => i.enabled);
      const results: DoctorItem[] = [];
      for (const item of items) {
        const broken = ['error', 'needs-auth'].includes(item.health.state);
        // A repair checks each one again: that renews sign-ins and retries what passes.
        const now =
          repair && broken ? ((await services.integrations.check(item.id)) ?? item) : item;
        const base = { id: `integrations:${item.id}`, group: INTEGRATIONS, title: now.name };
        const { health } = now;
        if (health.state === 'ok' || health.state === 'warning' || health.state === 'checking')
          results.push({
            ...base,
            state: broken ? 'fixed' : health.state === 'warning' ? 'warning' : 'ok',
            message: broken ? 'Working again.' : (health.message ?? 'Working.'),
          });
        else
          results.push({
            ...base,
            state: 'needs-you',
            message: health.message ?? 'Not working.',
            action: {
              kind: 'open',
              label: health.state === 'needs-auth' ? 'Sign in again' : 'Open',
              place: 'integrations',
              focus: now.id,
            },
          });
      }
      return results;
    },
  };
}

/**
 * Your bots on Telegram, Discord and Slack (ADR 0018). A blip reconnects by
 * itself; Repair asks again now. A key the app stopped accepting, or another
 * program reading the bot's messages, only a person can sort out.
 */
export function channelsCheck(services: Services): DoctorCheck {
  return {
    id: 'channels',
    group: CHANNELS,
    title: 'Channels',
    async run({ repair }) {
      const { channels } = await services.channels.list();
      const results: DoctorItem[] = [];
      for (const listed of channels) {
        const broken = ['reconnecting', 'error'].includes(listed.health.state);
        const now =
          repair && broken ? await services.channels.repair(listed.id).catch(() => listed) : listed;
        const base = {
          id: `channels:${now.id}`,
          group: CHANNELS,
          title: `${now.bot.name} on ${APP[now.kind] ?? now.kind}`,
        };
        const { state, message } = now.health;
        if (state === 'off') results.push({ ...base, state: 'off', message: 'Turned off.' });
        else if (state === 'online' || state === 'connecting')
          results.push({
            ...base,
            state: broken ? 'fixed' : 'ok',
            message: broken ? 'Connected again.' : state === 'online' ? 'Online.' : 'Connecting…',
          });
        else if (state === 'reconnecting')
          results.push({
            ...base,
            state: 'warning',
            message: message ?? 'Reconnecting by itself.',
          });
        else
          results.push({
            ...base,
            state: 'needs-you',
            message:
              message ??
              (state === 'needs-token'
                ? 'The app stopped accepting its key.'
                : state === 'conflict'
                  ? 'Another program is reading this bot’s messages.'
                  : 'Not working.'),
            action: {
              kind: 'open',
              label: state === 'needs-token' ? 'Paste a new key' : 'Open',
              place: 'channels',
              focus: now.id,
            },
          });
      }
      return results;
    },
  };
}

export function browserCheck(services: Services): DoctorCheck {
  return {
    id: 'browser',
    group: COMPUTER,
    title: 'Browser',
    async run({ repair }) {
      let status = await services.browser.status();
      if (!status.settings.enabled) return [];
      const base = { id: 'browser', group: COMPUTER, title: 'Browser' };
      const problem = status.phase === 'problem';
      if (repair && problem) status = await services.browser.repair();
      if (status.phase === 'problem')
        return [
          {
            ...base,
            state: 'needs-you',
            message: status.problem?.message ?? 'It won’t start.',
            action: status.problem?.command
              ? { kind: 'command', label: 'Run this once', command: status.problem.command }
              : { kind: 'open', label: 'Open', place: 'browser' },
          },
        ];
      return [
        {
          ...base,
          state: problem ? 'fixed' : 'ok',
          message: problem
            ? 'It starts cleanly again.'
            : status.browser
              ? `Ready · ${status.browser.name}`
              : 'Ready.',
        },
      ];
    },
  };
}

export function searchCheck(services: Services): DoctorCheck {
  return {
    id: 'search',
    group: COMPUTER,
    title: 'Search',
    async run({ repair }) {
      const base = { id: 'search', group: COMPUTER, title: 'Search' };
      const broken = services.search.state === 'unavailable';
      const state = repair && broken ? await services.search.repair() : services.search.state;
      if (state === 'unavailable')
        return [
          {
            ...base,
            state: 'warning',
            message: 'Search isn’t working. Repair builds it again from your chats.',
          },
        ];
      return [
        {
          ...base,
          state: broken ? 'fixed' : 'ok',
          message: broken
            ? 'Built again from your chats.'
            : state === 'catching-up'
              ? 'Catching up with your chats…'
              : 'Up to date.',
        },
      ];
    },
  };
}

export function computerCheck(services: Services): DoctorCheck {
  return {
    id: 'computer',
    group: COMPUTER,
    title: 'Conch’s files',
    async run({ repair }) {
      const home = services.config.CONCH_HOME;
      const items: DoctorItem[] = [];
      if (await services.access.locked())
        items.push({
          id: 'computer:sign-in',
          group: COMPUTER,
          title: 'Sign-in',
          state: 'needs-you',
          message: 'Locked, because Conch couldn’t read who may sign in.',
          action: { kind: 'command', label: 'Run on this computer', command: 'pnpm conch reset' },
        });

      const before = services.homeProblems;
      if (repair && before.length) services.homeProblems = await secureHome(home);
      const problems = services.homeProblems;
      items.push(
        problems.length
          ? {
              id: 'computer:files',
              group: COMPUTER,
              title: 'Conch’s files',
              state: 'needs-you',
              message: 'Other people on this computer could read some of Conch’s files.',
              action: {
                kind: 'command',
                label: 'Make them private',
                command: `chmod -R go-rwx "${home}"`,
              },
            }
          : {
              id: 'computer:files',
              group: COMPUTER,
              title: 'Conch’s files',
              state: repair && before.length ? 'fixed' : 'ok',
              message: repair && before.length ? 'Only you can read them now.' : 'Private to you.',
            },
      );

      try {
        const disk = await statfs(home);
        const free = Number(disk.bavail) * Number(disk.bsize);
        items.push({
          id: 'computer:disk',
          group: COMPUTER,
          title: 'Disk space',
          state: free < LOW_DISK_BYTES ? 'warning' : 'ok',
          message:
            free < LOW_DISK_BYTES
              ? `Almost full (${(free / 1024 ** 3).toFixed(1)} GB free). Chats and backups may fail to save.`
              : `${(free / 1024 ** 3).toFixed(0)} GB free.`,
        });
      } catch {
        // Some systems can't say; nothing to report.
      }
      return items;
    },
  };
}

export function networkCheck(services: Services): DoctorCheck {
  return {
    id: 'network',
    group: COMPUTER,
    title: 'Internet',
    async run() {
      const { online } = await services.network.check();
      if (online)
        return [
          { id: 'network', group: COMPUTER, title: 'Internet', state: 'ok', message: 'Online.' },
        ];
      const local = await services.localReady();
      return [
        {
          id: 'network',
          group: COMPUTER,
          title: 'Internet',
          state: 'warning',
          message: local
            ? `Offline. ${local.label} answers from this computer until you’re back.`
            : 'Offline. Messages wait, and go by themselves when you’re back.',
        },
      ];
    },
  };
}

export function routinesCheck(services: Services): DoctorCheck {
  return {
    id: 'routines',
    group: 'Routines',
    title: 'Your routines',
    async run() {
      const held = services.routines.held();
      const items: DoctorItem[] = [];
      for (const { routineId, engine } of held) {
        const routine = (await services.routines.detail(routineId).catch(() => undefined))?.routine;
        if (!routine) continue;
        const label = services.providers.engineFor(engine).label;
        items.push({
          id: `routines:${routineId}`,
          group: 'Routines',
          title: routine.title,
          state: 'needs-you',
          message: `Waiting for ${label}: it runs as soon as you sign in.`,
          action: { kind: 'open', label: `Sign in to ${label}`, place: 'providers', focus: engine },
        });
      }
      return items;
    },
  };
}

/** Everything built in, in the order the report shows it. */
export function registerCoreChecks(services: Services) {
  for (const check of [
    providersCheck(services),
    integrationsCheck(services),
    browserCheck(services),
    searchCheck(services),
    channelsCheck(services),
    networkCheck(services),
    computerCheck(services),
    routinesCheck(services),
  ])
    services.doctor.register(check);
}
