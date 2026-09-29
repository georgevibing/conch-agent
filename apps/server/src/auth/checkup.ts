import { chmod, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { CheckupItem, PermissionMode } from '@conch/protocol';

import type { Config } from '../config';
import { exposure } from './network';
import type { AccessFile } from './store';

const DAY = 24 * 60 * 60 * 1000;

/**
 * `~/.conch` holds every conversation, memory and credential hash. Make sure
 * only you can read it — tighten it if it isn't. Returns anything that couldn't
 * be fixed.
 */
export async function secureHome(home: string): Promise<string[]> {
  const problems: string[] = [];
  const fix = async (path: string, mode: number) => {
    try {
      const s = await stat(path);
      if ((s.mode & 0o077) !== 0) await chmod(path, mode);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push(path);
    }
  };
  await fix(home, 0o700);
  const entries = await readdir(home, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(home, entry.name);
    if (entry.isDirectory()) await fix(path, 0o700);
    else if (entry.isFile()) await fix(path, 0o600);
  }
  return problems;
}

/**
 * Claude Code applies a folder's own `.claude/settings*.json`: hooks run
 * commands automatically, `permissions.allow` skips prompts, and MCP servers
 * add tools. Fine in your own project; risky in a downloaded one.
 */
export async function workspaceRules(workspace: string): Promise<string[]> {
  const found = new Set<string>();
  for (const file of ['settings.json', 'settings.local.json']) {
    let json: unknown;
    try {
      json = JSON.parse(await readFile(join(workspace, '.claude', file), 'utf8'));
    } catch {
      continue;
    }
    const settings = (json ?? {}) as {
      hooks?: object;
      permissions?: { allow?: unknown[] };
      mcpServers?: object;
      enableAllProjectMcpServers?: boolean;
    };
    if (settings.hooks && Object.keys(settings.hooks).length) found.add('hooks that run commands');
    if (settings.permissions?.allow?.length) found.add('tools allowed without asking');
    if (settings.mcpServers || settings.enableAllProjectMcpServers) found.add('extra tool servers');
  }
  try {
    await stat(join(workspace, '.mcp.json'));
    found.add('extra tool servers');
  } catch {
    // none
  }
  return [...found];
}

export interface CheckupInput {
  config: Config;
  access: AccessFile;
  permissionMode: PermissionMode;
  /** The request asking is on HTTPS (or never leaves this computer). */
  secure: boolean;
  homeProblems: string[];
  tailscale?: string;
  /** From `workspaceRules`. */
  workspaceRules?: string[];
}

/**
 * Plain-language security checkup, most serious first. Every warning says
 * what the risk is and what to do about it.
 */
export function checkup(input: CheckupInput): CheckupItem[] {
  const { config, access } = input;
  const items: CheckupItem[] = [];
  const network = exposure(config) === 'network';

  if (process.getuid?.() === 0) {
    items.push({
      id: 'root',
      level: 'danger',
      title: 'Conch is running as the administrator (root)',
      detail:
        'Anything the assistant does has full control of this computer. Start Conch as your normal user instead.',
    });
  }

  if (access.method === 'none') {
    items.push(
      network
        ? {
            id: 'sign-in',
            level: 'warn',
            title: 'Other devices can’t get in yet',
            detail:
              'Conch is listening on your network, but nobody can sign in until you choose a password or access key. Until then, only this computer can use it.',
          }
        : {
            id: 'sign-in',
            level: 'info',
            title: 'No sign-in on this computer',
            detail:
              'Only this computer can open Conch. If other people use this computer, add a password so they can’t use your assistant.',
          },
    );
  } else {
    items.push({
      id: 'sign-in',
      level: 'ok',
      title:
        access.method === 'password' ? 'Protected by your password' : 'Protected by access keys',
      detail: 'Every device has to sign in, including this one.',
    });
  }

  if (network && !input.secure) {
    items.push({
      id: 'encryption',
      level: 'danger',
      title: 'Your network can see Conch traffic',
      detail:
        'Conch is reachable over plain HTTP, so anyone on the same Wi-Fi could read your conversations — and your password as you sign in. Use Tailscale for an encrypted connection instead.',
      command: `tailscale serve --bg ${config.CONCH_PORT}`,
    });
  } else {
    items.push({
      id: 'encryption',
      level: 'ok',
      title: network ? 'Encrypted connection' : 'Only this computer can connect',
      detail: network
        ? 'Traffic to this device is encrypted.'
        : input.tailscale
          ? 'Other devices can reach it privately through Tailscale.'
          : 'Conch isn’t reachable from your network.',
    });
  }

  if (config.CONCH_TOKEN) {
    items.push({
      id: 'env-token',
      level: 'warn',
      title: 'An access key is set in CONCH_TOKEN',
      detail:
        'Keys in environment variables end up in shell history and crash reports, and can’t be revoked one device at a time. Create an access key here instead, then remove CONCH_TOKEN.',
    });
  }

  if (input.permissionMode === 'bypassPermissions') {
    items.push({
      id: 'full-trust',
      level: 'warn',
      title: 'New chats never ask before acting',
      detail:
        '“Full trust” lets the assistant run any command and change any file without asking. A web page or file it reads could trick it. Choose “Ask first” or “Auto” in Settings → Models & modes.',
    });
  }

  if (input.workspaceRules?.length) {
    items.push({
      id: 'workspace-rules',
      level: 'warn',
      title: 'Your work folder has its own Claude Code rules',
      detail: `It sets ${input.workspaceRules.join(', ')}. They apply to every chat and routine there. Keep them only if you wrote them — a downloaded project could use them to act without asking.`,
    });
  }

  const stale = access.keys.filter((k) => Date.now() - (k.lastUsedAt ?? k.createdAt) > 90 * DAY);
  if (stale.length) {
    items.push({
      id: 'stale-keys',
      level: 'info',
      title: `${stale.length === 1 ? 'An access key hasn’t' : `${stale.length} access keys haven’t`} been used in 90 days`,
      detail: 'Revoke keys you no longer need, so a lost device can’t get back in.',
    });
  }

  if (input.homeProblems.length) {
    items.push({
      id: 'files',
      level: 'danger',
      title: 'Other people on this computer may read your Conch files',
      detail: `Conch couldn’t restrict access to: ${input.homeProblems.join(', ')}.`,
      command: `chmod -R go-rwx ${config.CONCH_HOME}`,
    });
  }

  const order = { danger: 0, warn: 1, info: 2, ok: 3 } as const;
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
