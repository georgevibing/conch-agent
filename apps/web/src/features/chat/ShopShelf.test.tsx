import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => vi.unstubAllGlobals());

function push(seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId: 'c1', seq, at: 1000 + seq, ...event },
  } as never);
}

const photo = {
  id: 'att_kettle',
  name: 'Kettle.png',
  mimeType: 'image/png',
  size: 1200,
  kind: 'image',
  width: 800,
  height: 600,
  createdAt: 1,
};

describe('products a tool found, in the chat', () => {
  it('stands in sight as a shelf, with photos from Conch, and Ask fills the composer', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    const composer = await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push(0, { type: 'user.message', messageId: 'u1', text: 'Shop for a kettle' });
      push(1, {
        type: 'tool.started',
        toolUseId: 't1',
        name: 'mcp__conch__product_details',
        input: { urls: ['https://shop.example/a', 'https://shop.example/b'] },
      });
      push(2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: '{"products":[]}',
        view: {
          kind: 'products',
          items: [
            {
              title: 'Stagg EKG',
              url: 'https://shop.example/a',
              picture: photo,
              price: { amount: 149, currency: 'USD' },
              store: 'Example Shop',
            },
            { title: 'Classic kettle', url: 'https://shop.example/b' },
          ],
        },
      });
    });
    const shelf = await screen.findByRole('region', { name: 'Products, 2' });
    const img = shelf.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/attachments/att_kettle');
    expect(img).toHaveAttribute('width', '800');
    await userEvent.click(within(shelf).getByRole('button', { name: 'Ask about Stagg EKG' }));
    expect(composer).toHaveValue('About the “Stagg EKG” from Example Shop: ');
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/messages'))).toBe(false);
  });
});
