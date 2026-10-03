import { chmod, lstat, readFile, readdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isStaleKey, type CheckupItem, type PermissionMode } from '@conch/protocol';

import type { Config } from '../config';
import { exposure } from './network';
import type { AccessFile } from './store';
import { cliName } from '../cli/command';

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

/** A file in the work folder that gives the agent powers, and which. */
export interface WorkspaceRuleFile {
  /** Relative to the work folder, with forward slashes: `.claude/settings.json`. */
  file: string;
  rules: string[];
}

/** The only files Claude Code reads rules from in a work folder. Fixed names: never from input. */
const RULE_FILES = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'] as const;

/**
 * Claude Code applies a folder's own `.claude/settings*.json`: hooks run
 * commands automatically, `permissions.allow` skips prompts, and MCP servers
 * add tools. Fine in your own project; risky in a downloaded one.
 */
export async function workspaceRuleFiles(workspace: string): Promise<WorkspaceRuleFile[]> {
  const out: WorkspaceRuleFile[] = [];
  for (const file of RULE_FILES) {
    const path = join(workspace, ...file.split('/'));
    if (file === '.mcp.json') {
      try {
        await stat(path);
        out.push({ file, rules: ['extra tool servers'] });
      } catch {
        // none
      }
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      continue;
    }
    const settings = (json ?? {}) as {
      hooks?: object;
      permissions?: { allow?: unknown[] };
      mcpServers?: object;
      enableAllProjectMcpServers?: boolean;
    };
    const rules: string[] = [];
    if (settings.hooks && Object.keys(settings.hooks).length) rules.push('hooks that run commands');
    if (settings.permissions?.allow?.length) rules.push('tools allowed without asking');
    if (settings.mcpServers || settings.enableAllProjectMcpServers)
      rules.push('extra tool servers');
    if (rules.length) out.push({ file, rules });
  }
  return out;
}

/** What the work folder's own rules allow, in words (for the checkup). */
export async function workspaceRules(workspace: string): Promise<string[]> {
  return [...new Set((await workspaceRuleFiles(workspace)).flatMap((f) => f.rules))];
}

/**
 * Turn the work folder's own rules off by renaming each file that grants
 * powers to `<name>.off` (or `.off-2`, …) — never deleting it, so the person
 * can rename it back. Returns the new names, relative to the folder.
 */
export async function setAsideWorkspaceRules(workspace: string): Promise<string[]> {
  const moved: string[] = [];
  for (const { file } of await workspaceRuleFiles(workspace)) {
    const from = join(workspace, ...file.split('/'));
    let to = `${from}.off`;
    for (
      let n = 2;
      await lstat(to).then(
        () => true,
        () => false,
      );
      n++
    )
      to = `${from}.off-${n}`;
    await rename(from, to);
    moved.push(`${file}${to.slice(from.length)}`);
  }
  return moved;
}

/** Shell start-up files that could set `CONCH_TOKEN`, relative to your home folder. */
const PROFILES = [
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.bashrc',
  '.bash_profile',
  '.profile',
  '.config/fish/config.fish',
];

/**
 * Where `CONCH_TOKEN` is set, so the checkup can show the one line that
 * removes it: the shell start-up file that mentions it, if one does. Only
 * the file's name leaves this function, never what's in it.
 */
export async function findTokenProfile(home = homedir()): Promise<string | undefined> {
  for (const profile of PROFILES) {
    try {
      const text = await readFile(join(home, ...profile.split('/')), 'utf8');
      if (/^\s*(?:export\s+|set\s+-gx\s+|set\s+-x\s+)?CONCH_TOKEN[=\s]/m.test(text))
        return `~/${profile}`;
    } catch {
      // not there
    }
  }
  return undefined;
}

/** The one line that stops `CONCH_TOKEN` being set, for this computer. */
export function removeTokenCommand(platform: NodeJS.Platform, profile?: string): string {
  if (platform === 'win32')
    return `[Environment]::SetEnvironmentVariable('CONCH_TOKEN', $null, 'User')`;
  // `-i.bak` works with both GNU and BSD (macOS) sed, and keeps a copy.
  return profile ? `sed -i.bak '/CONCH_TOKEN/d' ${profile}` : 'unset CONCH_TOKEN';
}

