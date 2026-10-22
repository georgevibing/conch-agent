/**
 * A PDF sent whole (ADR 0017): in each provider's shape, only to the models
 * that read one and only as much as fits, counted by its pages, let go after
 * a few messages, and healed when a model refuses it.
 */
import { describe, expect, it } from 'vitest';

import type { TurnDocument, TurnInput } from '../types';
import { AnthropicWire } from './anthropic';
import { chatUserMessage } from './chat';
import { estimateTokens } from './context';
import {
  ageDocuments,
  documentOf,
  hasDocuments,
  KEEP_DOCUMENT_TURNS,
  PAGE_TOKENS,
  pagesOf,
  refusesDocuments,
  rememberPages,
} from './documents';
import { ApiEngine } from './engine';
import { collect, dataFrames, fakeFetch, fakeHome, jsonResponse, sseResponse } from './fake';
import { OpenAiWire } from './openai';
import { OpenRouterWire } from './openrouter';
import { PRESETS } from './presets';
import { startsTurn } from './session';
import { ApiError, type ApiVariant, type WireEvent, type WireRequest } from './types';
import type { PdfLimits, Wire } from './wire';

/** A tiny PDF's base64: two pages, as pdf.js and every provider read it. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>>endobj\n3 0 obj<</Type /Page /Parent 2 0 R>>endobj\n4 0 obj<</Type /Page /Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  'latin1',
).toString('base64');
const JPEG = '/9j/' + 'Q'.repeat(64);

const doc = (overrides: Partial<TurnDocument> = {}): TurnDocument => ({
  name: 'report.pdf',
  mimeType: 'application/pdf',
  data: PDF,
  pages: 2,
  bytes: 300,
  ...overrides,
});

const preset = (id: string) => {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('each provider’s shape', () => {
  it('Anthropic: a base64 document block with its title, before the words', () => {
    const wire = new AnthropicWire(fakeFetch(() => jsonResponse({})).fetch);
    const message = wire.userMessage('Summarise it', [], [doc()]);
    expect(message.content).toEqual([
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: PDF },
        title: 'report.pdf',
      },
      { type: 'text', text: 'Summarise it' },
    ]);
    expect(wire.takesPdfs).toBe(true);
    expect(wire.pdfsFor()).toMatchObject({ maxPages: 100, maxBytes: 32 * 1024 * 1024 });
  });

  it('chat APIs: a `file` part with its name and a data URL, before pictures and words', () => {
    const message = chatUserMessage(
      'Summarise it',
      [{ data: JPEG, mimeType: 'image/jpeg' }],
      [doc()],
    );
    expect(message.content).toEqual([
      {
        type: 'file',
        file: { filename: 'report.pdf', file_data: `data:application/pdf;base64,${PDF}` },
      },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${JPEG}` } },
      { type: 'text', text: 'Summarise it' },
    ]);
    // Without either, the words stay a plain string.
    expect(chatUserMessage('Hi', [], []).content).toBe('Hi');
  });

  it('OpenAI and Gemini send PDFs to the models that see; the rest of the presets never', () => {
    const fetch = fakeFetch(() => jsonResponse({})).fetch;
    const openai = new OpenAiWire(preset('openai'), fetch);
    expect(openai.takesPdfs).toBe(true);
    expect(openai.pdfsFor('gpt-5')).toMatchObject({ maxBytes: 50 * 1024 * 1024 });
    const gemini = new OpenAiWire(preset('gemini'), fetch);
    expect(gemini.pdfsFor('gemini-3-flash')?.maxPages).toBe(1_000);
    const xai = new OpenAiWire(preset('xai'), fetch);
    expect(xai.takesPdfs).toBe(false);
    expect(xai.pdfsFor('grok-4')).toBeUndefined();
  });

  it('OpenRouter: only to a model it lists as taking files, read by the model itself', async () => {
    const KEY = 'sk-or-v1-' + 'k'.repeat(20);
    const api = fakeFetch((call) =>
      call.url.endsWith('/models/user')
        ? jsonResponse({
            data: [
              {
                id: 'anthropic/claude-sonnet-4.6',
                name: 'Claude',
                supported_parameters: ['tools'],
                architecture: { input_modalities: ['text', 'image', 'file'] },
              },
              {
                id: 'some/sees',
                name: 'Sees',
                supported_parameters: ['tools'],
                architecture: { input_modalities: ['text', 'image'] },
              },
            ],
          })
        : sseResponse(dataFrames('[DONE]')),
    );
    const wire = new OpenRouterWire(api.fetch);
    await wire.models({ key: KEY });
    expect(wire.pdfsFor('anthropic/claude-sonnet-4.6')).toBeDefined();
    // Otherwise OpenRouter would have Mistral's OCR read it: a company nobody chose.
    expect(wire.pdfsFor('some/sees')).toBeUndefined();
    expect(wire.pdfsFor('never/listed')).toBeUndefined();

    const request = (messages: WireRequest['messages']): WireRequest => ({
      key: KEY,
      model: 'anthropic/claude-sonnet-4.6',
      system: 'You are Pearl.',
      messages,
      tools: [],
      effort: 'auto',
      signal: new AbortController().signal,
    });
    for await (const _ of wire.stream(request([wire.userMessage('Read', [], [doc()])]))) void _;
    for await (const _ of wire.stream(request([wire.userMessage('Hi')]))) void _;
    const bodies = api.calls.slice(1).map((c) => c.body as Record<string, unknown>);
    expect(bodies[0]?.['plugins']).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
    expect(bodies[1]?.['plugins']).toBeUndefined();
  });
});

describe('a PDF in the transcript', () => {
  const anthropic = {
    role: 'user',
    content: [
      new AnthropicWire(fakeFetch(() => jsonResponse({})).fetch).userMessage('x', [], [doc()])
        .content,
    ].flat(),
  };
  const chat = chatUserMessage('x', [], [doc({ name: 'b.pdf' })]);

  it('is found in either shape, with its name', () => {
    expect(documentOf((anthropic.content as unknown[])[0])).toEqual({
      name: 'report.pdf',
      data: PDF,
    });
    expect(documentOf((chat.content as unknown[])[0])).toEqual({ name: 'b.pdf', data: PDF });
    expect(hasDocuments(chat)).toBe(true);
    expect(hasDocuments({ role: 'user', content: 'Hi' })).toBe(false);
    // A picture's data URL isn't a PDF.
    expect(
      documentOf({ type: 'file', file: { file_data: 'data:image/png;base64,AAAA' } }),
    ).toBeUndefined();
  });

  it('costs its pages, not its base64 read as text', () => {
    expect(pagesOf(PDF)).toBe(2);
    rememberPages('Q'.repeat(9_000), 40);
    const big = chatUserMessage('x', [], [doc({ data: 'Q'.repeat(9_000) })]);
    const tokens = estimateTokens(big);
    expect(tokens).toBeGreaterThanOrEqual(40 * PAGE_TOKENS);
    expect(tokens).toBeLessThan(40 * PAGE_TOKENS + 100);
  });

  it('stays whole for a few of the person’s messages, then becomes a line', () => {
    const messages = [
      chat,
      ...Array.from({ length: KEEP_DOCUMENT_TURNS }, (_, i) => [
        { role: 'assistant', content: `answer ${i}` },
        { role: 'user', content: `question ${i}` },
      ]).flat(),
    ];
    const aged = ageDocuments(messages, startsTurn);
    expect(hasDocuments(aged[0] as never)).toBe(false);
    expect(JSON.stringify(aged[0])).toContain('The PDF \\"b.pdf\\" was shown here whole');
    // One message fewer, and it's still whole.
    expect(hasDocuments(ageDocuments(messages.slice(0, -2), startsTurn)[0] as never)).toBe(true);
  });

  it('recognises a refusal of a PDF, and not of something else', () => {
    expect(refusesDocuments('Invalid content type. file is not supported for this model')).toBe(
      true,
    );
    expect(refusesDocuments('No endpoints found that support file input')).toBe(true);
    expect(refusesDocuments('Rate limit exceeded')).toBe(false);
  });
});

// ── The engine ───────────────────────────────────────────────────────────────

function ended(text: string): AsyncIterable<WireEvent> {
  return (async function* () {
    yield { type: 'text', delta: text } as WireEvent;
    yield {
      type: 'end',
      message: { role: 'assistant', content: text },
      toolCalls: [],
      stop: 'end',
      usage: { inputTokens: 10, outputTokens: 2 },
    } as WireEvent;
  })();
}

function refusing(): AsyncIterable<WireEvent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        Promise.reject(new ApiError('other', 'Invalid content type: file is not supported')),
    }),
  };
}

/** A wire that records what it was sent; `limits` says what the model takes of a PDF. */
function pdfWire(
  options: { limits?: PdfLimits; refuse?: boolean; context?: number; sees?: boolean } = {},
) {
  const requests: WireRequest[] = [];
  let refuse = options.refuse ?? false;
  const wire: Wire & { requests: WireRequest[] } = {
    requests,
    source: 'Stub',
    takesPdfs: true,
    check: async () => ({ description: 'Stub' }),
    models: async () => [
      {
        info: {
          id: 'stub/model',
          label: 'Stub model',
          description: '',
          efforts: [],
          supportsFastMode: false,
          supportsAutoMode: false,
          images: options.sees ?? true,
          ...(options.context && { context: options.context }),
        },
        tools: true,
      },
    ],
    stream: (request) => {
      requests.push(structuredClone({ ...request, signal: undefined }) as never);
      if (refuse && request.messages.some(hasDocuments)) {
        refuse = false;
        return refusing();
      }
      return ended('Read it.');
    },
    complete: async () => ({ text: 'A title' }),
    userMessage: chatUserMessage,
    toolResults: () => [],
    smallModel: () => undefined,
    pdfsFor: () => options.limits,
  };
  return wire;
}

