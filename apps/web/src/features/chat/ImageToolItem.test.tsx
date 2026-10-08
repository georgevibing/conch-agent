import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';
import { modelWords, reasonWords, shortPrompt } from './ImageToolItem';

afterEach(() => vi.unstubAllGlobals());

// Each test its own chat: the live store outlives a test.
let chat = 'c0';

function push(seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId: chat, seq, at: 1000 + seq * 1000, ...event },
  } as never);
}

const prompt =
  'A polished cinematic 3D render of sand dunes at dusk, a low sun behind soft haze. Long shadows.';

async function open() {
  chat = `c${Number(chat.slice(1)) + 1}`;
  mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
  });
  renderApp(<ChatView conversationId={chat} />, { route: `/c/${chat}` });
  await screen.findByRole('textbox', { name: 'Message Conch' });
  act(() => {
    push(0, { type: 'user.message', messageId: 'u1', text: 'Make me a picture of dunes' });
    push(1, {
      type: 'tool.started',
      toolUseId: 't1',
      name: 'mcp__conch__image_generate',
      input: { prompt, aspect_ratio: '3:2' },
    });
  });
}

describe('the picture tool in the chat', () => {
  it('takes shape while it’s made, then is the picture with what you can do, and no raw call', async () => {
    await open();
    expect(screen.getByRole('progressbar', { name: 'Making the picture' })).not.toHaveAttribute(
      'aria-valuenow',
    );
    act(() => {
      push(2, { type: 'tool.progress', toolName: 'image_generate', stage: 'queued', progress: 0 });
      push(3, {
        type: 'tool.progress',
        toolName: 'image_generate',
        stage: 'generating',
        progress: 0.5,
        by: 'OpenAI',
      });
    });
    const bar = screen.getByRole('progressbar', { name: 'Making the picture' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuetext', '50%');
    expect(screen.getByText('with OpenAI')).toBeInTheDocument();
    expect(
      screen.getByText('A polished cinematic 3D render of sand dunes at dusk, a low sun…'),
    ).toBeInTheDocument();

    act(() =>
      push(4, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        durationMs: 28_000,
        output: JSON.stringify({
          id: 'a1',
          name: 'Generated image.png',
          path: '/Users/someone/.conch/attachments/a1.png',
          model: 'google/gemini-2.5-flash-image',
          costUsd: 0.039,
        }),
        view: {
          kind: 'downloads',
          items: [
            {
              id: 'a1',
              name: 'Generated image.png',
              mimeType: 'image/png',
              size: 1000,
              kind: 'image',
              width: 1536,
              height: 1024,
              createdAt: 1,
            },
          ],
        },
      }),
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    const img = screen.getByRole('img', { name: /sand dunes at dusk/ });
    expect(img).toHaveAttribute('src', '/api/attachments/a1');
    fireEvent.load(img);
    expect(screen.getByRole('link', { name: /^Download/ })).toHaveAttribute(
      'href',
      '/api/attachments/a1?download=1',
    );
    // Never the raw call or a file path.
    expect(screen.queryByText(/\/Users\/someone/)).toBeNull();
    expect(screen.queryByText('Input')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Gemini 2.5 Flash Image, by Google')).toBeVisible();
    expect(screen.getByText('OpenAI')).toBeVisible();
    expect(screen.getByText('1536 × 1024')).toBeVisible();
    expect(screen.getByText('$0.04')).toBeVisible();
    expect(screen.queryByText(/\/Users\/someone/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Change it' }));
    expect(screen.getByRole('textbox', { name: 'Message Conch' })).toHaveValue(
      'Change “A polished cinematic 3D render of sand dunes at dusk, a low sun…”: ',
    );
  });

  it('says calmly when you said no, never a tick', async () => {
    await open();
    act(() =>
      push(2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: 'The user declined. No image request was sent.',
      }),
    );
    expect(screen.getByText('Not made: you said no')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says why it couldn’t be made', async () => {
    await open();
    act(() =>
      push(2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'error',
        output: 'Error: Your monthly budget has been reached.',
      }),
    );
    expect(
      screen.getByText('Couldn’t make it: Your monthly budget has been reached.'),
    ).toBeInTheDocument();
  });
});

describe('picture words', () => {
  it('names models and trims prompts and reasons', () => {
    expect(modelWords('google/gemini-2.5-flash-image')).toBe('Gemini 2.5 Flash Image, by Google');
    expect(modelWords('openai/gpt-image-1')).toBe('GPT Image 1, by OpenAI');
    expect(modelWords('black-forest-labs/flux.2-pro')).toBe('Flux.2 Pro, by Black Forest Labs');
    expect(modelWords('gpt-image-1')).toBe('GPT Image 1');
    expect(shortPrompt('A cat. On a mat.')).toBe('A cat');
    expect(shortPrompt('x'.repeat(100)).length).toBeLessThanOrEqual(65);
    expect(reasonWords('MCP error -32603: Error: Too big')).toBe('Too big');
    expect(reasonWords('')).toBeUndefined();
  });
});
