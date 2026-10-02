/**
 * A pretend meaning model for the mock engine (ADR 0041): the real download
 * code — progress, hashes, the files under `CONCH_HOME/models` — against a
 * pretend Hugging Face in memory, and a runner that knows a few meanings.
 * Nothing reaches the internet, and the journeys stay fast and certain.
 */
import { createHash } from 'node:crypto';

import { wordsVector } from '../../memory/embed';
import type { LoadRunner, OnDeviceSpec } from '../../memory/ondevice';

/** Its files: made up, the same every run, big enough to show progress. */
const FILES = [
  { path: 'config.json', bytes: 2_000 },
  { path: 'tokenizer.json', bytes: 300_000 },
  { path: 'onnx/model_quantized.onnx', bytes: 1_200_000 },
].map((f) => {
  const body = Buffer.alloc(f.bytes, `pretend ${f.path} `);
  return { ...f, body, sha256: createHash('sha256').update(body).digest('hex') };
});

export const MOCK_MEANING_SPEC: OnDeviceSpec = {
  id: 'pretend-minilm',
  name: 'pretend-MiniLM',
  repo: 'conch-mock/pretend-minilm',
  revision: '0000000000000000000000000000000000000000',
  multilingual: false,
  floor: 0.3,
  same: 0.55,
  files: FILES.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
};

/** The pretend Hugging Face: each file in small pieces, a little at a time. */
export const mockMeaningFetch: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  const file = FILES.find((f) => url.endsWith(`/${f.path}`));
  if (!file) return new Response('not found', { status: 404 });
  const piece = 64 * 1024;
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (at >= file.body.length) return controller.close();
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.enqueue(file.body.subarray(at, at + piece));
      at += piece;
    },
  });
  return new Response(body, { status: 200 });
};

/** What the pretend model understands, beyond spelling. */
const MEANINGS = [
  /anniversar|married|marriage|wedding|husband|wife|ti(?:e|ed) the knot/i,
  /\bcars?\b|vehicle|automobile|\bdrives?\b/i,
  /\b(summar|recap|round-?up|overview|what happened)/i,
  /coffee|espresso|latte/i,
];

export const mockMeaningLoad: LoadRunner = async () => ({
  async embed(texts) {
    return texts.map((text) => {
      const words = wordsVector(text);
      const v = new Float32Array(MEANINGS.length + words.length);
      MEANINGS.forEach((re, i) => {
        if (re.test(text)) v[i] = 3;
      });
      v.set(words, MEANINGS.length);
      let sum = 0;
      for (const x of v) sum += x * x;
      const n = Math.sqrt(sum) || 1;
      return v.map((x) => x / n);
    });
  },
  dispose: async () => undefined,
});
