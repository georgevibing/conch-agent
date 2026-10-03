import { ActivityKind, type SafetyStatus } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { Activity } from '../activity/service';
import { isAtLeast } from '../engines/codex/detect';
import { PROFILES_VERSION } from '../engines/codex/engine';
import type { Engine } from '../engines/types';
import { sandboxSupport, secretPlaces } from './sandbox';

type Coverage = SafetyStatus['providers'][number];

/**
 * What "Seal commands" means for each provider you use (ADR 0031). Claude
 * Code seals with the computer's own sandbox; Codex with its own, which reads
 * Conch's lists from 0.159; API providers run no commands at all. Where the
 * computer can't seal (Windows, Linux without bubblewrap), it says so.
 */
export function coverage(
  providers: { id: string; label: string; version?: string; commandSandbox?: 'conch' }[],
  options: { available: boolean; on: boolean },
): Coverage[] {
  return providers.map(({ id, label, version, commandSandbox }): Coverage => {
    const base = { id, label };
    if (commandSandbox === 'conch')
      return options.available
        ? {
            ...base,
            state: 'sealed',
            note: 'Conch commands always run sealed: writes stay in the work folder, secrets and network are blocked. There is no unrestricted fallback.',
          }
        : {
            ...base,
            state: 'no-commands',
            note: 'Commands are unavailable until this computer’s sandbox is set up. Files and connected apps still work.',
          };
    if (id !== 'claude-code' && id !== 'codex-cli')
      return {
        ...base,
        state: 'no-commands',
        note: 'Runs no commands on this computer: it uses Conch’s tools, which ask as usual.',
      };
    if (!options.available)
      return { ...base, state: 'not-sealed', note: 'This computer can’t seal its commands yet.' };
    if (!options.on)
      return {
        ...base,
        state: 'not-sealed',
        note: 'Sealing is off, so its commands aren’t sealed.',
      };
    if (id === 'claude-code')
      return {
        ...base,
        state: 'sealed',
        note: 'Commands run sealed: your work folder and caches only, never where keys live.',
      };
    if (version && isAtLeast(version, PROFILES_VERSION))
      return {
        ...base,
        state: 'sealed',
        note: 'Runs in Codex’s own sandbox with Conch’s lists: your work folder and caches only, never where keys live. Full trust keeps it in the work folder.',
      };
    return {
      ...base,
      state: 'partly',
      note: `Codex keeps to your work folder, but ${version ? `version ${version}` : 'this build'} can still read where keys live. Codex ${PROFILES_VERSION} or newer can’t.`,
    };
  });
}

/**
 * Safe hands (ADR 0028): whether commands can be sealed here and what that
 * protects, and everything the assistant did (the activity timeline).
 */
export interface CoverageDeps {
  providers: () => Promise<Engine[]>;
  sealing: () => Promise<boolean>;
}

/** The same, for the providers you use right now. */
export async function providerCoverage(deps: CoverageDeps, available = sandboxSupport().available) {
  const engines = await deps.providers().catch(() => []);
  const providers = await Promise.all(
    engines.map(async (engine) => ({
      id: engine.id,
      label: engine.label,
      commandSandbox: engine.commandSandbox,
      version: (await engine.detect().catch(() => undefined))?.version,
    })),
  );
  return coverage(providers, { available, on: await deps.sealing().catch(() => true) });
}

export function registerSafetyRoutes(
  app: FastifyInstance,
  activity: Activity,
  deps: CoverageDeps = { providers: async () => [], sealing: async () => true },
): void {
  app.get<{ Querystring: { before?: string; kind?: string; limit?: string; q?: string } }>(
    '/api/activity',
    async (request, reply) => {
      const kind = request.query.kind ? ActivityKind.safeParse(request.query.kind) : undefined;
      if (kind && !kind.success)
        return reply.code(400).send({ error: 'bad-request', message: 'Not a kind of activity.' });
      const q = request.query.q?.trim().slice(0, 200);
      const before = Number(request.query.before);
      const limit = Number(request.query.limit);
      return activity.page({
        ...(Number.isFinite(before) && before > 0 && { before }),
        ...(kind?.success && { kind: kind.data }),
        ...(Number.isFinite(limit) && limit > 0 && { limit }),
        ...(q && { q }),
      });
    },
  );

  app.get('/api/safety', async (): Promise<SafetyStatus> => {
    const support = sandboxSupport();
    return {
      providers: await providerCoverage(deps, support.available),
      sandbox: {
        available: support.available,
        ...(!support.available && { reason: support.reason }),
        ...(!support.available && support.command && { command: support.command }),
        protects: [
          ...new Set(['Conch’s passwords and keys', ...secretPlaces().map((p) => p.what)]),
        ],
      },
    };
  });
}
