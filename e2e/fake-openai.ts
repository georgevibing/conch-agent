/**
 * A pretend llama.cpp for the `servers` journey: an OpenAI-compatible address
 * on loopback that lists one model and streams a reply saying how many tools
 * it was given — the few endpoints Conch uses for a server of your own.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_MODEL = 'gemma-3-4b-it';

export async function startFakeOpenAi(): Promise<{ port: number; server: Server }> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += String(chunk)));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && path === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json', server: 'llama.cpp' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: FAKE_MODEL, object: 'model', owned_by: 'llamacpp', created: 1 }],
          }),
        );
        return;
      }
      if (req.method === 'POST' && path === '/v1/chat/completions') {
        const body = (raw ? JSON.parse(raw) : {}) as { tools?: unknown[] };
        const tools = body.tools?.length ?? 0;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
        const words = `Hello from your own server. I have ${tools} tools.`.split(' ');
        for (const [i, word] of words.entries())
          send({
            id: 'c1',
            object: 'chat.completion.chunk',
            model: FAKE_MODEL,
            choices: [{ index: 0, delta: { content: i ? ` ${word}` : word } }],
          });
        send({
          id: 'c1',
          object: 'chat.completion.chunk',
          model: FAKE_MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: words.length,
            total_tokens: 12 + words.length,
          },
        });
        res.end('data: [DONE]\n\n');
        return;
      }
      // Not LM Studio, not Ollama: their own addresses aren't here.
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, server };
}
