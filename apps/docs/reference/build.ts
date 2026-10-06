/**
 * Reads the code and says what's there: every provider, channel, app, command,
 * setting and message, straight from the modules that define them. Run by
 * `plugin.ts` whenever the documentation starts, builds or is tested, so the
 * reference pages are never a copy that someone has to remember to update.
 *
 * Adding a source: import it here, add its shape to `types.ts`, and draw it
 * with an embed in `src/embeds`. The dev server reloads when a source changes
 * (`plugin.ts` watches the folders this file reads).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ClientCommand,
  ConversationEvent,
  PROTOCOL_VERSION,
  ServerEvent,
  VaultSourceId,
} from '@conch/protocol';
import { z } from 'zod';

import { RULES } from '../../server/src/backup/manifest';
import { CHANNEL_CATALOG } from '../../server/src/channels/catalog';
import { CLI_COMMANDS } from '../../server/src/cliCommands';
import { Env, ENV_ABOUT } from '../../server/src/config';
import { builtInEngines } from '../../server/src/engines/registry';
import type { Engine } from '../../server/src/engines/types';
import { publicCatalog } from '../../server/src/integrations/catalog';
import { PROVIDER_COPY, PROVIDER_ORDER, SERVER_COPY } from '../../server/src/providers/catalog';
import { ProviderKeys } from '../../server/src/providers/keys';
import { SettingsStore } from '../../server/src/settings/store';
import { KNOWN_NEEDS } from '../../server/src/setup/known';
import type { InstallRecipe, Platform } from '../../server/src/setup/needs';
import { SERVER_VERSION } from '../../server/src/version';
import { builtins, sectionLabels } from '../../web/src/features/commands/slash';
import { effortLabels, modeWords } from '../../web/src/features/models/words';
import type {
  EnvRef,
  FieldRef,
  FileRef,
  MessageRef,
  NeedRef,
  ProviderRef,
  Reference,
  RouteRef,
} from './types';

const REPO = resolve(import.meta.dirname, '../../..');
const SERVER = join(REPO, 'apps/server/src');
const WEB = join(REPO, 'apps/web/src');

/** Every source file under a folder, tests and pretend apps left out. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'mock' && entry.name !== 'test') sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

// ── Providers ──────────────────────────────────────────────────────────────

/**
 * The engines as `Services` builds them, in an empty folder: only what each one
 * declares about itself is read, and nothing is detected, signed in or run.
 */
function engines(home: string): Map<string, Engine> {
  const settings = new SettingsStore(home);
  const keys = new ProviderKeys(settings);
  // The same registry `Services` builds from, so a new provider is in the docs by itself.
  return builtInEngines({ settings, keys, home, local: {} as never });
}

