import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { buildTools } from '../engines/api/engine';
import type { TurnInput } from '../engines/types';
import { PlaceUnavailable, type RunRequest, type WorkPlace } from './types';

async function turn(place: WorkPlace, overrides: Partial<TurnInput> = {}): Promise<TurnInput> {
  const home = await mkdtemp(join(tmpdir(), 'conch-place-'));
  const cwd = join(home, 'workspace');
  await mkdir(cwd);
  return {
    conversationId: 'c1',
    cwd,
    prompt: '',
    systemAppend: '',
    tools: [],
    options: { permissionMode: 'auto', effort: 'auto', fastMode: false },
    signal: new AbortController().signal,
    requestPermission: async () => 'allow',
    place,
    ...overrides,
  };
}

function fakePlace(seals: boolean, answer?: () => Promise<never>) {
  const seen: RunRequest[] = [];
  const place: WorkPlace = {
    id: seals ? 'container' : 'ssh:box',
    kind: seals ? 'container' : 'ssh',
    where: seals ? { kind: 'container', name: 'a container' } : { kind: 'ssh', name: 'box' },
    seals,
    about: seals ? 'Commands run in a container.' : 'Commands run on box.',
    run: async (request) => {
      seen.push(request);
      if (answer) return answer();
      return {
        code: 0,
        output: 'built\n',
        timedOut: false,
        note: '2 changed files came back to the work folder.',
      };
    },
  };
  return { place, seen };
}

describe('commands where the chat’s work runs (ADR 0106)', () => {
  it('go to the place, sealed unless they asked to leave, with what came back said', async () => {
    const { place, seen } = fakePlace(true);
    const input = await turn(place);
    const bash = buildTools(input).get('Bash');
    expect(bash?.spec.description).toContain('Commands run in a container.');
    const result = await bash?.run({ command: 'npm run build' }, 'b1');
    expect(result).toMatchObject({ isError: false });
    expect(result?.text).toContain('built');
    expect(result?.text).toContain('(2 changed files came back to the work folder.)');
    expect(seen[0]).toMatchObject({
      command: 'npm run build',
      cwd: input.cwd,
      open: false,
      conversationId: 'c1',
    });
    await bash?.run({ command: 'npm install', dangerouslyDisableSandbox: true }, 'b2');
    expect(seen[1]?.open).toBe(true);
  });

  it('are judged as leaving the box at a place that can’t seal', async () => {
    const { place, seen } = fakePlace(false);
    const guard = vi.fn(async () => undefined);
    const input = await turn(place, { guard });
    await buildTools(input).get('Bash')?.run({ command: 'ls' }, 'b1');
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ dangerouslyDisableSandbox: true }),
      }),
    );
    expect(seen[0]?.open).toBe(true);
  });

  it('never quietly run here when the place isn’t there', async () => {
    const { place } = fakePlace(true, async () => {
      throw new PlaceUnavailable(
        'Running work in a container needs Docker or Podman.',
        'container',
      );
    });
    const input = await turn(place);
    const result = await buildTools(input)
      .get('Bash')
      ?.run({ command: 'echo here > here.txt' }, 'b1');
    expect(result?.isError).toBe(true);
    expect(result?.text).toMatch(
      /needs Docker or Podman\. The command didn’t run\..*don’t run it another way/,
    );
    await expect(
      import('node:fs/promises').then((fs) => fs.stat(join(input.cwd, 'here.txt'))),
    ).rejects.toThrow();
  });

  it('still refuse a command naming Conch’s keys', async () => {
    const { place, seen } = fakePlace(true);
    const input = await turn(place, { protectedPaths: ['/conch/secrets.json'] });
    const result = await buildTools(input)
      .get('Bash')
      ?.run({ command: 'cat /conch/secrets.json' }, 'b1');
    expect(result?.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });
});
