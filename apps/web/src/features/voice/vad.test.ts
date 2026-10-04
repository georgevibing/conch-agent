import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpeechGate, voiceBand, watchForBargeIn } from './vad';

/** Frames every 20 ms at `level` for `ms`, starting at `from`; when it said speech. */
function feed(gate: SpeechGate, level: number, ms: number, from: number, echo = false) {
  const said: number[] = [];
  for (let t = from; t < from + ms; t += 20) if (gate.push(level, t, echo)) said.push(t);
  return said;
}

describe('hearing someone start to talk', () => {
  it('learns the room, then hears a voice clearly above it for a quarter of a second', () => {
    const gate = new SpeechGate();
    expect(feed(gate, 0.05, 2_000, 0)).toEqual([]);
    const said = feed(gate, 0.4, 600, 2_000);
    expect(said).toHaveLength(1);
    expect(said[0]).toBeGreaterThanOrEqual(2_260);
  });

  it('isn’t fooled by a click, a cough or a door', () => {
    const gate = new SpeechGate();
    feed(gate, 0.05, 1_000, 0);
    expect(feed(gate, 0.9, 80, 1_000)).toEqual([]);
    expect(feed(gate, 0.05, 400, 1_080)).toEqual([]);
  });

  it('keeps hearing a word through its short dips', () => {
    const gate = new SpeechGate();
    feed(gate, 0.05, 1_000, 0);
    feed(gate, 0.4, 160, 1_000);
    feed(gate, 0.05, 60, 1_160);
    expect(feed(gate, 0.4, 200, 1_220)).toHaveLength(1);
  });

  it('needs a voice clearly louder than the assistant’s own leak while it speaks', () => {
    const gate = new SpeechGate();
    feed(gate, 0.05, 1_000, 0);
    gate.speaking();
    // What leaks back from the speakers, with gaps between words.
    for (let t = 1_000; t < 3_000; t += 200) {
      feed(gate, 0.25, 100, t, true);
      feed(gate, 0.05, 100, t + 100, true);
    }
    expect(gate.threshold(true)).toBeGreaterThan(gate.threshold(false));
    // Its own voice, as loud as before, never interrupts it.
    expect(feed(gate, 0.25, 600, 3_000, true)).toEqual([]);
    // A person speaking up does.
    expect(feed(gate, 0.85, 600, 3_600, true)).toHaveLength(1);
  });

  it('weighs only the voice band: a hum below it counts for little', () => {
    const frame = (loudAt: number) =>
      Float32Array.from({ length: 512 }, (_, i) => (i === loudAt ? -20 : -100));
    // 48 kHz, 1024-point frames: about 47 Hz a bin.
    const hum = voiceBand(frame(1), 48_000, 1024);
    const voice = voiceBand(frame(20), 48_000, 1024);
    expect(voice).toBeGreaterThan(hum);
    expect(voiceBand(frame(-1), 48_000, 1024)).toBe(0);
  });
});

describe('listening for barge-in', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the microphone with echo cancellation, hears speech, and lets it go', async () => {
    let level = -100;
    const stopped: string[] = [];
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
          expect(constraints.audio).toMatchObject({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          });
          return { getTracks: () => [{ stop: () => stopped.push('track') }] };
        }),
      },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 48_000;
        createMediaStreamSource = () => ({ connect: () => undefined });
        createAnalyser = () => ({
          fftSize: 1024,
          smoothingTimeConstant: 0,
          frequencyBinCount: 512,
          getFloatFrequencyData: (frame: Float32Array) => frame.fill(level),
        });
        close = async () => void stopped.push('context');
      },
    );
    const onSpeech = vi.fn();
    const watcher = await watchForBargeIn({ onSpeech, echo: () => false });
    // The room, then someone talking.
    await new Promise((r) => setTimeout(r, 300));
    level = -25;
    await vi.waitFor(() => expect(onSpeech).toHaveBeenCalled(), { timeout: 3_000 });
    watcher.stop();
    expect(stopped).toEqual(['track', 'context']);
  });
});
