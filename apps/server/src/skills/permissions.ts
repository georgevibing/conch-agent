/**
 * What a skill may do (ADR 0031), said in plain words and held to while the
 * skill is in use.
 *
 * A skill says it in its front matter, either the Agent Skills way —
 * `allowed-tools: Bash(git:*) Read Edit` — or Conch's own words —
 * `permissions: commands, apps` — and Conch turns either into the same short
 * list a person can read ("run commands (only git)", "use your connected
 * apps"). A skill that says nothing may read and change files in the work
 * folder and read the web; the rest asks first, and the page says so.
 *
 * Reading is never limited: looking at files, searching, remembering are how
 * any skill works. What's limited is what can hurt: commands, files outside
 * the work folder, acting on websites, apps, passwords.
 */
import { isAbsolute, relative, resolve } from 'node:path';

import type { SkillCapability, SkillPermissions } from '@conch/protocol';

import { readList } from './frontmatter';

const WORDS: Record<SkillCapability, string> = {
  commands: 'run commands',
  files: 'change files in your work folder',
  'files-anywhere': 'change files anywhere on this computer',
  web: 'read the web',
  browser: 'act on websites in the browser',
  apps: 'use your connected apps',
  passwords: 'use your saved passwords',
};

const ORDER = Object.keys(WORDS) as SkillCapability[];

/** Undeclared: the work a skill needs, nothing that reaches past it. */
export const DEFAULT_CAPABILITIES: SkillCapability[] = ['files', 'web'];

/** `Bash(git add:*) Read` and `Bash(git:*), Read` both: items, brackets kept together. */
function tokens(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    let depth = 0;
    let current = '';
    for (const ch of item) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (/\s/.test(ch) && depth === 0) {
        if (current) out.push(current);
        current = '';
      } else current += ch;
    }
    if (current) out.push(current);
  }
  return out;
}

/** `git add:*` → `git add`; `npm test` → `npm test`. */
const prefixOf = (spec: string) => spec.replace(/:\*$|\*$/, '').trim();

