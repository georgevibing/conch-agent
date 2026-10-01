import type { FastifyInstance } from 'fastify';

import { MAX_AUDIO_BYTES, VoiceError, type VoiceService } from './service';

/**
 * Private dictation (ADR 0027). Under `/api`, behind the gateway's host,
 * origin and sign-in checks. A recording is a 16 kHz mono WAV in the body
 * (`audio/wav`), read and deleted at once; at most two are read at a time.
 */
export function registerVoiceRoutes(app: FastifyInstance, voice: VoiceService): void {
  app.addContentTypeParser(
    'audio/wav',
    { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES + 1024 },
    (_request, body, done) => done(null, body),
  );
  let reading = 0;

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
}