function providers(): ProviderRef[] {
  const home = mkdtempSync(join(tmpdir(), 'conch-docs-'));
  try {
    const built = engines(home);
    return PROVIDER_ORDER.flatMap((id): ProviderRef[] => {
      const copy = PROVIDER_COPY.get(id);
      const engine = built.get(id);
      if (!copy || copy.internal || !engine) return [];
      return [
        {
          id,
          name: copy.name,
          tagline: copy.tagline,
          description: copy.description,
          connect: copy.connect === 'key' ? 'key' : 'program',
          group: copy.group,
          ...(copy.free && { free: copy.free }),
          highlights: copy.highlights,
          limits: copy.limits ?? [],
          experimental: copy.experimental ?? false,
          color: copy.color,
          homepage: copy.homepage,
          ...(copy.keyForm && {
            key: {
              label: copy.keyForm.label,
              placeholder: copy.keyForm.placeholder,
              url: copy.keyForm.url,
              canSignIn: copy.keyForm.canSignIn,
            },
          }),
          can: {
            asksFirst: copy.asksFirst,
            files: engine.attachments?.files ?? false,
            images: engine.attachments?.images ?? false,
            hostTools: engine.hostTools ?? true,
            offline: engine.local ?? false,
            apps: engine.integrations.mode === 'native' ? 'itself' : 'through Conch',
            account: engine.integrations.account?.label,
          },
        },
      ];
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ── Configuration ──────────────────────────────────────────────────────────

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  additionalProperties?: unknown;
}

function env(): EnvRef[] {
  const schema = z.toJSONSchema(Env, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  return Object.entries(ENV_ABOUT).map(([name, about]): EnvRef => {
    const property = schema.properties?.[name] ?? {};
    // The home folder's default is this computer's own path: say it in general.
    const fallback = name === 'CONCH_HOME' ? undefined : property.default;
    return {
      name,
      about: about.about,
      ...(fallback !== undefined && fallback !== '' && { default: String(fallback) }),
      ...(about.unset && { unset: about.unset }),
      ...(property.enum && { values: property.enum.map(String) }),
      internal: about.internal ?? false,
    };
  });
}

// ── Files ──────────────────────────────────────────────────────────────────

function files(): FileRef[] {
  return RULES.flatMap((rule): FileRef[] =>
    // Rules written as a function match names no pattern says well: nothing to show.
    typeof rule.match === 'string'
      ? [{ path: rule.match, class: rule.class, group: rule.group, why: rule.why }]
      : [],
  );
}

// ── What Conch gets for you ────────────────────────────────────────────────

const MANAGER: Record<InstallRecipe['manager'], string> = {
  winget: 'winget',
  brew: 'brew',
  npm: 'npm',
  uv: 'uv',
  self: '',
  github: '',
};

/** The flags that only keep an installer quiet say nothing to a reader. */
const QUIET = new Set([
  '--exact',
  '--source',
  'winget',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--disable-interactivity',
]);

function command(recipe: InstallRecipe): string {
  // Conch fetches it itself, from the project's own release (ADR 0077).
  if (recipe.manager === 'github')
    return `Conch downloads ${recipe.args[1] ?? ''} from github.com/${recipe.args[0] ?? ''}`;
  const args = recipe.args.filter((arg, i) => !(QUIET.has(arg) && i > 0));
  return [MANAGER[recipe.manager], ...args].filter(Boolean).join(' ');
}

function needs(): NeedRef[] {
  const all: Platform[] = ['win32', 'darwin', 'linux'];
  return [...KNOWN_NEEDS.values()].map((need): NeedRef => {
    const platforms: NeedRef['platforms'] = {};
    for (const platform of need.platforms ?? all) {
      const recipes = need.install?.[platform];
      const first = Array.isArray(recipes) ? recipes[0] : recipes;
      platforms[platform] = {
        ...(first && { install: command(first) }),
        ...(need.download?.[platform] && { download: need.download[platform] }),
      };
    }
    const bringer = need.comesWith ? KNOWN_NEEDS.get(need.comesWith)?.name : undefined;
    return {
      id: need.id,
      name: need.name,
      platforms,
      updates: Boolean(need.update),
      ...(bringer && { comesWith: bringer }),
    };
  });
}

// ── The app's own API ──────────────────────────────────────────────────────

const ROUTE = /\bapp\.(get|post|put|patch|delete)\b[^('"`]*\(\s*['"`]([^'"`]+)['"`]/g;

function routes(): RouteRef[] {
  const found = new Map<string, RouteRef>();
  for (const file of sourceFiles(SERVER)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(ROUTE)) {
      const method = (match[1] ?? '').toUpperCase() as RouteRef['method'];
      // A route written once for several actions (`/${action}`) reads as a parameter.
      const path = (match[2] ?? '').replace(/\$\{(\w+)\}/g, ':$1');
      if (!path.startsWith('/api/') || path.includes('/mock')) continue;
      const area = path.split('/')[2] ?? '';
      found.set(`${method} ${path}`, { method, path, area });
    }
  }
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return [...found.values()].sort(
    (a, b) =>
      a.area.localeCompare(b.area) ||
      a.path.localeCompare(b.path) ||
      order.indexOf(a.method) - order.indexOf(b.method),
  );
}

// ── The live socket ────────────────────────────────────────────────────────

/** A JSON Schema as the few words a reader needs: `string`, `'a' | 'b'`, `Thing[]`. */
function typeOf(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? 'object';
  if (schema.const !== undefined) return JSON.stringify(schema.const).replaceAll('"', "'");
  if (schema.enum) {
    const values = schema.enum.map((value) => JSON.stringify(value).replaceAll('"', "'"));
    return values.length > 6 ? `${values.slice(0, 5).join(' | ')} | …` : values.join(' | ');
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (union) {
    const kinds = [...new Set(union.map(typeOf))];
    return kinds.length > 4 ? 'object' : kinds.join(' | ');
  }
  if (schema.allOf) return 'object';
  if (schema.type === 'array') {
    const item = typeOf(schema.items);
    return item.includes(' ') ? `(${item})[]` : `${item}[]`;
  }
  if (schema.type === 'integer') return 'number';
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return schema.type ?? 'unknown';
}

function messages(union: z.ZodType): MessageRef[] {
  const schema = z.toJSONSchema(union, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  return (schema.oneOf ?? schema.anyOf ?? []).map((option): MessageRef => {
    const required = new Set(option.required ?? []);
    const fields = Object.entries(option.properties ?? {})
      .filter(([name]) => name !== 'type')
      .map(([name, field]): FieldRef => ({
        name,
        type: typeOf(field),
        optional: !required.has(name),
      }));
    return { type: String(option.properties?.type?.const ?? ''), fields };
  });
}

// ── Keys the app listens for ───────────────────────────────────────────────

function hotkeys(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(WEB)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/useHotkey\(\s*'([^']+)'/g))
      if (match[1]) found.add(match[1]);
  }
  return [...found].sort();
}

export function buildReference(): Reference {
  return {
    version: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    providers: providers(),
    server: {
      name: SERVER_COPY.name,
      tagline: SERVER_COPY.tagline,
      description: SERVER_COPY.description,
      highlights: [...SERVER_COPY.highlights],
      limits: [...SERVER_COPY.limits],
      color: SERVER_COPY.color,
    },
    channels: CHANNEL_CATALOG.map(({ id, name, tagline, color, minutes, available, groups }) => ({
      id,
      name,
      tagline,
      color,
      minutes,
      available,
      ...(groups && { groups }),
    })),
    integrations: publicCatalog().map((app) => ({
      id: app.id,
      name: app.name,
      tagline: app.tagline,
      description: app.description,
      category: app.category,
      auth: app.auth,
      color: app.color,
      homepage: app.homepage,
      featured: app.featured,
      examples: app.examples,
      access: app.access,
      local: app.local,
    })),
    cli: CLI_COMMANDS.map((command) => ({
      name: command.name,
      usage: command.usage,
      summary: command.summary,
      group: command.group,
      detail: command.detail,
      subcommands: 'subcommands' in command ? [...command.subcommands] : [],
    })),
    env: env(),
    modes: modeWords.map(({ value, label, description, tone }) => ({
      value,
      label,
      description,
      tone,
    })),
    efforts: Object.entries(effortLabels).map(([value, words]) => ({ value, ...words })),
    slash: builtins.map(({ name, description, argumentHint, aliases, section }) => ({
      name,
      description,
      argumentHint,
      aliases: aliases ?? [],
      section: sectionLabels[section],
    })),
    files: files(),
    needs: needs(),
    routes: routes(),
    socket: {
      commands: messages(ClientCommand),
      events: messages(ServerEvent),
      conversation: messages(ConversationEvent),
    },
    hotkeys: hotkeys(),
    passwordManagers: VaultSourceId.options.filter((id) => id !== 'conch' && id !== 'system'),
  };
}
