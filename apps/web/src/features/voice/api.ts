import { SpeechStatus, Transcript, VoiceStatus, WakeResult } from '@conch/protocol';

import { ApiError, request } from '../../api/client';

async function failed(response: Response, fallback: string): Promise<ApiError> {
  const e = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return new ApiError(response.status, e.error ?? 'failed', e.message ?? fallback);
}

/** Private dictation (ADR 0027) and natural voices (ADR 0077), on the computer Conch runs on. */
export const voiceApi = {
  status: () => request(VoiceStatus, '/api/voice'),
  getModel: () => request(VoiceStatus, '/api/voice/model', { method: 'POST', body: {} }),
  pause: () => request(VoiceStatus, '/api/voice/model/pause', { method: 'POST', body: {} }),
  /** A 16 kHz mono WAV in, the words out. */
  async transcribe(wav: Uint8Array, lang: string): Promise<Transcript> {
    const response = await fetch(`/api/voice/transcribe?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: wav as BodyInit,
      credentials: 'same-origin',
    });
    if (!response.ok) throw await failed(response, 'Dictation didn’t work.');
    return Transcript.parse(await response.json());
  },

  /**
   * A burst of speech in: whether it said "Hey Conch" (ADR 0078). `open`: from
   * a device listening only while Conch is open on it (ADR 0108).
   */
  async wake(wav: Uint8Array, open = false): Promise<WakeResult> {
    const response = await fetch(`/api/voice/wake${open ? '?open=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: wav as BodyInit,
      credentials: 'same-origin',
    });
    if (!response.ok) throw await failed(response, 'Couldn’t listen for “Hey Conch”.');
    return WakeResult.parse(await response.json());
  },
  /** The window is (or isn't) listening for "Hey Conch": the tray says so. */
  wakeState: (on: boolean, open = false) =>
    fetch('/api/voice/wake/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(open ? { on, open } : { on }),
      credentials: 'same-origin',
      keepalive: true,
    }).then(() => undefined),

  speech: () => request(SpeechStatus, '/api/voice/speech'),
  getVoice: (id: string) =>
    request(SpeechStatus, `/api/voice/speech/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: {},
    }),
  pauseVoice: (id: string) =>
    request(SpeechStatus, `/api/voice/speech/${encodeURIComponent(id)}/pause`, {
      method: 'POST',
      body: {},
    }),
  forgetVoice: (id: string) =>
    request(SpeechStatus, `/api/voice/speech/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** A sentence or two, said with one of Conch's voices: a WAV. */
  async speak(
    text: string,
    voice: string,
    rate: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const response = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice, rate: Math.min(2, Math.max(0.5, rate)) }),
      credentials: 'same-origin',
      ...(signal && { signal }),
    });
    if (!response.ok) throw await failed(response, 'That voice couldn’t speak just now.');
    return response.arrayBuffer();
  },
};

export const voiceKeys = { status: ['voice'] as const, speech: ['voice', 'speech'] as const };
