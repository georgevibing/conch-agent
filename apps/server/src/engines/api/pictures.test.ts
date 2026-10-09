import { describe, expect, it } from 'vitest';

import { AnthropicWire } from './anthropic';
import { bridgeToolToUser, chatToolResults } from './chat';
import { readable } from './context';
import { OllamaWire } from './ollama';
import {
  ageToolPictures,
  hasPictures,
  isToolPictures,
  KEEP_TOOL_PICTURES,
  OLD_PICTURE,
  picturesOf,
  refusesImages,
  TOOL_PICTURE_BATCH,
  TOOL_PICTURES,
  wordsForPictures,
} from './pictures';
import { startsTurn } from './session';
import type { WireMessage } from './types';
import type { ToolResult } from './wire';

const JPEG = '/9j/' + 'A'.repeat(40);
const PNG = 'iVBOR' + 'B'.repeat(40);
const shot = { data: JPEG, mimeType: 'image/jpeg' as const };

const screenshot = (id: string, data = JPEG): ToolResult => ({
  id,
  name: 'mcp__conch__browser_screenshot',
  text: 'Screenshot of “Shop” (https://shop.test): the visible part of the page, 1280×800 pixels.',
  isError: false,
  images: [{ data, mimeType: 'image/jpeg' }],
});

const ollama = () =>
  new OllamaWire({
    client: { fetch: globalThis.fetch, url: (p: string) => `http://127.0.0.1:11434${p}` },
  } as never);

