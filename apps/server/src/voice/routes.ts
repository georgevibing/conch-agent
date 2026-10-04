import { SpeakBody, WakeStateBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { MAX_AUDIO_BYTES, VoiceError, type VoiceService } from './service';
import { SpeechError, type SpeechService } from './speech';
import type { WakeWord } from './wake';

/**
 * Private dictation (ADR 0027) and natural voices (ADR 0077). Under `/api`,
 * behind the gateway's host, origin and sign-in checks.
 *
 * - A recording is a 16 kHz mono WAV in the body (`audio/wav`), read and
 *   deleted at once; at most two are read at a time.
 * - What's spoken is a sentence or two at a time, as a WAV; at most three
 *   at a time, so one page reading aloud can't hold the computer up.
 */
export function registerVoiceRoutes(
  app: FastifyInstance,
  voice: VoiceService,
  speech: SpeechService,
  wake: WakeWord,
): void {
  app.addContentTypeParser(
    'audio/wav',
    { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES + 1024 },
    (_request, body, done) => done(null, body),
  );
  let reading = 0;
  let speaking = 0;

  app.get('/api/voice', () => voice.status());
  app.post('/api/voice/model', () => voice.getModel());
  app.post('/api/voice/model/pause', () => {
    voice.pause();
    return voice.status();
  });

  app.post<{ Querystring: { lang?: string } }>(
    '/api/voice/transcribe',
    { bodyLimit: MAX_AUDIO_BYTES + 1024 },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body))
        return reply
          .code(415)
          .send({ error: 'bad-request', message: 'Send the recording as audio/wav.' });
      if (reading >= 2)
        return reply
          .code(429)
          .send({ error: 'busy', message: 'Still reading the last thing you said.' });
      reading += 1;
      try {
        return { text: await voice.transcribe(request.body, request.query.lang) };
      } catch (error) {
        if (error instanceof VoiceError)
          return reply
            .code(error.code === 'bad-audio' ? 400 : error.code === 'not-ready' ? 409 : 500)
            .send({ error: `voice-${error.code}`, message: error.message });
        throw error;
      } finally {
        reading -= 1;
      }
    },
  );

  // ── "Hey Conch" (ADR 0078) ───────────────────────────────────────────────

  app.post('/api/voice/wake/state', async (request, reply) => {
    const body = WakeStateBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad-request' });
    if (!wake.available)
      return reply
        .code(409)
        .send({ error: 'wake-unavailable', message: '“Hey Conch” is only in the desktop app.' });
    await wake.state(body.data.on);
    return { on: wake.listening };
  });
  app.post('/api/voice/wake', { bodyLimit: MAX_AUDIO_BYTES + 1024 }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body))
      return reply
        .code(415)
        .send({ error: 'bad-request', message: 'Send the recording as audio/wav.' });
    try {
      return await wake.check(request.body);
    } catch (error) {
      if (error instanceof VoiceError)
        return reply
          .code(error.code === 'not-ready' ? 409 : 400)
          .send({ error: `voice-${error.code}`, message: error.message });
      throw error;
    }
  });

  // ── Natural voices ───────────────────────────────────────────────────────

  const speechFailed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof SpeechError)
      return reply
        .code(error.code === 'unknown' ? 404 : error.code === 'not-ready' ? 409 : 502)
        .send({
          error: `speech-${error.code}`,
          message: error.message,
          ...(error.need && { need: error.need }),
        });
    throw error;
  };

  // `:voice`, not `:id`: ids like `piper:en_US-amy-medium` carry a colon, which the
  // gateway's id check (app.ts) would turn away with a 404.
  app.get('/api/voice/speech', () => speech.status());
  app.post<{ Params: { voice: string } }>('/api/voice/speech/:voice', async (request, reply) => {
    try {
      return await speech.getVoice(request.params.voice);
    } catch (error) {
      return speechFailed(reply, error);
    }
  });
  app.post<{ Params: { voice: string } }>('/api/voice/speech/:voice/pause', (request) => {
    speech.pause(request.params.voice);
    return speech.status();
  });
  app.delete<{ Params: { voice: string } }>('/api/voice/speech/:voice', (request) =>
    speech.forget(request.params.voice),
  );

  app.post('/api/voice/speak', async (request, reply) => {
    const body = SpeakBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    if (speaking >= 3)
      return reply.code(429).send({ error: 'busy', message: 'Still saying the last thing.' });
    speaking += 1;
    try {
      const wav = await speech.speak(body.data.text, body.data.voice, body.data.rate);
      return reply
        .header('content-type', 'audio/wav')
        .header('cache-control', 'no-store')
        .send(wav);
    } catch (error) {
      return speechFailed(reply, error);
    } finally {
      speaking -= 1;
    }
  });
}
