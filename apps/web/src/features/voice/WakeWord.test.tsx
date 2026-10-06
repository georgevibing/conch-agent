import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { setVoicePrefs, voicePrefs } from './prefs';
import { BURST, BurstCutter } from './wake';
import { WakeWord } from './WakeWord';
import { VoiceTab } from './VoiceTab';

const RATE = 48_000;
/** 20 ms of sound at `level`. */
const chunk = (level: number, ms = 20) =>
  Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => (i % 2 ? level : -level));

function feed(cutter: BurstCutter, level: number, ms: number) {
  const out: Float32Array[] = [];
  for (let t = 0; t < ms; t += 20) {
    const burst = cutter.push(chunk(level));
    if (burst) out.push(burst);
  }
  return out;
}

describe('cutting what it hears into bursts of speech', () => {
  it('gives a short phrase after a pause, with a little of what came just before', () => {
    const cutter = new BurstCutter(RATE);
    expect(feed(cutter, 0.002, 1_000)).toEqual([]);
    expect(feed(cutter, 0.2, 800)).toEqual([]);
    const [burst] = feed(cutter, 0.002, 500);
    expect(burst).toBeDefined();
    const ms = ((burst?.length ?? 0) / RATE) * 1000;
    // The phrase, the pre-roll before it and the pause after it.
    expect(ms).toBeGreaterThan(800 + BURST.prerollMs - 40);
    expect(ms).toBeLessThan(800 + BURST.prerollMs + BURST.quietMs + 60);
  });

  it('ignores a click, and talk that goes on too long to be a call', () => {
    const cutter = new BurstCutter(RATE);
    feed(cutter, 0.002, 1_000);
    feed(cutter, 0.3, 100);
    expect(feed(cutter, 0.002, 600)).toEqual([]);
    expect(feed(cutter, 0.2, BURST.maxMs + 400)).toEqual([]);
    expect(feed(cutter, 0.002, 600)).toEqual([]);
  });
});

/** A microphone and an audio graph, pretending: the test plays what it "hears". */
function fakeAudio() {
  const stopped: string[] = [];
  let processor: { onaudioprocess: ((e: unknown) => void) | null } | undefined;
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => stopped.push('mic') }] })),
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = RATE;
      destination = {};
      createMediaStreamSource = () => ({ connect: () => undefined });
      createGain = () => ({ gain: { value: 1 }, connect: () => undefined });
      createScriptProcessor = () => {
        processor = { onaudioprocess: null, connect: () => undefined } as never;
        return processor;
      };
      close = async () => void stopped.push('context');
    },
  );
  const play = (level: number, ms: number) => {
    for (let t = 0; t < ms; t += 20)
      processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => chunk(level) } });
  };
  return { play, stopped, ready: () => Boolean(processor?.onaudioprocess) };
}

const status = (patch: object = {}) => ({
  private: { state: 'ready' },
  wake: { available: true },
  ...patch,
});

afterEach(() => {
  vi.unstubAllGlobals();
  setVoicePrefs({ wake: false });
  useUi.setState({ talking: undefined });
});

describe('“Hey Conch” in the desktop app', () => {
  it('says it’s listening, hears the phrase, and opens talk with what came after it', async () => {
    const audio = fakeAudio();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/voice': () => status(),
      'POST /api/voice/wake/state': () => ({ on: true }),
    });
    // The burst goes as a WAV, which the JSON harness can't read: answered here.
    const json = globalThis.fetch;
    const bursts: Uint8Array[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input !== '/api/voice/wake') return json(input, init);
      bursts.push(init?.body as Uint8Array);
      return Response.json({ heard: true, rest: 'what’s on tomorrow?' });
    });
    setVoicePrefs({ wake: true });
    const { container } = renderApp(<WakeWord onChat />);
    expect(await screen.findByRole('status')).toHaveTextContent('Listening for “Hey Conch”');
    await waitFor(() => expect(audio.ready()).toBe(true));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/voice/wake/state')?.body).toEqual({ on: true }),
    );
    act(() => {
      audio.play(0.002, 1_000);
      audio.play(0.2, 700);
      audio.play(0.002, 500);
    });
    await waitFor(() => expect(useUi.getState().talking).toEqual({ first: 'what’s on tomorrow?' }));
    // One burst, as a 16 kHz WAV: about the phrase, the moment before it and the pause after.
    expect(bursts).toHaveLength(1);
    const seconds = ((bursts[0]?.length ?? 44) - 44) / 32_000;
    expect(seconds).toBeGreaterThan(0.9);
    expect(seconds).toBeLessThan(1.5);
    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it('stops in one press: the microphone goes, and the tray is told', async () => {
    const audio = fakeAudio();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/voice': () => status(),
      'POST /api/voice/wake/state': () => ({ on: true }),
    });
    setVoicePrefs({ wake: true });
    renderApp(<WakeWord onChat />);
    await screen.findByRole('status');
    await waitFor(() => expect(audio.ready()).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(voicePrefs().wake).toBe(false);
    await waitFor(() => expect(audio.stopped).toEqual(['mic', 'context']));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/voice/wake/state').at(-1)?.body).toEqual({
        on: false,
      }),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never listens outside the desktop app, or before it’s turned on', async () => {
    const audio = fakeAudio();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/voice': () => status({ wake: { available: false } }),
    });
    setVoicePrefs({ wake: true });
    renderApp(<WakeWord onChat />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('status')).toBeNull();
    expect(audio.ready()).toBe(false);
  });

  it('is a switch in Settings → Voice only in the desktop app, off by default', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/voice': () => status(),
      'GET /api/voice/speech': () => ({ piper: 'missing', voices: [], cloud: [] }),
      'GET /api/needs/piper': () => ({ ready: false, needs: [] }),
    });
    renderApp(<VoiceTab />, { route: '/settings/voice' });
    const wake = await screen.findByRole('switch', { name: /Listen for “Hey Conch”/ });
    expect(wake).not.toBeChecked();
    expect(screen.getByText(/nothing is recorded or sent/)).toBeInTheDocument();
    await userEvent.click(wake);
    expect(voicePrefs().wake).toBe(true);
  });
});