describe('a tool’s pictures, in each provider’s shape', () => {
  it('rides inside the tool_result for Anthropic, after its words', () => {
    const [message] = new AnthropicWire(globalThis.fetch).toolResults([screenshot('toolu_1')]);
    expect(message).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [
            { type: 'text', text: expect.stringContaining('Screenshot of') },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } },
          ],
        },
      ],
    });
    // Still the middle of a turn, and its picture is found.
    expect(startsTurn(message as WireMessage)).toBe(false);
    expect(picturesOf(message as WireMessage)).toEqual([shot]);
  });

  it('follows the tool messages in one user message for the chat APIs', () => {
    const messages = chatToolResults([
      screenshot('call_1'),
      { id: 'call_2', name: 'remember', text: 'Saved.', isError: false },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: expect.any(String),
    });
    expect(messages[1]).toEqual({ role: 'tool', tool_call_id: 'call_2', content: 'Saved.' });
    const pictures = messages[2] as WireMessage;
    expect(pictures.role).toBe('user');
    expect(pictures.content).toEqual([
      { type: 'text', text: expect.stringContaining('mcp__conch__browser_screenshot') },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${JPEG}` } },
    ]);
    expect(isToolPictures(pictures)).toBe(true);
    // It isn't the person speaking: no new turn starts there.
    expect(startsTurn(pictures)).toBe(false);
    expect(readable(pictures)).toEqual(['Tool result: [a picture]']);
  });

  it('adds nothing when no tool returned a picture', () => {
    expect(chatToolResults([{ id: 'c', name: 't', text: 'ok', isError: false }])).toHaveLength(1);
  });

  it('follows the tool messages with `images` for Ollama', () => {
    const messages = ollama().toolResults([screenshot('call_1', PNG)]);
    expect(messages[0]).toMatchObject({
      role: 'tool',
      tool_name: 'mcp__conch__browser_screenshot',
    });
    const pictures = messages[1] as WireMessage;
    expect(pictures).toEqual({
      role: 'user',
      content: expect.stringMatching(/^\[Pictures from the tool results above/),
      images: [PNG],
    });
    expect(startsTurn(pictures)).toBe(false);
    expect(picturesOf(pictures)).toEqual([{ data: PNG, mimeType: 'image/png' }]);
  });

  it('puts a blank assistant turn between a tool and a user message, only for Mistral’s request', () => {
    const messages: WireMessage[] = [
      { role: 'user', content: 'Look at it' },
      { role: 'assistant', content: null, tool_calls: [] },
      ...chatToolResults([screenshot('call_1')]),
    ];
    const bridged = bridgeToolToUser(messages);
    expect(bridged.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
    expect(bridged[3]).toEqual({ role: 'assistant', content: ' ' });
    // The transcript itself is untouched.
    expect(messages).toHaveLength(4);
  });
});

describe('taking pictures out of a transcript', () => {
  const person: WireMessage = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
      { type: 'text', text: 'What is this?' },
    ],
  };

  it('finds the person’s pictures in every shape', () => {
    expect(picturesOf(person)).toEqual([{ data: PNG, mimeType: 'image/png' }]);
    expect(picturesOf({ role: 'user', content: 'hi', images: [JPEG] })).toEqual([shot]);
    expect(
      picturesOf({
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
        ],
      }),
    ).toEqual([{ data: PNG, mimeType: 'image/png' }]);
    expect(hasPictures({ role: 'user', content: 'just words' })).toBe(false);
  });

  it('puts every picture into words for a model that turned out blind', () => {
    const tool = new AnthropicWire(globalThis.fetch).toolResults([
      screenshot('toolu_1'),
    ])[0] as WireMessage;
    const words = (picture: { data: string }) => `[seen: ${picture.data.slice(0, 4)}]`;
    expect(wordsForPictures(person, words).content).toEqual([
      { type: 'text', text: '[seen: iVBO]' },
      { type: 'text', text: 'What is this?' },
    ]);
    expect(hasPictures(wordsForPictures(tool, words))).toBe(false);
    const local = wordsForPictures({ role: 'user', content: 'Look', images: [JPEG] }, words);
    expect(local).toEqual({ role: 'user', content: 'Look\n\n[seen: /9j/]' });
    // A message without pictures is the same object.
    const plain: WireMessage = { role: 'user', content: 'hi' };
    expect(wordsForPictures(plain, words)).toBe(plain);
  });

  it('keeps only the newest tool pictures, never touching the person’s', () => {
    const turn = (n: number): WireMessage[] => [
      { role: 'assistant', content: null, tool_calls: [{ id: `c${n}` }] },
      ...chatToolResults([screenshot(`c${n}`, `/9j/${n}${'A'.repeat(40)}`)]),
    ];
    const messages = [person, ...turn(1), ...turn(2), ...turn(3), ...turn(4), ...turn(5)];
    const aged = ageToolPictures(messages, 3, 0);
    const left = aged.filter(isToolPictures).map((m) => picturesOf(m).length);
    expect(left).toEqual([0, 0, 1, 1, 1]);
    expect(JSON.stringify(aged)).toContain(OLD_PICTURE);
    expect(aged[0]).toBe(person);
    // The aged ones are still recognised as a tool's, so no turn starts there.
    expect(aged.filter(startsTurn)).toHaveLength(1);
  });

  it('lets old pictures go in batches, so the cached start of the chat holds between', () => {
    const turn = (n: number): WireMessage[] => [
      { role: 'assistant', content: null, tool_calls: [{ id: `c${n}` }] },
      ...chatToolResults([screenshot(`c${n}`, `/9j/${n}${'A'.repeat(40)}`)]),
    ];
    const pictures = (messages: readonly WireMessage[]) =>
      messages.reduce((n, m) => n + picturesOf(m).length, 0);
    let messages: WireMessage[] = [person];
    const counts: number[] = [];
    let changes = 0;
    for (let n = 1; n <= 40; n++) {
      messages = [...messages, ...turn(n)];
      const before = JSON.stringify(messages);
      messages = ageToolPictures(messages, KEEP_TOOL_PICTURES, TOOL_PICTURE_BATCH);
      if (JSON.stringify(messages) !== before) changes++;
      counts.push(pictures(messages) - 1);
    }
    // Every step until the batch fills is the same transcript plus the new step.
    expect(counts.slice(0, KEEP_TOOL_PICTURES + TOOL_PICTURE_BATCH)).toEqual(
      Array.from({ length: KEEP_TOOL_PICTURES + TOOL_PICTURE_BATCH }, (_, i) => i + 1),
    );
    expect(Math.max(...counts)).toBe(KEEP_TOOL_PICTURES + TOOL_PICTURE_BATCH);
    expect(Math.min(...counts.slice(KEEP_TOOL_PICTURES))).toBe(KEEP_TOOL_PICTURES);
    // 40 screenshots: two letting-gos, where every step after the third was one.
    expect(changes).toBe(Math.floor((40 - KEEP_TOOL_PICTURES - 1) / (TOOL_PICTURE_BATCH + 1)));
    // Never more pictures than a request may carry at full size.
    expect(KEEP_TOOL_PICTURES + TOOL_PICTURE_BATCH).toBeLessThan(20);
    // The person's own picture stays.
    expect(messages[0]).toBe(person);
  });

  it('ages nested Anthropic pictures too', () => {
    const wire = new AnthropicWire(globalThis.fetch);
    const messages = [1, 2, 3].flatMap((n) =>
      wire.toolResults([screenshot(`t${n}`, `/9j/${n}AAAA`)]),
    );
    const aged = ageToolPictures(messages, 1, 0);
    expect(aged.map((m) => picturesOf(m).length)).toEqual([0, 0, 1]);
  });

  it('starts the tool-pictures message with the words Conch knows it by', () => {
    const [, pictures] = chatToolResults([screenshot('c')]);
    const first = (pictures?.content as { text: string }[])[0];
    expect(first?.text.startsWith(TOOL_PICTURES)).toBe(true);
  });
});

describe('a model that can’t look at pictures, in every provider’s words', () => {
  it.each([
    ['OpenAI', 'Invalid content type. image_url is only supported by certain models.'],
    ['OpenRouter', 'No endpoints found that support image input'],
    [
      'DeepSeek',
      'Failed to deserialize the JSON body into the target type: messages[1]: unknown variant `image_url`, expected `text`',
    ],
    ['Groq', 'messages[2].content must be a string'],
    ['Mistral', 'Image input is not supported for this model.'],
    [
      'llama.cpp',
      'image input is not supported - hint: if this is unexpected, you may need to provide the mmproj',
    ],
    ['Ollama', 'this model is missing data required for image input'],
    ['vLLM', 'This model does not support multimodal inputs'],
    ['Gemini', 'This model does not support image input.'],
  ])('%s', (_who, text) => {
    expect(refusesImages(text)).toBe(true);
  });

  it.each([
    'The request exceeds the maximum context length of 8192 tokens.',
    'Invalid API key provided.',
    'image exceeds 5 MB maximum',
    'tools are not supported for this model',
  ])('not: %s', (text) => {
    expect(refusesImages(text)).toBe(false);
  });
});
