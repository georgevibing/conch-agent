import type { SpeechStatus } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { setVoicePrefs, voicePrefs } from './prefs';
import { createSpeaker, pieces } from './speak';
import { VoiceTab } from './VoiceTab';

/** The page's audio, pretending: each piece "plays" at once and ends. */
class FakeAudioContext {
  static played: number[] = [];
  state = 'running';
  destination = {};
  resume = async () => undefined;
  decodeAudioData = async (data: ArrayBuffer) => ({ duration: data.byteLength });
  createBufferSource() {
    const node = {
      buffer: undefined as { duration: number } | undefined,
      onended: undefined as (() => void) | undefined,
      connect: () => undefined,
      start: () => {
        FakeAudioContext.played.push(node.buffer?.duration ?? 0);
        setTimeout(() => node.onended?.(), 1);
      },
      stop: () => node.onended?.(),
    };
    return node;
  }
}

/** The device's voice, pretending: what it was asked to say. */
function fakeSynthesis() {
  const said: string[] = [];
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    function Utterance(this: { text: string }, text: string) {
      this.text = text;
    },
  );
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [],
    speak: (u: { text: string; onend?: () => void }) => {
      said.push(u.text);
      setTimeout(() => u.onend?.(), 1);
    },
    cancel: () => undefined,
    speaking: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return said;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudioContext.played = [];
  setVoicePrefs({ voice: undefined, rate: 1 });
});

describe('a natural voice', () => {
  it('speaks a piece at a time with Conch’s voice, fetching the next while one plays', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const calls = mockFetch({});
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        fetched.push(String(init?.body));
        return new Response(new Uint8Array(10));
      }),
    );
    void calls;
    const speaker = createSpeaker({ lang: 'en-US', voice: 'piper:en_US-lessac-medium', rate: 1.2 });
    await speaker.say(`${'A sentence that goes on for a while. '.repeat(12)}`);
    expect(fetched.length).toBeGreaterThan(1);
    expect(JSON.parse(fetched[0] ?? '{}')).toMatchObject({
      voice: 'piper:en_US-lessac-medium',
      rate: 1.2,
    });
    expect(FakeAudioContext.played).toHaveLength(fetched.length);
  });

  it('reads the rest with the device’s voice when Conch’s can’t speak, and says why once', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const said = fakeSynthesis();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'speech-not-ready', message: 'Natural voices need Piper.' },
          { status: 409 },
        ),
      ),
    );
    const why: string[] = [];
    await createSpeaker({
      lang: 'en-US',
      voice: 'piper:en_US-lessac-medium',
      onFallback: (message) => why.push(message),
    }).say('Hello there. How are you?');
    expect(why).toEqual(['Natural voices need Piper.']);
    expect(said.join(' ')).toBe('Hello there. How are you?');
  });

  it('gathers sentences into pieces without cutting any', () => {
    expect(pieces(['One.', 'Two.', 'Three.'], 9)).toEqual(['One. Two.', 'Three.']);
  });
});

const speech = (patch: Partial<SpeechStatus> = {}): SpeechStatus => ({
  piper: 'ready',
  voices: [
    {
      id: 'piper:en_US-lessac-medium',
      name: 'Lessac',
      lang: 'en-US',
      language: 'American English',
      bytes: 63_206_179,
      state: 'ready',
    },
    {
      id: 'piper:en_US-ryan-medium',
      name: 'Ryan',
      lang: 'en-US',
      language: 'American English',
      bytes: 63_206_177,
      state: 'missing',
    },
    {
      id: 'piper:de_DE-thorsten-medium',
      name: 'Thorsten',
      lang: 'de-DE',
      language: 'Deutsch',
      bytes: 63_206_113,
      state: 'missing',
    },
  ],
  cloud: [],
  ...patch,
});

const base = {
  'GET /api/state': () => appState(),
  'GET /api/voice': () => ({ private: { state: 'ready' } }),
};

describe('Settings → Voice: how Conch sounds', () => {
  it('offers Piper with one press when it isn’t here', async () => {
    fakeSynthesis();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    mockFetch({
      ...base,
      'GET /api/voice/speech': () => speech({ piper: 'missing' }),
      'GET /api/needs/piper': () => ({
        ready: false,
        needs: [
          {
            id: 'piper',
            name: 'Piper (natural voices)',
            short: 'Piper',
            state: 'missing',
            openable: false,
            install: { label: 'Install Piper', command: 'uv tool install piper-tts' },
          },
        ],
      }),
    });
    setVoicePrefs({ lang: 'en-US' });
    renderApp(<VoiceTab />, { route: '/settings/voice' });
    expect(await screen.findByRole('button', { name: 'Install Piper' })).toBeInTheDocument();
  });

  it('gets, tries and uses a natural voice; the one in use answers voice notes too', async () => {
    fakeSynthesis();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const calls = mockFetch({
      ...base,
      'GET /api/voice/speech': () => speech(),
      'POST /api/voice/speech/piper%3Aen_US-ryan-medium': () => speech(),
      'PATCH /api/settings': () => appState(),
      'POST /api/voice/speak': () => new Response(new Uint8Array(10)),
    });
    setVoicePrefs({ lang: 'en-US' });
    const { container } = renderApp(<VoiceTab />, { route: '/settings/voice' });
    const list = await screen.findByRole('list', { name: 'Natural voices' });
    // This language first; the rest folded away.
    expect(within(list).queryByText('Thorsten')).toBeNull();
    await userEvent.click(within(list).getByRole('button', { name: /Get Ryan/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path.endsWith('/api/voice/speech/piper%3Aen_US-ryan-medium')),
      ).toBe(true),
    );
    await userEvent.click(within(list).getByRole('button', { name: 'Use Lessac' }));
    expect(voicePrefs().voice).toBe('piper:en_US-lessac-medium');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        preferences: { voice: 'piper:en_US-lessac-medium' },
      }),
    );
    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it('says what’s read aloud goes to OpenAI when an OpenAI voice is chosen', async () => {
    fakeSynthesis();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    mockFetch({
      ...base,
      'GET /api/voice/speech': () =>
        speech({ cloud: [{ id: 'openai:nova', name: 'Nova', provider: 'OpenAI' }] }),
    });
    setVoicePrefs({ lang: 'en-US', voice: 'openai:nova' });
    renderApp(<VoiceTab />, { route: '/settings/voice' });
    expect(await screen.findByText(/What’s read aloud goes to OpenAI/)).toBeInTheDocument();
  });
});
