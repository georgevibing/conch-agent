import { afterEach, describe, expect, it, vi } from 'vitest';

import { heardWake, PROMPT, WakeWord } from './wake';

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
