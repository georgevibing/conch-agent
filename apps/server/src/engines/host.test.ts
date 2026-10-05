import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { buildTools } from './api/engine';
import { authorizeTool, hostComputerTools, hostEnvironment, hostPath } from './host';
import type { TurnInput } from './types';

async function turn(overrides: Partial<TurnInput> = {}): Promise<TurnInput> {
  const home = await mkdtemp(join(tmpdir(), 'conch-host-'));
  const cwd = join(home, 'workspace');
  await mkdir(cwd);
  return {
    conversationId: 'c1',
    cwd,
    prompt: '',
    systemAppend: '',
    tools: [],
    options: { permissionMode: 'default', effort: 'auto', fastMode: false },
    signal: new AbortController().signal,
    requestPermission: async () => 'allow',
    ...overrides,
  };
}

describe('shared Conch host tools', () => {
  it('blocks traversal, external symlinks, protected paths and hard-linked files', async () => {
    const input = await turn();
    const outside = join(input.cwd, '..', 'private.txt');
    await writeFile(outside, 'private');
    await symlink(outside, join(input.cwd, 'link'));
    await link(outside, join(input.cwd, 'hard'));
    await expect(hostPath(input, '../private.txt')).rejects.toThrow('work folder');
    await expect(hostPath(input, 'link')).rejects.toThrow('Linked');
    await expect(hostPath(input, 'hard')).rejects.toThrow('Linked');
    await writeFile(join(input.cwd, 'secret'), 'private');
    await expect(
      hostPath({ ...input, protectedPaths: [join(input.cwd, 'secret')] }, 'secret'),
    ).rejects.toThrow('passwords');
  });
  it('asks before writes and preserves original contents when denied', async () => {
    const ask = vi.fn(async () => 'deny' as const);
    const input = await turn({ requestPermission: ask });
    await writeFile(join(input.cwd, 'note.txt'), 'original');
    const tool = buildTools(input).get('Write');
    expect(await tool?.run({ file_path: 'note.txt', content: 'changed' }, 'w1')).toMatchObject({
      isError: true,
    });
    expect(await readFile(join(input.cwd, 'note.txt'), 'utf8')).toBe('original');
    expect(ask).toHaveBeenCalledOnce();
  });
  it('validates host arguments before guard or execution', async () => {
    const run = vi.fn(async () => 'sent');
    const guard = vi.fn(async () => undefined);
    const input = await turn({
      guard,
      tools: [{ name: 'send', description: '', input: { amount: z.number().positive() }, run }],
    });
    const result = await buildTools(input).get('mcp__conch__send')?.run({ amount: -1 }, 'x');
    expect(result?.isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });
  it('honors guard ask/deny even when the user selected full trust', async () => {
    const ask = vi.fn(async () => 'deny' as const);
    const input = await turn({
      requestPermission: ask,
      guard: async () => ({ decision: 'ask', reason: 'Untrusted page' }),
      options: { permissionMode: 'bypassPermissions', effort: 'auto', fastMode: false },
    });
    expect(await authorizeTool(input, 'Bash', { command: 'echo hello' }, 'x')).toContain(
      'declined',
    );
    expect(ask).toHaveBeenCalledOnce();
    expect(
      await authorizeTool(
        { ...input, guard: async () => ({ decision: 'deny', message: 'Protected' }) },
        'Bash',
        {},
        'x',
      ),
    ).toBe('Protected');
  });
  it('plan mode is read-only and cancellation after approval cannot run an action', async () => {
    const input = await turn({
      options: { permissionMode: 'plan', effort: 'auto', fastMode: false },
    });
    expect(await authorizeTool(input, 'Write', {}, 'x')).toContain('Plan mode');
    const abort = new AbortController();
    const cancelled = await turn({
      signal: abort.signal,
      requestPermission: async () => {
        abort.abort();
        return 'allow';
      },
    });
    await expect(
      buildTools(cancelled).get('Write')?.run({ file_path: 'new.txt', content: 'oops' }, 'x'),
    ).rejects.toThrow();
  });
  it('wraps engine-supplied tools for task verification and confirms actual file contents', async () => {
    const wrap = vi.fn((tool) => tool);
    const input = await turn({ wrapTool: wrap });
    buildTools(input);
    expect(wrap).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Read',
        verification: expect.objectContaining({ effect: 'read' }),
      }),
    );
    const tool = hostComputerTools(input).find((t) => t.name === 'Write');
    await tool?.run({ file_path: 'note.txt', content: 'hello' });
    expect(
      await tool?.verification?.reconcile({ file_path: 'note.txt', content: 'hello' }, 'op'),
    ).toMatchObject({ state: 'confirmed', receipt: { provider: 'conch-files' } });
  });
  it('never passes arbitrary environment credentials to a command or Codex', () => {
    vi.stubEnv('OPENAI_API_KEY', 'private');
    vi.stubEnv('OP_SERVICE_ACCOUNT_TOKEN', 'private');
    expect(hostEnvironment()).not.toHaveProperty('OPENAI_API_KEY');
    expect(hostEnvironment()).not.toHaveProperty('OP_SERVICE_ACCOUNT_TOKEN');
    vi.unstubAllEnvs();
  });
});

describe('commands, on every provider that uses Conch’s tools', () => {
  it('is always on offer, says how it runs, and lets a command ask to leave the seal', async () => {
    const input = await turn();
    const bash = buildTools(input).get('Bash');
    expect(bash).toBeDefined();
    expect(bash?.spec.description).toMatch(/asked first unless they chose Full trust/);
    expect(JSON.stringify(bash?.spec.schema)).toContain('dangerouslyDisableSandbox');
  });

  it('asks first, then runs with your access with no box for the turn (a clone, an install)', async () => {
    // No box for this turn (as where this computer can't seal, or sealing is off).
    const guard = vi.fn(async () => undefined);
    const ask = vi.fn(async () => 'allow' as const);
    const input = await turn({ guard, requestPermission: ask });
    const result = await buildTools(input)
      .get('Bash')
      ?.run({ command: 'echo cloned > made.txt && echo done' }, 'b1');
    expect(result).toMatchObject({ isError: false });
    expect(result?.text).toContain('done');
    expect(await readFile(join(input.cwd, 'made.txt'), 'utf8')).toContain('cloned');
    // The guard and the question both hear that it runs outside the box.
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ dangerouslyDisableSandbox: true }),
      }),
    );
    expect(ask).toHaveBeenCalledOnce();
  });

  it('refuses a command that names Conch’s keys or your sign-ins', async () => {
    const input = await turn({
      options: { permissionMode: 'bypassPermissions', effort: 'auto', fastMode: false },
    });
    const secret = join(input.cwd, '..', 'secrets.json');
    await writeFile(secret, 'key');
    // The refusal goes back as the tool's own answer, so the model can say why.
    await expect(
      buildTools({ ...input, protectedPaths: [secret] })
        .get('Bash')
        ?.run({ command: `cat ${secret}`, dangerouslyDisableSandbox: true }, 'b2'),
    ).resolves.toMatchObject({ isError: true, text: expect.stringMatching(/passwords/) });
  });
});
