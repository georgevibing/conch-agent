import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptyView, type ConversationView } from '../../live/reducer';
import { mockFetch, renderApp } from '../../test/harness';
import { Dictate } from './Dictate';
import { setVoicePrefs } from './prefs';
import { bestVoice, sentences, speakable } from './speak';
import { replySince } from './Talk';
import { encodeWav, toMono16k } from './wav';

afterEach(() => {
  vi.unstubAllGlobals();
  setVoicePrefs({ engine: 'auto', cloudOk: false, lang: undefined, voice: undefined });
});

describe('recordings for private dictation', () => {
  it('makes a 16 kHz mono 16-bit WAV from whatever the browser recorded', () => {
    const left = new Float32Array(48_000).fill(0.5);
    const right = new Float32Array(48_000).fill(-0.5);
    const mono = toMono16k([left, right], 48_000);
    expect(mono.length).toBe(16_000);
    expect(mono[100]).toBe(0);
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    // Louder than full scale is held at full scale.
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });
});

describe('reading aloud', () => {
  it('says markdown the way a person would, never the code', () => {
    expect(
      speakable(
        '## Fixed\n- Run `npm test` and see **all green**.\n```ts\nconst x = 1;\n```\nSee [the docs](https://x.dev).',
      ),
    ).toBe('Fixed Run npm test and see all green. (I’ve put the code on screen.) See the docs.');
  });

  it('splits into sentences, so it can start before the answer is done', () => {
    expect(sentences('Three things. First, stand-up at 9! Then lunch… and')).toEqual([
      'Three things.',
      'First, stand-up at 9!',
      'Then lunch…',
      'and',
    ]);
  });

  it('picks the most natural voice for the language', () => {
    const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
      ({
        name,
        lang,
        voiceURI: name,
        localService: true,
        default: false,
        ...extra,
      }) as SpeechSynthesisVoice;
    const voices = [
      voice('Fred', 'en-US'),
      voice('Ava (Premium)', 'en-US'),
      voice('Anna', 'de-DE', { default: true }),
    ];
    expect(bestVoice(voices, 'en-GB')?.name).toBe('Ava (Premium)');
    expect(bestVoice(voices, 'de-DE')?.name).toBe('Anna');
    expect(bestVoice(voices, 'en-US', 'Fred')?.name).toBe('Fred');
  });
});

describe('talk mode', () => {
  it('hears the answer to what was just said, and when it’s done', () => {
    const view: ConversationView = {
      ...emptyView,
      status: 'running',
      items: [
        {
          kind: 'assistant',
          id: 'a0',
          messageId: 'a0',
          continuation: false,
          text: 'An old answer.',
          thinking: '',
          done: true,
          startedAt: 1,
        },
        {
          kind: 'user',
          id: 'u',
          messageId: 'u',
          text: 'What’s next?',
          at: 2,
        } as unknown as ConversationView['items'][number],
        {
          kind: 'assistant',
          id: 'a1',
          messageId: 'a1',
          continuation: false,
          text: 'Lunch with Ada.',
          thinking: '',
          done: false,
          startedAt: 3,
        },
      ],
    };
    expect(replySince(view, 1)).toEqual({ text: 'Lunch with Ada.', done: false });
    expect(replySince({ ...view, status: 'idle' }, 1).done).toBe(true);
  });
});

/** A pretend `SpeechRecognition` that hears what the test says. */
function recognition() {
  const instances: {
    onresult: ((e: unknown) => void) | null;
    onend: (() => void) | null;
    processLocally?: boolean;
    stop: () => void;
  }[] = [];
  class FakeRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    processLocally?: boolean;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() {
      instances.push(this);
    }
    start() {}
    stop() {
      this.onend?.();
    }
    abort() {}
    static available = vi.fn(async () => 'available');
    static install = vi.fn(async () => true);
  }
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => Promise.reject(new Error('no'))) },
  });
  const say = (text: string, isFinal: boolean) =>
    instances.at(-1)?.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal })],
    });
  return { instances, say };
}

function Harness() {
  const [draft, setDraft] = useState('Remind me');
  return (
    <>
      <output data-testid="draft">{draft}</output>
      <Dictate draft={draft} setDraft={setDraft} />
    </>
  );
}

describe('dictation', () => {
  it('writes what you say into the message as you say it, on the device', async () => {
    const user = userEvent.setup();
    const { instances, say } = recognition();
    mockFetch({ 'GET /api/voice': () => ({ private: { state: 'missing' } }) });
    renderApp(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Dictate' }));
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0]?.processLocally).toBe(true);
    say('to call', false);
    await waitFor(() => expect(screen.getByTestId('draft')).toHaveTextContent('Remind me to call'));
    say('to call Ada tomorrow', true);
    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    await waitFor(() =>
      expect(screen.getByTestId('draft')).toHaveTextContent('Remind me to call Ada tomorrow'),
    );
  });

  it('asks once before the browser’s speech service hears you', async () => {
    const user = userEvent.setup();
    recognition();
    const R = (window as unknown as { SpeechRecognition: { available: ReturnType<typeof vi.fn> } })
      .SpeechRecognition;
    R.available.mockResolvedValue('unavailable');
    mockFetch({
      'GET /api/voice': () => ({ private: { state: 'missing' } }),
      'GET /api/needs/whisper': () => ({ needs: [] }),
    });
    renderApp(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Dictate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Who hears you?' });
    expect(dialog).toHaveTextContent('Google for Chrome and Edge, Apple for Safari');
    expect(dialog).toHaveTextContent('Private dictation, on this computer');
  });
});
