import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { Gateway, RESTART_CODE, type GatewayState } from './gateway';

/** A gateway process, as far as the app can see one. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  connected = true;
  exitCode: number | null = null;
  /** Like Node's: set instead of exitCode when a signal ended it. */
  signalCode: NodeJS.Signals | null = null;
  pid = Math.floor(Math.random() * 10_000) + 1;
  sent: unknown[] = [];
  constructor(readonly env: NodeJS.ProcessEnv) {
    super();
  }
  get running() {
    return this.exitCode === null && this.signalCode === null;
  }
  send(message: unknown) {
    this.sent.push(message);
    return true;
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.connected = false;
    this.emit('exit', code, signal);
  }
  kill(signal: NodeJS.Signals) {
    setTimeout(() => this.exit(null, signal), this.goodbyeMs);
    return true;
  }
  /** How long it takes to say goodbye once its channel closes. */
  goodbyeMs = 1;
  disconnect() {
    // Node's own: a channel that's already closed is an error, not a no-op.
    if (!this.connected) {
      this.emit('error', new Error('IPC channel is already disconnected'));
      return;
    }
    // The gateway hears its channel close, says goodbye, and stops.
    this.connected = false;
    setTimeout(() => this.exit(0), this.goodbyeMs);
  }
}

function world() {
  const children: FakeChild[] = [];
  const slept: number[] = [];
  const states: GatewayState[] = [];
  const logged: string[] = [];
  /** A second gateway started while the one before it was still running. */
  let overlapped = false;
  let now = 1_000_000;
  const gateway = new Gateway(
    () => ({
      command: 'node',
      args: ['--import', 'tsx', 'src/main.ts'],
      cwd: '/conch',
      env: { A: '1' },
    }),
    {
      spawn: ((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
        if (children.some((earlier) => earlier.running)) overlapped = true;
        const child = new FakeChild(options.env);
        children.push(child);
        return child;
      }) as unknown as typeof spawn,
      now: () => now,
      sleep: async (ms) => void slept.push(ms),
      log: (text) => void logged.push(text),
    },
  );
  gateway.on('state', (state) => states.push(state));
  const latest = () => children.at(-1) as FakeChild;
  const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    gateway,
    children,
    slept,
    states,
    logged,
    overlapped: () => overlapped,
    latest,
    settle,
    later: (ms: number) => (now += ms),
  };
}

