import type { Integration } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool } from '../engines/types';

/** What `apps_check` needs of the integrations: the list, and a fresh look at one. */
export interface AppsChecker {
  list(): Promise<{ integrations: Integration[] }>;
  check(id: string): Promise<unknown>;
  get(id: string): Promise<Integration>;
}

/** Enough tool names to know what an app offers, without filling the context. */
const NAMED = 12;

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The apps a word means: its server name, its name, or its catalog id, else nothing. */
function matching(all: Integration[], app: string | undefined): Integration[] {
  if (!app?.trim())
    return all.filter((i) => i.enabled && !['ok', 'warning'].includes(i.health.state));
  const want = plain(app);
  return all.filter(
    (i) =>
      i.server === app || plain(i.name) === want || (i.catalogId && plain(i.catalogId) === want),
  );
}

/** One app's state as a few sentences a model can act on (working agreement 11). */
export function appWords(item: Integration): string {
  const h = item.health;
  const name = item.name;
  if (!item.enabled || h.state === 'off')
    return `${name} is turned off by the person. Don’t turn it on yourself: reach the same thing another way, or ask them.`;
  if (h.state === 'ok' || h.state === 'warning') {
    const tools = item.tools.map((t) => t.name);
    const named = tools.slice(0, NAMED).join(', ') + (tools.length > NAMED ? ', …' : '');
    return [
      `${name} works${tools.length ? ` (${tools.length} tools, named mcp__${item.server}__<tool>: ${named})` : ''}.${h.state === 'warning' && h.message ? ` ${h.message}` : ''}`,
      `If its tools aren’t in your list right now, they arrive with the person’s next message; meanwhile reach the same thing another way (its command-line program on this computer, its API) rather than stopping.`,
    ].join(' ');
  }
  if (h.state === 'needs-auth')
    return `${name} needs the person to sign in again (${h.message ?? 'its sign-in expired'}): only they can, from Apps → ${name}. Ask in one line, and carry on with whatever doesn’t need it, or reach it another way (its command-line program, if it’s signed in here).`;
  if (h.state === 'connecting' || h.state === 'checking')
    return `${name} is still connecting. Try its tools again in a moment, or reach the same thing another way meanwhile.`;
  const detail = h.detail ? ` (${h.detail})` : '';
  if (h.action === 'retry' || h.retryAt)
    return `${name} can’t be reached right now${detail}. Conch keeps trying by itself. Meanwhile reach the same thing another way: its command-line program on this computer, its API, or another tool.`;
  return `${name} isn’t working: ${h.message ?? 'something went wrong connecting'}${detail}. The person fixes that in Apps → ${name}; tell them in one line, and reach the same thing another way meanwhile.`;
}

/**
 * Lets the model have Conch look at a connected app again mid-turn (ADR 0049):
 * the same check Apps runs, which reconnects it and renews a sign-in when it
 * can. It never connects a new app, turns one on, or changes what it may do.
 */
export function appsCheckTool(apps: AppsChecker): HostTool<{ app: z.ZodOptional<z.ZodString> }> {
  return {
    name: 'apps_check',
    description:
      'Have Conch look at a connected app again, now: when its tools failed, timed out or dropped, when they seem missing from your list, or when you were told it isn’t working. Conch reconnects it and renews its sign-in if it can, and says whether it works, what it offers, and what to do next. Call this before you tell the person an app is broken. It never connects a new app (use `offer`) or changes its settings.',
    input: {
      app: z
        .string()
        .max(120)
        .optional()
        .describe(
          'The app’s name or server, like "GitHub" or "github". Leave it out to look at every app that isn’t working.',
        ),
    },
    effect: 'read',
    searchHint: 'reconnect, repair or re-check a connected app whose tools failed or are missing',
    async run({ app }) {
      const all = (await apps.list()).integrations;
      const found = matching(all, app);
      if (!found.length) {
        const names = all.filter((i) => i.enabled).map((i) => i.name);
        return app?.trim()
          ? `No connected app matches “${app}”.${names.length ? ` Connected: ${names.join(', ')}.` : ''} To connect one, use \`offer\`.`
          : 'Every connected app is working.';
      }
      const lines = await Promise.all(
        found.map(async (item) => {
          if (!item.enabled) return appWords(item);
          await apps.check(item.id).catch(() => undefined);
          return appWords(await apps.get(item.id).catch(() => item));
        }),
      );
      return lines.join('\n');
    },
  };
}
