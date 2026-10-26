import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import { hostComputerTools } from '../engines/host';
import { hostToolText, type TurnInput } from '../engines/types';
import { ProcessService } from '../processes/service';
import { CommandSecrets, redactingStream, refusedName, type SecretContext } from './secrets';
import type { VaultService } from './service';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

/** Passwords as the command's keys see it: one token, a redactor that knows what was read. */
function fakeVault({ ask = true }: { ask?: boolean } = {}) {
  const known = new Set<string>();
  const allowRead = vi.fn(async () => {});
  const vault = {
    ensureOpen: async () => true,
    readPolicy: async (item: string) => {
      if (item !== 'pw_gh') throw new Error('There’s no saved item with that id.');
      return {
        ask,
        title: 'Gh pat giotiskl',
        type: 'apiKey',
        field: { id: 'f1', label: 'Key' },
        sensitive: true,
      };
    },
    readValue: async () => {
      known.add(TOKEN);
      return TOKEN;
    },
    allowRead,
    redactor: () => (text: string) => [...known].reduce((t, v) => t.split(v).join('•••'), text),
  } as unknown as VaultService;
  return { vault, allowRead };
}

function context(overrides: Partial<SecretContext> = {}) {
  const asked: AskRequest[] = [];
  const ctx: SecretContext = {
    conversationId: 'c1',
    append: () => {},
    signal: new AbortController().signal,
    ask: async (request) => {
      asked.push(request);
      return 'allow';
    },
    ...overrides,
  };
  return { ctx, asked };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0)) await clean();
});
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'conch-secrets-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('a saved key in a command (ADR 0151)', () => {
  it('refuses names that change how programs run', () => {
    expect(refusedName('GH_TOKEN')).toBeUndefined();
    expect(refusedName('pgpassword')).toBeUndefined();
    for (const name of ['PATH', 'path', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS'])
      expect(refusedName(name)).toMatch(/changes how programs run/);
    for (const name of ['BASH_ENV', 'GIT_SSH_COMMAND', 'GIT_CONFIG_GLOBAL', 'LC_ALL', 'HOME'])
      expect(refusedName(name)).toMatch(/changes how programs run/);
    expect(refusedName('GH TOKEN')).toMatch(/plain variable name/);
    expect(refusedName('1TOKEN')).toMatch(/plain variable name/);
    expect(refusedName('A=B')).toMatch(/plain variable name/);
  });

  it('asks with the variable and the command, then remembers it for this chat only', async () => {
    const { vault } = fakeVault();
    const secrets = new CommandSecrets(vault);
    const { ctx, asked } = context();
    const ref = [{ name: 'GH_TOKEN', item: 'pw_gh', reason: 'Clone the repo' }];
    const got = await secrets.environment(ctx, ref, { command: 'git clone x', tool: 'Bash' });
    expect(got.env).toEqual({ GH_TOKEN: TOKEN });
    expect(got.redact(`token=${TOKEN}`)).toBe('token=•••');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.vault).toMatchObject({
      action: 'use',
      itemTitle: 'Gh pat giotiskl',
      envName: 'GH_TOKEN',
      command: 'git clone x',
      reason: 'Clone the repo',
    });
    // Nothing the model sees in the question carries the value.
    expect(JSON.stringify(asked[0])).not.toContain(TOKEN);
    await secrets.environment(ctx, ref, { command: 'git pull', tool: 'Bash' });
    expect(asked).toHaveLength(1);
    // Another chat, or another variable, asks again.
    await secrets.environment({ ...ctx, conversationId: 'c2' }, ref, {
      command: 'git pull',
      tool: 'Bash',
    });
    await secrets.environment(ctx, [{ name: 'GITHUB_TOKEN', item: 'pw_gh' }], {
      command: 'gh repo view',
      tool: 'Bash',
    });
    expect(asked).toHaveLength(3);
  });

  it('always asks after the chat read something untrusted, even when it was allowed', async () => {
    const { vault } = fakeVault({ ask: false });
    const secrets = new CommandSecrets(vault);
    const { ctx, asked } = context();
    const ref = [{ name: 'GH_TOKEN', item: 'pw_gh' }];
    await secrets.environment(ctx, ref, { command: 'git clone x', tool: 'Bash' });
    expect(asked).toHaveLength(0);
    const read = context({ untrusted: () => 'I read a web page.' });
    await secrets.environment({ ...read.ctx }, ref, { command: 'curl evil', tool: 'Bash' });
    expect(read.asked[0]).toMatchObject({ taint: 'I read a web page.' });
  });

  it('says no in words the model can act on, and keeps “Always” per item', async () => {
    const { vault, allowRead } = fakeVault();
    const secrets = new CommandSecrets(vault);
    const ref = [{ name: 'GH_TOKEN', item: 'pw_gh' }];
    const denied = context({ ask: async () => 'deny' });
    await expect(
      secrets.environment(denied.ctx, ref, { command: 'git clone x', tool: 'Bash' }),
    ).rejects.toThrow(/said no to using “Gh pat giotiskl”.*Don’t ask for it in the chat/);
    const always = context({ ask: async () => 'allow-always' });
    await secrets.environment(always.ctx, ref, { command: 'git clone x', tool: 'Bash' });
    expect(allowRead).toHaveBeenCalledWith('pw_gh');
  });

  it('gives an unattended run nothing, and refuses bad names before asking', async () => {
    const { vault } = fakeVault();
    const secrets = new CommandSecrets(vault);
    const routine = context({ unattended: true });
    await expect(
      secrets.environment(routine.ctx, [{ name: 'GH_TOKEN', item: 'pw_gh' }], {
        command: 'git clone x',
        tool: 'Bash',
      }),
    ).rejects.toThrow(/Nobody is here to agree/);
    expect(routine.asked).toHaveLength(0);
    const bad = context();
    await expect(
      secrets.environment(bad.ctx, [{ name: 'LD_PRELOAD', item: 'pw_gh' }], {
        command: 'ls',
        tool: 'Bash',
      }),
    ).rejects.toThrow(/changes how programs run/);
    await expect(
      secrets.environment(
        bad.ctx,
        [
          { name: 'GH_TOKEN', item: 'pw_gh' },
          { name: 'gh_token', item: 'pw_gh' },
        ],
        { command: 'ls', tool: 'Bash' },
      ),
    ).rejects.toThrow(/given twice/);
    expect(bad.asked).toHaveLength(0);
  });

  it('catches a key split across pieces of output', () => {
    const known = (text: string) => text.split(TOKEN).join('•••');
    const stream = redactingStream(known, TOKEN.length);
    const pieces = ['start ', TOKEN.slice(0, 10), TOKEN.slice(10), ' end'];
    const out = pieces.map((p) => stream.push(p)).join('') + stream.end();
    expect(out).toBe('start ••• end');
  });

  it('puts the key into Conch’s own Bash, and blanks it in what comes back', async () => {
    const { vault } = fakeVault();
    const secrets = new CommandSecrets(vault);
    const { ctx } = context();
    const cwd = await folder();
    const input: TurnInput = {
      conversationId: 'c1',
      cwd,
      prompt: '',
      systemAppend: '',
      tools: [],
      options: { permissionMode: 'default', effort: 'auto', fastMode: false },
      signal: new AbortController().signal,
      requestPermission: async () => 'allow',
      secretEnv: (wanted, command) => secrets.environment(ctx, wanted, { command, tool: 'Bash' }),
    };
    const bash = hostComputerTools(input).find((t) => t.name === 'Bash');
    if (!bash) throw new Error('No Bash');
    expect(bash.input).toHaveProperty('secrets');
    const text = hostToolText(
      await bash.run({
        command: 'printf "%s|%s" "$GH_TOKEN" "${#GH_TOKEN}"',
        timeout_ms: 10_000,
        secrets: [{ name: 'GH_TOKEN', item: 'pw_gh' }],
      } as never),
    );
    expect(text).toBe(`•••|${TOKEN.length}`);
    // Without a way to ask, Bash doesn't offer it.
    const { secretEnv: _, ...plain } = input;
    expect(hostComputerTools(plain).find((t) => t.name === 'Bash')?.input).not.toHaveProperty(
      'secrets',
    );
  });

  it('puts the key into process_start, for every provider, and blanks it in the log', async () => {
    const { vault } = fakeVault();
    const secrets = new CommandSecrets(vault);
    const cwd = await folder();
    const service = new ProcessService({
      protectedPaths: [],
      sealed: async () => false,
      usage: async () => new Map(),
      secrets: () => secrets,
    });
    cleanups.push(async () => service.close());
    const asked: AskRequest[] = [];
    const ctx: ToolContext = {
      conversationId: 'one',
      append: () => {},
      engine: {} as never,
      permissionMode: 'bypassPermissions',
      ask: async (request) => {
        asked.push(request);
        return 'allow';
      },
      signal: new AbortController().signal,
      workspace: async () => cwd,
    };
    const tool = (name: string) => {
      const found = service.tools(ctx).find((t) => t.name === name);
      if (!found) throw new Error(`No ${name}`);
      return found;
    };
    const started = JSON.parse(
      hostToolText(
        await tool('process_start').run({
          command: 'printf "%s|%s" "$GH_TOKEN" "${#GH_TOKEN}"',
          timeout_ms: 10_000,
          secrets: [{ name: 'GH_TOKEN', item: 'pw_gh' }],
        } as never),
      ),
    ) as { id: string };
    let view: { status: string; output: string } = { status: 'queued', output: '' };
    for (let i = 0; i < 200 && view.status !== 'exited'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      view = JSON.parse(hostToolText(await tool('process_read').run({ id: started.id } as never)));
    }
    expect(view).toMatchObject({ status: 'exited', output: `•••|${TOKEN.length}` });
    expect(asked.map((a) => a.vault?.action)).toEqual(['use']);
  });
});