/** What the skill's front matter says it may do. */
export function readPermissions(front: string | undefined): SkillPermissions {
  const tools = readList(front, 'allowed-tools');
  const own = readList(front, 'permissions');
  if (!tools?.length && !own?.length)
    return {
      declared: false,
      capabilities: DEFAULT_CAPABILITIES,
      words: DEFAULT_CAPABILITIES.map((c) => WORDS[c]),
    };
  const can = new Set<SkillCapability>();
  const commands: string[] = [];
  const apps: string[] = [];
  let anyCommand = false;
  for (const token of tokens(tools ?? [])) {
    const call = /^([A-Za-z_][\w-]*)(?:\((.*)\))?$/.exec(token);
    const name = call?.[1] ?? token;
    const spec = call?.[2]?.trim();
    if (name === 'Bash') {
      can.add('commands');
      if (spec && spec !== '*') commands.push(...spec.split(',').map(prefixOf).filter(Boolean));
      else anyCommand = true;
    } else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) can.add('files');
    else if (['WebFetch', 'WebSearch'].includes(name)) can.add('web');
    else if (name.startsWith('mcp__')) {
      can.add('apps');
      const server = /^mcp__([a-z0-9_-]+?)__/.exec(name)?.[1] ?? name.slice(5);
      if (!apps.includes(server)) apps.push(server);
    }
  }
  for (const word of own ?? []) {
    const [capability, detail] = word.split(':').map((part) => part.trim());
    if (!capability || !(capability in WORDS)) continue;
    can.add(capability as SkillCapability);
    if (capability === 'apps' && detail) apps.push(detail.toLowerCase());
    if (capability === 'commands' && !detail) anyCommand = true;
    if (capability === 'commands' && detail) commands.push(detail);
  }
  const capabilities = ORDER.filter((c) => can.has(c));
  const onlyCommands = !anyCommand && commands.length ? [...new Set(commands)] : undefined;
  const onlyApps = apps.length ? [...new Set(apps)] : undefined;
  return {
    declared: true,
    capabilities,
    ...(onlyCommands && { commands: onlyCommands }),
    ...(onlyApps && { apps: onlyApps }),
    words: capabilities.map((c) =>
      c === 'commands' && onlyCommands
        ? `${WORDS.commands} (only ${onlyCommands.map((p) => `\`${p}\``).join(', ')})`
        : c === 'apps' && onlyApps
          ? `${WORDS.apps} (only ${onlyApps.join(', ')})`
          : WORDS[c],
    ),
  };
}

/** For the front matter Conch writes for its own skills. */
export function writePermissions(capabilities: SkillCapability[]): string {
  return ORDER.filter((c) => capabilities.includes(c)).join(', ');
}

/**
 * The `permissions:` value for a list with its "only" parts (ADR 0058):
 * `commands:git, commands:npm, files`. Nothing at all is `none`, which
 * `readPermissions` reads as declared and empty: it may only read.
 */
export function permissionsValue(p: {
  capabilities: readonly SkillCapability[];
  commands?: readonly string[];
  apps?: readonly string[];
}): string {
  const parts = ORDER.filter((c) => p.capabilities.includes(c)).flatMap((c) =>
    c === 'commands' && p.commands?.length
      ? p.commands.map((command) => `commands:${command}`)
      : c === 'apps' && p.apps?.length
        ? p.apps.map((app) => `apps:${app}`)
        : [c],
  );
  return parts.length ? parts.join(', ') : 'none';
}

const inside = (dir: string, path: string) => {
  const rel = relative(resolve(dir), resolve(dir, path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const BROWSER_READS = /^(?:mcp__conch__)?browser_(?:open|read|screenshot|back|scroll|wait|tabs)$/;
const BROWSER_ACTS =
  /^(?:mcp__conch__)?browser_(?:click|click_at|type|select|press|handoff|passkey|upload)$/;

/**
 * What this tool call needs from a skill, and whether the skill's list has
 * it. `undefined`: anything goes (reading, remembering, Conch's own tools).
 */
export function needs(
  toolName: string,
  input: unknown,
  context: { workspace: string; server?: string },
): { capability: SkillCapability; detail?: string } | undefined {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (/^(?:mcp__conch__)?image_generate$/.test(toolName))
    return { capability: 'apps', detail: 'openrouter' };
  if (/^(?:mcp__conch__)?google_/.test(toolName)) return { capability: 'apps', detail: 'google' };
  if (/^(?:mcp__conch__)?slack_/.test(toolName)) return { capability: 'apps', detail: 'slack' };
  if (/^(?:mcp__conch__)?task_control$/.test(toolName) && args.action !== 'stop')
    return { capability: 'commands', detail: '' };
  if (/^(?:mcp__conch__)?process_write$/.test(toolName))
    return { capability: 'commands', detail: '' };
  if (toolName === 'Bash' || /^(?:mcp__conch__)?process_start$/.test(toolName))
    return { capability: 'commands', detail: typeof args.command === 'string' ? args.command : '' };
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
    const path = String(args.file_path ?? args.notebook_path ?? '');
    return { capability: path && !inside(context.workspace, path) ? 'files-anywhere' : 'files' };
  }
  if (
    /(?:WebFetch|WebSearch|web_fetch|web_search|product_details)$/.test(toolName) ||
    /^(?:mcp__conch__)?recipe$/.test(toolName) ||
    BROWSER_READS.test(toolName)
  )
    return { capability: 'web' };
  if (BROWSER_ACTS.test(toolName)) return { capability: 'browser' };
  if (/^(?:mcp__conch__)?passwords_/.test(toolName)) return { capability: 'passwords' };
  const integration = /^mcp__([a-z0-9_-]+?)__/.exec(toolName)?.[1];
  if (integration && integration !== 'conch') return { capability: 'apps', detail: integration };
  return undefined;
}

/** Whether the skill may do it: the capability, and its "only" list when it has one. */
export function allows(
  permissions: SkillPermissions,
  need: { capability: SkillCapability; detail?: string },
): boolean {
  const has = permissions.capabilities.includes(need.capability);
  // Allowed anywhere covers the work folder too.
  if (!has && !(need.capability === 'files' && permissions.capabilities.includes('files-anywhere')))
    return false;
  if (need.capability === 'commands' && permissions.commands) {
    const command = (need.detail ?? '').trim();
    // Each piece of a chained command must be allowed: `git status && curl …` isn't `git`.
    // A redirect's target counts as a piece too: `git log > ~/.zshrc` isn't only `git`.
    const parts = command
      .split(/&|\|\||;|\||\n|\r|`|\$\(|<\(|>/)
      .map((p) => p.trim())
      .filter(Boolean);
    return (
      parts.length > 0 &&
      parts.every((part) =>
        permissions.commands?.some((p) => part === p || part.startsWith(`${p} `)),
      )
    );
  }
  if (need.capability === 'apps' && permissions.apps)
    return permissions.apps.includes((need.detail ?? '').toLowerCase());
  return true;
}

/** "It doesn't say it needs to run commands" — the reason on the card. */
export function missing(need: { capability: SkillCapability; detail?: string }): string {
  if (need.capability === 'commands') return 'run this command';
  if (need.capability === 'apps') return `use ${need.detail ?? 'this app'}`;
  return WORDS[need.capability];
}
