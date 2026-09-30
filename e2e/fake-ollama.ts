/**
 * A pretend Ollama for the `local` journey: the few endpoints Conch uses, on
 * loopback, with a model download that streams real-looking progress and a
 * chat that streams a reply saying how many tools it was given.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const TOTAL = 2_497_293_803;

export async function startFakeOllama(): Promise<{ port: number; server: Server }> {
  const pulled = new Set<string>();
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += String(chunk)));
    req.on('end', () => {
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (path === '/api/version') return json({ version: '0.35.0' });
      if (path === '/api/ps') return json({ models: [] });
      if (path === '/api/tags')
        return json({
          models: [...pulled].map((name) => ({
            name,
            model: name,
            size: TOTAL,
            digest: `digest-${name}`,
            details: { family: 'qwen3', parameter_size: '4.0B' },
          })),
        });
      if (path === '/api/show')
        return json({
          capabilities: ['completion', 'tools'],
          model_info: { 'qwen3.context_length': 40_960 },
        });
      if (path === '/api/pull') {
        const model = String(body['model']);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
        line({ status: 'pulling manifest' });
        let step = 0;
        const timer = setInterval(() => {
          step += 1;
          line({
            status: 'pulling 3e4cb1417446',
            digest: 'sha256:3e4cb1417446',
            total: TOTAL,
            completed: Math.min(TOTAL, Math.round((TOTAL * step) / 12)),
          });
          if (step >= 12) {
            clearInterval(timer);
            line({ status: 'verifying sha256 digest' });
            line({ status: 'writing manifest' });
            line({ status: 'success' });
            pulled.add(model);
            res.end();
          }
        }, 250);
        res.on('close', () => clearInterval(timer));
        return;
      }
      if (path === '/api/chat') {
        const model = String(body['model']);
        if (!pulled.has(model)) return json({ error: `model '${model}' not found` }, 404);
        const tools = Array.isArray(body['tools']) ? body['tools'].length : 0;
        const context = (body['options'] as { num_ctx?: number } | undefined)?.num_ctx ?? 0;
        const words = [
          'Hello',
          ' from',
          ' the',
          ' model',
          ' on',
          ' this',
          ' computer.',
          ` I have ${tools} tools and ${context} tokens of context.`,
        ];
        if (body['stream'] === false)
          return json({ message: { role: 'assistant', content: 'Local hello' }, done: true });
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        for (const word of words)
          res.write(
            `${JSON.stringify({ message: { role: 'assistant', content: word }, done: false })}\n`,
          );
        res.end(
          `${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, eval_count: 20 })}\n`,
        );
        return;
      }
      json({ error: 'not found' }, 404);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, server };
}