export interface CheckupInput {
  config: Config;
  access: AccessFile;
  /** `access.json` couldn't be read, so sign-in is locked (`AccessStore.locked`). */
  accessLocked?: boolean;
  permissionMode: PermissionMode;
  /** The request asking is on HTTPS (or never leaves this computer). */
  secure: boolean;
  homeProblems: string[];
  tailscale?: string;
  /** From `workspaceRules`. */
  workspaceRules?: string[];
  /** Integrations that act without asking. */
  trustedIntegrations?: string[];
  /** Other devices may open terminals (Settings › Terminal). */
  terminalRemote?: boolean;
  /** The agent's browser may open pages on this computer and your network (Settings › Browser). */
  browserLocal?: boolean;
  /** Pages allowed to read live data from this computer (ADR 0046), by host. */
  pagesLocal?: string[];
  /** A connected provider, and whether Conch can ask you before each step with it (the one that can't, if any). */
  provider?: { name: string; asksFirst: boolean };
  /** The shell start-up file that sets `CONCH_TOKEN`, from `findTokenProfile`. */
  tokenProfile?: string;
  /** Defaults to this computer's. */
  platform?: NodeJS.Platform;
  /** Chat apps that reach the assistant, and who besides you may use each. */
  channels?: { app: string; bot: string; others: string[] }[];
  /** The public door (ADR 0045): where the internet reaches it, and for which apps. */
  door?: { url: string; apps: string[] };
  /** Safe hands (ADR 0028): the guard, and the sealed box for commands. */
  safety?: { checkAfterReading: boolean; sealedCommands: boolean; sandboxAvailable: boolean };
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
        'Anything the assistant does has full control of this computer. Stop Conch, then start it again from your own account, without sudo:',
      command: 'pnpm start',
    });
  }

  if (input.accessLocked) {
    items.push({
      id: 'sign-in',
      level: 'danger',
      title: 'Sign-in is locked',
      detail:
        'Conch couldn’t read who may sign in, so nobody can sign in until you reset it on this computer. A copy of the damaged file was kept next to it.',
      command: `${cliName()} reset`,
    });
  } else if (access.method === 'none') {
    items.push(
      network
        ? {
            id: 'sign-in',
            level: 'warn',
            title: 'Other devices can’t get in yet',
            detail:
              'Conch is listening on your network, but nobody can sign in until you choose a password or access key. Until then, only this computer can use it.',
            fix: { kind: 'open', label: 'Choose a password', place: 'sign-in' },
          }
        : {
            id: 'sign-in',
            level: 'info',
            title: 'No sign-in on this computer',
            detail:
              'Only browsers Conch opens on this computer can use it. If other people use your account on this computer, add a password so they can’t use your assistant or open a terminal as you.',
            fix: { kind: 'open', label: 'Add a password', place: 'sign-in' },
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

  if (!input.accessLocked && access.method !== 'none') {
    const now = Date.now();
    const waiting = access.requests.filter((r) => r.rejectedAt === undefined && r.expiresAt > now);
    if (access.approval && waiting.length) {
      const first = access.devices.find((d) => d.id === waiting[0]?.deviceId);
      const who = first ? (first.label ?? first.name) : 'A device';
      items.push({
        id: 'devices-waiting',
        level: 'warn',
        title:
          waiting.length === 1
            ? `${who} is waiting for your approval`
            : `${waiting.length} devices are waiting for your approval`,
        detail:
          'Something signed in with your password or key and is asking to be let in. Approve it only if it’s yours. If it isn’t, someone knows your password: turn it down and change it.',
        command: `${cliName()} devices`,
        fix: { kind: 'open', label: 'Review', place: 'devices' },
      });
    } else if (access.approval) {
      items.push({
        id: 'devices',
        level: 'ok',
        title: 'New devices need your approval',
        detail:
          'Even with the right password or key, a new device can’t use Conch until you approve it on this computer.',
      });
    } else if (network || input.tailscale) {
      items.push({
        id: 'devices',
        level: 'info',
        title: 'Approve new devices for extra protection',
        detail:
          'With this on, someone who learns your password still can’t get in: each new device waits until you approve it on this computer.',
        fix: { kind: 'open', label: 'Turn it on', place: 'devices' },
      });
    }
  }

  if (network && !input.secure) {
    items.push({
      id: 'encryption',
      level: 'danger',
      title: 'Your network can see Conch traffic',
      detail:
        'Conch is reachable over plain HTTP, so anyone on the same Wi-Fi could read your conversations — and your password as you sign in. Use Tailscale for an encrypted connection instead.',
      command: `tailscale serve --bg ${config.CONCH_PORT}`,
      fix: { kind: 'open', label: 'Show me how', place: 'reach' },
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
    const why =
      'Keys in environment variables end up in shell history and crash reports, and can’t be revoked one device at a time.';
    const command = removeTokenCommand(input.platform ?? process.platform, input.tokenProfile);
    items.push(
      access.method === 'none'
        ? {
            id: 'env-token',
            level: 'warn',
            title: 'An access key is set in CONCH_TOKEN',
            detail: `${why} Create an access key here first, then remove CONCH_TOKEN and restart Conch:`,
            command,
            fix: { kind: 'open', label: 'Create a key', place: 'keys' },
          }
        : {
            id: 'env-token',
            level: 'warn',
            title: 'An access key is set in CONCH_TOKEN',
            detail: `${why} Your own sign-in already protects Conch, so remove CONCH_TOKEN and restart Conch:`,
            command,
          },
    );
  }

  if (input.permissionMode === 'bypassPermissions') {
    items.push({
      id: 'full-trust',
      level: 'warn',
      title: 'New chats never ask before acting',
      detail:
        '“Full trust” lets the assistant run any command and change any file without asking. A web page or file it reads could trick it. Go back to asking first — or choose “Auto” in Settings › Models.',
      fix: { kind: 'act', label: 'Ask first', action: 'ask-first' },
    });
  }

  if (input.safety && !input.safety.checkAfterReading)
    items.push({
      id: 'check-after-reading',
      level: 'warn',
      title: 'The assistant acts on what it read without checking',
      detail:
        'A web page, an email or someone else’s message could tell it to send your things somewhere or change this computer, and nothing would stop to ask you. Turn checking back on in Settings › Security › Safety.',
      fix: { kind: 'act', label: 'Turn it on', action: 'check-after-reading' },
    });
  if (input.safety && input.safety.sandboxAvailable && !input.safety.sealedCommands)
    items.push({
      id: 'sealed-commands',
      level: 'info',
      title: 'Commands aren’t sealed',
      detail:
        'Commands the assistant runs can read your SSH keys, cloud sign-ins and browsers’ saved passwords. Sealing them keeps those out of reach and still lets it work in your folder.',
      fix: { kind: 'act', label: 'Seal them', action: 'sealed-commands' },
    });

  const channels = input.channels ?? [];
  if (channels.length && input.permissionMode === 'bypassPermissions') {
    const apps = [...new Set(channels.map((c) => c.app))];
    const list = apps.length === 1 ? apps[0] : `${apps.slice(0, -1).join(', ')} and ${apps.at(-1)}`;
    items.push({
      id: 'channels-full-trust',
      level: 'warn',
      title: `Messages from ${list} run without asking`,
      detail: `Chats started from ${list} use “Full trust” too. Anyone who gets into your ${apps.length === 1 ? 'account' : 'accounts'} there could make the assistant change files or run commands on this computer. Go back to asking first: you’ll get a button to press in the chat.`,
      fix: { kind: 'act', label: 'Ask first', action: 'ask-first' },
    });
  }
  const shared = channels.filter((c) => c.others.length);
  if (shared.length) {
    const people = [...new Set(shared.flatMap((c) => c.others))];
    items.push({
      id: 'channel-people',
      level: 'info',
      title: `${people.length === 1 ? people[0] : `${people.length} other people`} can use your assistant from ${shared.map((c) => c.app).join(' and ')}`,
      detail: `They can ask it things. Anything that could send something out or change this computer comes to you to OK first, in Conch. Remove anyone you no longer want there.`,
      fix: { kind: 'open', label: 'Review', place: 'channels' },
    });
  }

  if (input.door) {
    const apps = input.door.apps.length ? input.door.apps.join(' and ') : 'Teams and WeChat';
    items.push({
      id: 'channel-door',
      level: 'info',
      title: `${input.door.url} is open to the internet, for ${apps}`,
      detail: `It leads to a small door of its own, not to Conch: it lets in only messages ${apps} signed, for the channels you connected, and nothing on this computer can be reached through it. Turn it off when you no longer use ${apps}.`,
      fix: { kind: 'open', label: 'Review', place: 'channels' },
    });
  }

  if (input.workspaceRules?.length) {
    items.push({
      id: 'workspace-rules',
      level: 'warn',
      title: 'Your work folder has its own Claude Code rules',
      detail: `It sets ${input.workspaceRules.join(', ')}. They apply to every chat and routine there. Keep them only if you wrote them — a downloaded project could use them to act without asking. Turning them off renames the files, so you can bring them back.`,
      fix: { kind: 'act', label: 'Turn them off', action: 'workspace-rules-off' },
    });
  }

  if (input.provider && !input.provider.asksFirst) {
    const { name } = input.provider;
    items.push({
      id: 'provider-prompts',
      level: 'warn',
      title: `${name} can’t ask you before each step`,
      detail: `${name} decides inside its own sandbox, so Conch can only choose how much it may touch — it can’t show you each command first. When you chat with one of its models, keep it to reading only — or pick a model from another provider — if that matters to you.`,
      fix: { kind: 'open', label: 'Review', place: 'models' },
    });
  }

  if (input.trustedIntegrations?.length) {
    const names = input.trustedIntegrations;
    const one = names.length === 1;
    items.push({
      id: 'trusted-integrations',
      level: 'warn',
      title: `${one ? `${names[0]} acts` : `${names.length} integrations act`} without asking`,
      detail: `${names.join(', ')} can send, change and delete things on your behalf without checking with you. An email or page the assistant reads could trick it into doing that. Have ${one ? 'it' : 'them'} ask you before changes instead.`,
      fix: { kind: 'act', label: 'Ask before changes', action: 'integrations-ask' },
    });
  }

  if (input.terminalRemote) {
    items.push({
      id: 'terminal-remote',
      level: 'warn',
      title: 'Other devices can open a terminal',
      detail:
        'Anyone signed in on another device can run any command on this computer, after confirming it’s you. If you don’t use terminals away from this computer, turn it off.',
      fix: { kind: 'act', label: 'Turn off', action: 'terminal-remote-off' },
    });
  }

  if (input.browserLocal) {
    items.push({
      id: 'browser-local',
      level: 'warn',
      title: 'The browser can open local apps',
      detail:
        'The assistant’s browser can reach pages on this computer and your network, like a router or a dev server. A web page it visits could try to use them too. Conch itself stays out of reach. If you don’t need it, turn it off.',
      fix: { kind: 'act', label: 'Turn off', action: 'browser-local-off' },
    });
  }

  if (input.pagesLocal?.length) {
    const [first] = input.pagesLocal;
    items.push({
      id: 'pages-local',
      level: 'warn',
      title:
        input.pagesLocal.length === 1
          ? `A page can read from ${first} on this computer`
          : `Pages can read from ${input.pagesLocal.length} addresses on this computer`,
      detail:
        'You let a page the assistant made read live data from a program on this computer, like a dev server. Whatever that program shows, the page can show too. Conch itself stays out of reach. If you don’t need it any more, take it back.',
      fix: { kind: 'open', label: 'Review', place: 'live-data' },
    });
  }

  const stale = access.keys.filter((k) => isStaleKey(k));
  if (stale.length) {
    items.push({
      id: 'stale-keys',
      level: 'info',
      title: `${stale.length === 1 ? 'An access key hasn’t' : `${stale.length} access keys haven’t`} been used in 90 days`,
      detail: 'Revoke keys you no longer need, so a lost device can’t get back in.',
      fix: { kind: 'open', label: 'Review keys', place: 'keys' },
    });
  }

  if (input.homeProblems.length) {
    items.push({
      id: 'files',
      level: 'danger',
      title: 'Other people on this computer may read your Conch files',
      detail: `Conch couldn’t restrict access to: ${input.homeProblems.join(', ')}. If making them private doesn’t work, run:`,
      command: `chmod -R go-rwx ${config.CONCH_HOME}`,
      fix: { kind: 'act', label: 'Make them private', action: 'secure-files' },
    });
  }

  const order = { danger: 0, warn: 1, info: 2, ok: 3 } as const;
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
