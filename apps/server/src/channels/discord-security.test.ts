import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordAdapter } from './discord';
import type { ChannelConnection } from './types';

/** Record attempted connections and token-bearing frames without using a network. */
class Socket extends EventTarget {
  static OPEN = 1;
  static opened: Socket[] = [];
  readyState = Socket.OPEN;
  send = vi.fn();

  constructor(readonly url: string) {
    super();
    Socket.opened.push(this);
  }

  receive(frame: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  close(code = 1006) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}

let connection: ChannelConnection | undefined;

beforeEach(() => {
  Socket.opened = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
});

afterEach(() => {
  connection?.close();
  connection = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connect(gateway = 'wss://gateway.discord.gg') {
  const state = vi.fn();
  connection = new DiscordAdapter('test-token', undefined, gateway).connect({
    state,
    message: vi.fn(),
    press: vi.fn(),
    healed: vi.fn(),
  });
  return state;
}

describe('Discord gateway boundaries', () => {
  it.each([
    'ws://gateway.discord.gg',
    'wss://127.0.0.1',
    'wss://gateway.discord.gg.evil.example',
    'wss://evil.example/gateway.discord.gg',
    'wss://gateway.discord.gg:444',
    'wss://token@gateway.discord.gg',
    'wss://gateway.discord.gg/unexpected',
    'wss://gateway.discord.gg/?target=elsewhere',
    'wss://gateway.discord.gg/#elsewhere',
  ])('does not open an unexpected gateway: %s', async (gateway) => {
    const state = connect(gateway);
    await vi.advanceTimersByTimeAsync(0);
    expect(Socket.opened).toEqual([]);
    expect(state.mock.calls.some(([s]) => s === 'reconnecting')).toBe(true);
  });

  it('does not send a resume token to an address supplied by a hostile Ready frame', async () => {
    connect();
    const first = Socket.opened[0];
    first?.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
    first?.receive({
      op: 0,
      t: 'READY',
      d: { session_id: 'session', resume_gateway_url: 'wss://evil.example', guilds: [] },
    });
    first?.close();
    await vi.advanceTimersByTimeAsync(600);
    expect(Socket.opened).toHaveLength(1);
    // Invalid resume state is discarded and a fresh, approved connection heals it.
    await vi.advanceTimersByTimeAsync(2000);
    expect(Socket.opened.length).toBeGreaterThan(1);
    expect(
      Socket.opened.every((socket) => new URL(socket.url).hostname === 'gateway.discord.gg'),
    ).toBe(true);
  });

  it('resumes on Discord’s regional gateway with the required version and encoding', async () => {
    connect();
    const first = Socket.opened[0];
    first?.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
    first?.receive({
      op: 0,
      t: 'READY',
      d: {
        session_id: 'session',
        resume_gateway_url: 'wss://gateway-us-east1-b.discord.gg',
        guilds: [],
      },
    });
    first?.close();
    await vi.advanceTimersByTimeAsync(600);
    expect(Socket.opened[1]?.url).toBe('wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json');
    Socket.opened[1]?.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
    expect(JSON.parse(String(Socket.opened[1]?.send.mock.calls[0]?.[0]))).toMatchObject({
      op: 6,
      d: { session_id: 'session' },
    });
  });

  it.each([undefined, null, 0, -1, 0.5, 999, 120_001, 2 ** 31, '45000'])(
    'refuses an unsafe heartbeat interval: %s',
    async (heartbeat_interval) => {
      connect();
      const socket = Socket.opened[0];
      socket?.receive({ op: 10, d: { heartbeat_interval } });
      await vi.advanceTimersByTimeAsync(10);
      expect(socket?.readyState).toBe(3);
      expect(socket?.send).not.toHaveBeenCalled();
    },
  );

  it('keeps only one heartbeat timer and identification when Hello is repeated', async () => {
    connect();
    const socket = Socket.opened[0];
    for (let i = 0; i < 100; i++) {
      socket?.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
    }
    expect(vi.getTimerCount()).toBe(1);
    expect(socket?.send).toHaveBeenCalledTimes(1);
    connection?.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