describe('the gateway, kept running by the app', () => {
  it('shows Conch once it says where it listens, and ignores anything else it says', () => {
    const { gateway, latest } = world();
    gateway.start();
    expect(gateway.state).toEqual({ kind: 'starting' });
    expect(latest().env).toMatchObject({ A: '1', CONCH_STARTED_BECAUSE: 'start' });
    latest().emit('message', { type: 'listening', url: 'https://evil.example' });
    latest().emit('message', { type: 'exec', command: 'calc.exe' });
    expect(gateway.state.kind).toBe('starting');
    latest().emit('message', { type: 'listening', url: 'http://127.0.0.1:4317' });
    expect(gateway.state).toEqual({
      kind: 'running',
      url: 'http://127.0.0.1:4317',
      elsewhere: false,
    });
  });

  it('starts it again at once when it asks (an update, a restore)', async () => {
    const { gateway, children, slept, latest, settle } = world();
    gateway.start();
    latest().exit(RESTART_CODE);
    await settle();
    expect(children).toHaveLength(2);
    expect(slept).toEqual([]);
    expect(latest().env.CONCH_STARTED_BECAUSE).toBe('restart');
  });

  it('starts it again after a crash, waiting longer each time, then stops and says why', async () => {
    const { gateway, children, slept, latest, settle, later } = world();
    gateway.start();
    for (let i = 0; i < 5; i++) {
      latest().stderr.emit('data', 'Error: EADDRNOTAVAIL\n    at listen (node:net)\n');
      latest().exit(1);
      await settle();
      later(1_000);
    }
    expect(slept).toEqual([1_000, 3_000, 10_000, 30_000, 30_000]);
    expect(children).toHaveLength(6);
    expect(latest().env.CONCH_STARTED_BECAUSE).toBe('crash');
    latest().stderr.emit('data', 'Error: EADDRNOTAVAIL\n');
    latest().exit(1);
    await settle();
    expect(gateway.state).toEqual({
      kind: 'stopped',
      message: expect.stringMatching(/kept stopping.*It said: “Error: EADDRNOTAVAIL”/),
    });
    // Try again: a fresh start.
    gateway.retry();
    expect(children).toHaveLength(7);
    expect(gateway.state.kind).toBe('starting');
  });

  it('when it says why it can’t start, shows that and doesn’t try again by itself', async () => {
    const { gateway, children, latest, settle } = world();
    gateway.start();
    latest().emit('message', {
      type: 'failed',
      message:
        'Port 4317 is in use by node.exe (process 12), and CONCH_PORT asks for exactly that port.',
    });
    latest().exit(1);
    await settle();
    expect(children).toHaveLength(1);
    expect(gateway.state).toEqual({
      kind: 'stopped',
      message: expect.stringMatching(/^Port 4317 is in use/),
    });
  });

  it('shows another Conch that was already running, and stays out of its way', async () => {
    const { gateway, children, latest, settle } = world();
    gateway.start();
    latest().emit('message', { type: 'elsewhere', url: 'http://127.0.0.1:4318' });
    latest().exit(0);
    await settle();
    expect(children).toHaveLength(1);
    expect(gateway.state).toEqual({
      kind: 'running',
      url: 'http://127.0.0.1:4318',
      elsewhere: true,
    });
  });

  it('quits with it when Conch is quit from the page', async () => {
    const { gateway, latest, settle } = world();
    gateway.start();
    latest().emit('message', { type: 'listening', url: 'http://127.0.0.1:4317' });
    latest().exit(0);
    await settle();
    expect(gateway.state).toEqual({ kind: 'quit' });
  });

  it('stops for good when the app quits, and isn’t started again', async () => {
    const { gateway, children, settle } = world();
    gateway.start();
    await gateway.stop();
    await settle();
    expect(children).toHaveLength(1);
    expect(children[0]?.exitCode !== null || children[0]?.connected === false).toBe(true);
    // Stopping what isn't running is fine.
    await gateway.stop();
  });

  it('stopped again while it’s still on its way out, waits for it quietly', async () => {
    const { gateway, latest, logged } = world();
    gateway.start();
    latest().goodbyeMs = 30;
    let stopped = 0;
    const first = gateway.stop().then(() => stopped++);
    const second = gateway.stop().then(() => stopped++);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Still saying goodbye: nobody has been told it stopped.
    expect(stopped).toBe(0);
    await Promise.all([first, second]);
    expect(latest().running).toBe(false);
    expect(logged.join('')).not.toMatch(/IPC channel/);
  });

  it('starts again once when its code changes, however often it changes on the way down', async () => {
    const { gateway, children, latest, logged, overlapped, settle } = world();
    gateway.start();
    latest().emit('message', { type: 'listening', url: 'http://127.0.0.1:4317' });
    latest().goodbyeMs = 30;
    // A merge touches file after file, a few hundred milliseconds apart.
    const restarts = [gateway.restart()];
    await settle(10);
    restarts.push(gateway.restart());
    await settle(10);
    restarts.push(gateway.restart());
    await Promise.all(restarts);
    await settle();
    expect(overlapped()).toBe(false);
    expect(children).toHaveLength(2);
    expect(latest().env.CONCH_STARTED_BECAUSE).toBe('start');
    expect(gateway.state).toEqual({ kind: 'starting' });
    expect(logged.join('')).not.toMatch(/IPC channel/);
  });

  it('quitting while it starts again for a change: it stays stopped', async () => {
    const { gateway, children, settle } = world();
    gateway.start();
    const restarted = gateway.restart();
    await gateway.stop();
    await restarted;
    await settle();
    expect(children).toHaveLength(1);
  });

  it('a change once it’s started again starts it again', async () => {
    const { gateway, children, overlapped, settle } = world();
    gateway.start();
    await gateway.restart();
    await gateway.restart();
    await settle();
    expect(children).toHaveLength(3);
    expect(overlapped()).toBe(false);
  });

  it('tells it only what the protocol allows', () => {
    const { gateway, latest } = world();
    gateway.start();
    expect(gateway.send({ type: 'update.progress', version: '0.3.0', percent: 12 })).toBe(true);
    expect(
      gateway.send({ type: 'update.progress', version: '0.3.0', percent: 1200 } as never),
    ).toBe(false);
    expect(latest().sent).toEqual([{ type: 'update.progress', version: '0.3.0', percent: 12 }]);
  });
});
