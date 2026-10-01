/**
 * Hearing you (ADR 0027), three ways, best first:
 *
 * - `device`: the browser's speech recognition, on the device itself
 *   (Chrome's on-device recognition): private, instant, words as you speak.
 * - `private`: Conch's own, on the computer it runs on (whisper.cpp): the
 *   page records, and the computer turns it into words. Private everywhere,
 *   even on a phone whose browser has nothing on-device.
 * - `browser`: the browser's speech service, which sends what you say to its
 *   maker (Google for Chrome, Apple for Safari). Used only once you've said so.
 */
import { voiceApi } from './api';
import { encodeWav, level, toMono16k } from './wav';

export type ListenEngine = 'device' | 'private' | 'browser';

export interface ListenHandlers {
  /** Words so far, not settled yet (only the browser's recognition has these). */
  onInterim?: (text: string) => void;
  /** Settled words. */
  onFinal: (text: string) => void;
  /** Loudness, 0–1, a few times a second: the pearl follows it. */
  onLevel?: (value: number) => void;
  /** Listening has ended (you stopped, it heard silence, or it gave up). */
  onEnd?: () => void;
  onError?: (message: string) => void;
  /** Talk mode: stop by itself after a pause in speech. */
  endOnSilence?: boolean;
}

export interface Listening {
  /** Stop and keep what was heard. */
  stop(): void;
  /** Stop and drop it. */
  cancel(): void;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionClass {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

export function recognitionClass(): RecognitionClass | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Whether the browser can hear you on the device itself, for this language. */
export async function deviceRecognition(
  lang: string,
): Promise<'available' | 'downloadable' | 'no'> {
  const R = recognitionClass();
  if (!R?.available) return 'no';
  try {
    const answer = await R.available({ langs: [lang], processLocally: true });
    return answer === 'available'
      ? 'available'
      : answer === 'downloadable' || answer === 'downloading'
        ? 'downloadable'
        : 'no';
  } catch {
    return 'no';
  }
}

const ERRORS: Record<string, string> = {
  'not-allowed':
    'The microphone isn’t allowed for Conch. Allow it in the browser’s settings for this site.',
  'service-not-allowed':
    'The microphone isn’t allowed for Conch. Allow it in the browser’s settings for this site.',
  'audio-capture': 'No microphone was found. Plug one in, or check it isn’t used by another app.',
  network:
    'The browser’s speech service couldn’t be reached. Try private dictation in Settings → Voice.',
  'language-not-supported':
    'This language isn’t available for dictation here. Choose another in Settings → Voice.',
};

/** Loudness from a microphone stream, for the pearl (and silence, in talk mode). */
function meter(stream: MediaStream, onLevel: (v: number) => void): () => void {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const frame = new Uint8Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(frame);
    onLevel(level(frame));
  }, 80);
  return () => {
    clearInterval(timer);
    void context.close().catch(() => undefined);
  };
}

/** Silence after speech: about a second and a quarter of quiet once you've spoken. */
function silenceWatch(onSilence: () => void) {
  let spoke = false;
  let quietSince = 0;
  return (v: number) => {
    const now = Date.now();
    if (v > 0.08) {
      spoke = true;
      quietSince = 0;
    } else if (spoke && v < 0.04) {
      quietSince ||= now;
      if (now - quietSince > 1250) onSilence();
    }
  };
}

function withRecognition(engine: 'device' | 'browser', lang: string, h: ListenHandlers): Listening {
  const R = recognitionClass();
  if (!R)
    throw new Error('This browser can’t hear you. Use private dictation in Settings → Voice.');
  const r = new R();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = !h.endOnSilence;
  if (engine === 'device') r.processLocally = true;
  let cancelled = false;
  let stopMeter: (() => void) | undefined;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (result?.isFinal) h.onFinal(text.trim());
      else interim += text;
    }
    h.onInterim?.(interim.trim());
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    h.onError?.(ERRORS[e.error] ?? 'Dictation stopped. Try again.');
  };
  r.onend = () => {
    stopMeter?.();
    if (!cancelled) h.onEnd?.();
  };
  r.start();
  // A level for the pearl, when the browser lets two things share the microphone.
  if (h.onLevel)
    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        const stop = meter(stream, h.onLevel ?? (() => undefined));
        stopMeter = () => {
          stop();
          for (const t of stream.getTracks()) t.stop();
        };
      })
      .catch(() => undefined);
  return {
    stop: () => r.stop(),
    cancel: () => {
      cancelled = true;
      r.abort();
    },
  };
}

async function withPrivate(lang: string, h: ListenHandlers): Promise<Listening> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    throw new Error(
      (error as DOMException).name === 'NotAllowedError'
        ? (ERRORS['not-allowed'] ?? '')
        : (ERRORS['audio-capture'] ?? ''),
    );
  }
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  let cancelled = false;
  let ended = false;
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const silence = h.endOnSilence ? silenceWatch(() => end()) : undefined;
  const stopMeter = meter(stream, (v) => {
    h.onLevel?.(v);
    silence?.(v);
  });
  const end = () => {
    if (ended) return;
    ended = true;
    if (recorder.state !== 'inactive') recorder.stop();
  };
  recorder.onstop = async () => {
    stopMeter();
    for (const t of stream.getTracks()) t.stop();
    if (cancelled) return;
    try {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const context = new AudioContext();
      const audio = await context.decodeAudioData(await blob.arrayBuffer());
      void context.close();
      const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
        audio.getChannelData(i),
      );
      const wav = encodeWav(toMono16k(channels, audio.sampleRate));
      const { text } = await voiceApi.transcribe(wav, lang);
      if (text) h.onFinal(text);
    } catch (error) {
      h.onError?.(error instanceof Error ? error.message : 'Dictation didn’t work. Try again.');
    } finally {
      h.onEnd?.();
    }
  };
  recorder.start(250);
  return {
    stop: end,
    cancel: () => {
      cancelled = true;
      end();
    },
  };
}

/** Start listening. Throws a sentence when it can't (no microphone, not allowed). */
export async function listen(
  engine: ListenEngine,
  lang: string,
  h: ListenHandlers,
): Promise<Listening> {
  if (engine === 'private') return withPrivate(lang.split('-')[0] ?? 'auto', h);
  if (engine === 'device') {
    const here = await deviceRecognition(lang);
    if (here === 'downloadable')
      await recognitionClass()?.install?.({ langs: [lang], processLocally: true });
  }
  return withRecognition(engine, lang, h);
}
