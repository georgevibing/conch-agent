import { afterEach, describe, expect, it, vi } from 'vitest';

import { callable, heardWake, PROMPT, promptFor, WakeWord } from './wake';

const wav = () => {
  const b = Buffer.alloc(44 + 32_000);
  b.write('RIFF', 0, 'ascii');
  return b;
};

afterEach(() => vi.useRealTimers());

describe('hearing “Hey Conch”', () => {
  it('knows the phrase however whisper.cpp writes it, and keeps what came after', () => {
    expect(heardWake('Hey Conch.')).toEqual({ heard: true });
    expect(heardWake('hey, conch')).toEqual({ heard: true });
    expect(heardWake(' Hey Konch, what’s on tomorrow?')).toEqual({
      heard: true,
      rest: 'what’s on tomorrow?',
    });
    expect(heardWake('Okay Conch remind me to call Ada')).toEqual({
      heard: true,
      rest: 'remind me to call Ada',
    });
  });

  it('isn’t woken by other talk, or a conch in the middle of a sentence', () => {
    expect(heardWake('Hey, can you pass the salt?')).toEqual({ heard: false });
    expect(heardWake('I found a beautiful shell, a conch, on the beach')).toEqual({ heard: false });
    // As whisper.cpp really wrote it, on this computer.
    expect(heardWake('I found a conch shell on the beach.')).toEqual({ heard: false });
    expect(heardWake('"Hey, Conch, what is the weather tomorrow?"')).toEqual({
      heard: true,
      rest: 'what is the weather tomorrow?"',
    });
    expect(heardWake('')).toEqual({ heard: false });
  });
});

describe('listening for it in the desktop app', () => {
  const world = (text = 'Hey Conch.') => {
    const sent: unknown[] = [];
    const transcribe = vi.fn(async () => text);
    const wake = new WakeWord({
      app: {
        send: async (message) => {
          sent.push(message);
          return true;
        },
      },
      voice: { transcribe },
    });
    return { wake, sent, transcribe };
  };

  it('reads nothing until the window says it’s listening, and brings the window forward when called', async () => {
    const { wake, sent, transcribe } = world();
    expect(await wake.check(wav())).toEqual({ heard: false });
    expect(transcribe).not.toHaveBeenCalled();
    await wake.state(true);
    expect(sent).toEqual([{ type: 'wake', on: true }]);
    expect(await wake.check(wav())).toEqual({ heard: true });
    // With Conch's own prompt, never a person's words.
    expect(transcribe).toHaveBeenCalledWith(expect.anything(), 'auto', expect.any(Number), PROMPT);
    expect(sent).toContainEqual({ type: 'show' });
    wake.stop();
  });

  it('reads one burst at a time, and nothing longer than a few seconds', async () => {
    const { wake, transcribe } = world();
    let finish: (text: string) => void = () => undefined;
    transcribe.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)));
    await wake.state(true);
    const first = wake.check(wav());
    expect(await wake.check(wav())).toEqual({ heard: false });
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalled());
    finish('nothing much');
    expect(await first).toEqual({ heard: false });
    expect(await wake.check(Buffer.alloc(16_000 * 2 * 10))).toEqual({ heard: false });
    expect(transcribe).toHaveBeenCalledTimes(1);
    wake.stop();
  });

  it('stops saying it’s listening when the window goes quiet', async () => {
    vi.useFakeTimers();
    const { wake, sent } = world();
    await wake.state(true);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(sent.at(-1)).toEqual({ type: 'wake', on: false });
    expect(wake.listening).toBe(false);
  });

  it('isn’t there at all outside the desktop app', async () => {
    const wake = new WakeWord({ voice: { transcribe: vi.fn(async () => 'Hey Conch') } });
    expect(wake.available).toBe(false);
    await wake.state(true);
    expect(await wake.check(wav())).toEqual({ heard: false });
  });
});

describe('the phrase follows the assistant’s name (ADR 0108)', () => {
  it('hears “Hey Pearl”, and “Hey Conch” still', () => {
    expect(heardWake('Hey Pearl, what’s on today?', 'Pearl')).toEqual({
      heard: true,
      rest: 'what’s on today?',
    });
    expect(heardWake('Hey Conch.', 'Pearl')).toEqual({ heard: true });
    expect(heardWake('Hey Pearly gates', 'Pearl')).toEqual({ heard: false });
    expect(heardWake('Hey Pearl', undefined)).toEqual({ heard: false });
    // Accents as written or not; names of two words; nothing sayable is Conch.
    expect(heardWake('hey zoe', 'Zoë')).toEqual({ heard: true });
    expect(heardWake('Hey Zoë!', 'Zoë')).toEqual({ heard: true });
    expect(heardWake('Hi Mister Bean, hello', 'Mister Bean the 3rd')).toEqual({
      heard: true,
      rest: 'hello',
    });
    expect(callable('🦊 42')).toBeUndefined();
    expect(callable('conch')).toBeUndefined();
    // A name can't smuggle a pattern in.
    expect(heardWake('Hey anything', '.*')).toEqual({ heard: false });
    expect(promptFor('Pearl')).toBe('Talking to an assistant called Pearl:');
    expect(promptFor('Conch')).toBe(PROMPT);
  });
});

describe('listening while Conch is open on a phone (ADR 0108)', () => {
  it('reads a burst only from a device that says it’s listening, for a minute after it last did', async () => {
    let now = 0;
    const transcribe = vi.fn(async () => 'Hey Pearl, lights');
    const wake = new WakeWord({
      voice: { transcribe },
      name: async () => 'Pearl',
      now: () => now,
    });
    expect(await wake.check(wav(), 'device:phone')).toEqual({ heard: false });
    wake.open('device:phone', true);
    expect(await wake.check(wav(), 'device:phone')).toEqual({ heard: true, rest: 'lights' });
    expect(transcribe).toHaveBeenCalledWith(
      expect.anything(),
      'auto',
      expect.any(Number),
      'Talking to an assistant called Pearl:',
    );
    // Another device that never said so isn't read; nor is the desktop path.
    expect(await wake.check(wav(), 'device:tablet')).toEqual({ heard: false });
    expect(await wake.check(wav())).toEqual({ heard: false });
    now += 2 * 60_000;
    expect(await wake.check(wav(), 'device:phone')).toEqual({ heard: false });
    wake.open('device:phone', true);
    wake.open('device:phone', false);
    expect(await wake.check(wav(), 'device:phone')).toEqual({ heard: false });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});
