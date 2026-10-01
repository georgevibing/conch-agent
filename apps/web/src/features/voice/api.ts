import { Transcript, VoiceStatus } from '@conch/protocol';

import { ApiError, request } from '../../api/client';

/** Private dictation on the computer Conch runs on (ADR 0027). */
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
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = json as { error?: string; message?: string };
      throw new ApiError(
        response.status,
        e.error ?? 'failed',
        e.message ?? 'Dictation didn’t work.',
      );
    }
    return Transcript.parse(json);
  },
};

export const voiceKeys = { status: ['voice'] as const };
