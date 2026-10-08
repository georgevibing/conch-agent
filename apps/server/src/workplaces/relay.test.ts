import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { openRelay, relayAnswer, type Relay } from './relay';
import { PlaceUnavailable, type RunRequest, type WorkPlace } from './types';

const run = promisify(execFile);
const relays: Relay[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.close();
});

function place(
  answer: (r: RunRequest) => Promise<{ code: number | null; output: string }>,
): WorkPlace & {
  seen: RunRequest[];
} {
  const seen: RunRequest[] = [];
  return {
    id: 'container',
    kind: 'container',
    where: { kind: 'container', name: 'a container' },
    seals: true,
    about: '',
    seen,
    run: async (request) => {
      seen.push(request);
      return { ...(await answer(request)), timedOut: false };
    },
  };
}

const relayFor = (p: WorkPlace) => {
  const relay = openRelay({
    place: p,
    conversationId: 'c1',
    cwd: '/work',
    forbidden: async () => ['/home/me/.ssh'],
    refuses: (command, forbidden) =>
      forbidden.some((f) => command.includes(f)) ? 'Refused.' : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  relays.push(relay);
  return relay;
};

/** Runs the line as Claude Code would: a shell, its output and exit code. */
async function shell(line: string): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await run('/bin/sh', ['-c', line]);
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { code: number; stdout: string };
    return { code: e.code, stdout: e.stdout };
  }
}

describe('the relay for Claude Code’s own commands', () => {
  it('runs exactly the command that was judged, at the place, with its output and exit code', async () => {
    const p = place(async (r) => ({ code: 3, output: `ran: ${r.command}` }));
    const line = await relayFor(p).wrap({ command: 'npm test', timeoutMs: 60_000, open: false });
    expect(line).not.toContain('npm test');
    expect(await shell(line)).toEqual({ code: 3, stdout: 'ran: npm test' });
    expect(p.seen[0]).toMatchObject({
      command: 'npm test',
      cwd: '/work',
      open: false,
      conversationId: 'c1',
    });
  });

  it('is good once: the same line can’t run it again', async () => {
    const p = place(async () => ({ code: 0, output: 'ok' }));
    const line = await relayFor(p).wrap({ command: 'date', timeoutMs: 60_000, open: true });
    expect((await shell(line)).code).toBe(0);
    expect((await shell(line)).code).toBe(1);
    expect(p.seen).toHaveLength(1);
  });

  it('refuses a web page and another host, and a command that names your keys', async () => {
    const p = place(async () => ({ code: 0, output: 'ok' }));
    const relay = relayFor(p);
    const line = await relay.wrap({ command: 'x', timeoutMs: 1000, open: false });
    const url = /'(http:\/\/127\.0\.0\.1:\d+\/run\/[^']+)'/.exec(line)?.[1] ?? '';
    expect(
      (await fetch(url, { method: 'POST', headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
    // Refused before it was taken: the ticket still works once, from the runner.
    expect((await shell(line)).code).toBe(0);
    const keys = await relay.wrap({
      command: 'cat /home/me/.ssh/id_ed25519',
      timeoutMs: 1000,
      open: false,
    });
    expect(await shell(keys)).toEqual({ code: 1, stdout: 'Refused.' });
  });

  it('says what to do when the place isn’t there', async () => {
    const p = place(async () => {
      throw new PlaceUnavailable('Docker is installed but isn’t starting.');
    });
    const line = await relayFor(p).wrap({ command: 'ls', timeoutMs: 1000, open: false });
    const result = await shell(line);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(
      /isn’t starting\. The command didn’t run\..*don’t run it another way/,
    );
  });

  it('turns a timeout into the exit code a shell would give', () => {
    expect(relayAnswer({ code: null, output: 'part', timedOut: true }, 30_000)).toMatchObject({
      code: 124,
    });
    expect(
      relayAnswer({ code: 0, output: 'x', timedOut: false, note: '1 changed file came back' }, 1)
        .output,
    ).toBe('x\n(1 changed file came back)');
  });
});