async function engineFor(wire: Wire): Promise<ApiEngine> {
  const { home, settings, keys } = await fakeHome();
  await keys.save('openrouter', 'sk-or-v1-' + 'k'.repeat(20));
  const variant: ApiVariant = {
    id: 'openrouter',
    label: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/settings/keys',
    canSignIn: true,
    wire,
    home,
  };
  return new ApiEngine(variant, settings, keys);
}

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c_1',
    prompt: '<attachments>…</attachments>\n\nWhat does it say?',
    systemAppend: 'You are Pearl.',
    cwd: process.cwd(),
    tools: [],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  };
}

const LIMITS: PdfLimits = { maxPages: 100, maxBytes: 32 * 1024 * 1024, pageTokens: 3_000 };
const firstUser = (wire: { requests: WireRequest[] }) =>
  wire.requests[0]?.messages.find((m) => m.role === 'user');

describe('the engine sends a PDF whole only where it can be read', () => {
  it('says it can, where the wire can send one', async () => {
    expect((await engineFor(pdfWire())).attachments.pdfs).toBe(true);
  });

  it('sends it whole to a model that reads PDFs, and says so after the message', async () => {
    const wire = pdfWire({ limits: LIMITS });
    const engine = await engineFor(wire);
    await collect(
      engine.runTurn(
        turn({
          documents: [doc({ pictures: [{ name: 'p1', mimeType: 'image/jpeg', data: JPEG }] })],
        }),
      ),
    );
    const sent = firstUser(wire);
    expect(sent && hasDocuments(sent)).toBe(true);
    const text = JSON.stringify(sent);
    expect(text).toContain(
      'Sent with this message whole, for you to read as PDFs: \\"report.pdf\\"',
    );
    // Its pictures were for a model that can't read it: not sent beside it.
    expect(text).not.toContain('image_url');
  });

  it('keeps it from a model that doesn’t, and shows the pictures of its thin pages instead', async () => {
    const wire = pdfWire({});
    const engine = await engineFor(wire);
    await collect(
      engine.runTurn(
        turn({
          documents: [doc({ pictures: [{ name: 'p1', mimeType: 'image/jpeg', data: JPEG }] })],
        }),
      ),
    );
    const sent = firstUser(wire);
    expect(sent && hasDocuments(sent)).toBe(false);
    const text = JSON.stringify(sent);
    expect(text).toContain('image_url');
    expect(text).toContain('this model doesn’t read PDFs');
  });

  it('puts the pages in words for a model that can’t see either', async () => {
    const wire = pdfWire({ sees: false });
    const engine = await engineFor(wire);
    const asked: number[] = [];
    await collect(
      engine.runTurn(
        turn({
          documents: [doc({ pictures: [{ name: 'p1', mimeType: 'image/jpeg', data: JPEG }] })],
          describe: async (images) => {
            asked.push(images.length);
            return { text: 'A scanned invoice for 120 euros.' };
          },
        }),
      ),
    );
    expect(asked).toEqual([1]);
    expect(JSON.stringify(firstUser(wire))).toContain('A scanned invoice for 120 euros.');
  });

  it('keeps to the model’s pages and half its window', async () => {
    const wire = pdfWire({ limits: { ...LIMITS, maxPages: 10 } });
    const engine = await engineFor(wire);
    await collect(
      engine.runTurn(turn({ documents: [doc({ pages: 8 }), doc({ name: 'two.pdf', pages: 8 })] })),
    );
    const text = JSON.stringify(firstUser(wire));
    expect(text).toContain('read as PDFs: \\"report.pdf\\"');
    expect(text).toContain('\\"two.pdf\\": too long to send whole to this model');

    // 40 pages at 3,000 tokens is more than half of a 200,000-token window.
    const small = pdfWire({ limits: LIMITS, context: 200_000 });
    await collect((await engineFor(small)).runTurn(turn({ documents: [doc({ pages: 40 })] })));
    expect(hasDocuments(firstUser(small) as never)).toBe(false);
  });

  it('heals a refusal: the model gets the text, once, and from then on', async () => {
    const wire = pdfWire({ limits: LIMITS, refuse: true });
    const engine = await engineFor(wire);
    const events = await collect(engine.runTurn(turn({ documents: [doc()] })));
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ code: 'no-pdfs' });
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    expect(wire.requests).toHaveLength(2);
    expect(wire.requests[1]?.messages.some(hasDocuments)).toBe(false);
    expect(JSON.stringify(wire.requests[1]?.messages)).toContain(
      'can’t be read whole by this model',
    );

    await collect(engine.runTurn(turn({ conversationId: 'c_2', documents: [doc()] })));
    expect(wire.requests[2]?.messages.some(hasDocuments)).toBe(false);
  });
});
