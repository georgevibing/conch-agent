import type { ToolView } from '@conch/protocol';
import { NacreProvider } from '@conch/nacre';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { recipeCards } from './recipes';
import { standsAlone } from './telling';
import { ToolFound } from './ToolFound';

const view: ToolView = {
  kind: 'recipe',
  items: [
    {
      title: 'Tomato rice',
      source: { site: 'Pretend Kitchen', url: 'https://kitchen.example.org/r' },
      picture: {
        id: 'att_pic1',
        name: 'Tomato rice.jpg',
        mimeType: 'image/jpeg',
        size: 10,
        kind: 'image',
        width: 800,
        height: 450,
        createdAt: 1,
      },
      times: { total: 1800 },
      ingredients: [{ text: '1 cup rice', quantity: 1, unit: 'cup', item: 'rice' }],
      steps: [{ text: 'Simmer for 18 minutes.', timers: [{ start: 11, end: 21, seconds: 1080 }] }],
    },
  ],
};

describe('recipe cards in the chat', () => {
  it('draws the picture from Conch itself, never a remote address', () => {
    const [card] = recipeCards(view.kind === 'recipe' ? view.items : []);
    expect(card?.picture).toEqual({ src: '/api/attachments/att_pic1', width: 800, height: 450 });
    render(
      <NacreProvider>
        <ToolFound view={view} />
      </NacreProvider>,
    );
    expect(screen.getByRole('article', { name: 'Tomato rice' })).toBeInTheDocument();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/attachments/att_pic1');
  });

  it('stands alone under its story: the card is the answer', () => {
    expect(standsAlone(view)).toBe(true);
  });
});
