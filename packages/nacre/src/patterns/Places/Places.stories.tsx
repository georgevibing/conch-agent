import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { CAFES, GRID, MOSAIC, MUSEUM, ORIGIN } from './fixtures';
import { Places } from './Places';

const ATTRIBUTION = '© OpenStreetMap contributors';

const meta = {
  title: 'Patterns/Chat/Places',
  component: Places,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What a place search found (`places`): a map and a list. The map is a small mosaic of the map service’s own tiles, fetched once by the gateway and served from Conch, so the page never loads a remote picture; numbered pins are put where Web Mercator says and drop in with a springy stagger. It moves with CSS transforms only: drag to pan inside the mosaic, pinch or ⌘/ctrl-scroll or the ± buttons to zoom, arrows and +/− when it has focus. Each row and its pin light together; pressing a row selects it, glides the map to it and opens its hours, phone, website and Directions (Apple Maps, Google Maps, OpenStreetMap). Open or closed is said in words, with a mark beside them. One place alone is a large map with its address card. The credit is always in sight. In the dark the light tiles are turned over (inverted, hues put back, contrast and colour eased) so they sit in the page. Reduced motion: no drops, no glide.',
      },
    },
  },
  args: {
    mode: 'nearby',
    query: 'coffee',
    origin: ORIGIN,
    center: ORIGIN,
    zoom: GRID.zoom,
    map: MOSAIC,
    attribution: ATTRIBUTION,
    places: CAFES,
  },
} satisfies Meta<typeof Places>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A place chosen: its pin grows and says its name, and its row opens. */
export const Selected: Story = {
  args: { defaultSelected: 1, still: true },
};

/** Pressing a row from the keyboard: arrows move between rows, Space or Enter opens one. */
export const KeyboardSelect: Story = {
  args: { still: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole('radio', { name: /Kiosk on the Green/ });
    first.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown} ');
    await expect(canvas.getByRole('radio', { name: /Arcade Espresso Bar/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  },
};

/** Three places: a short list. */
export const Few: Story = {
  args: { places: CAFES.slice(0, 3), query: 'coffee shops' },
};

/** The tiles couldn't be fetched: pins on a quiet plan of the card's own ink, still in their places. */
export const WithoutTiles: Story = {
  args: { map: { ...MOSAIC, tiles: MOSAIC.tiles.map(() => null) } },
};

/** No map at all (an older view): the card draws its own grid around the places. */
export const NoMap: Story = {
  args: { map: undefined },
};

/** Where one place is: a large map with its pin and its address card. */
export const OnePlace: Story = {
  args: {
    mode: 'place',
    query: undefined,
    origin: undefined,
    center: MUSEUM,
    places: [MUSEUM],
  },
};

/** How far one place is from another: the place, its distance, and a ring where it's from. */
export const HowFar: Story = {
  args: {
    mode: 'place',
    query: undefined,
    origin: { name: 'Mill Lane', lat: 51.5097, lon: -0.1442 },
    center: MUSEUM,
    places: [{ ...MUSEUM, distance: 360 }],
  },
};

/** Nothing found: a calm line that says what might help. */
export const Empty: Story = {
  args: { places: [] },
};

/** Long names and no hours: the rows keep one line each and say only what they know. */
export const Long: Story = {
  args: {
    places: CAFES.slice(0, 4).map((p, i) => ({
      ...p,
      name:
        i === 0 ? 'The Very Long Named Coffee House and Reading Room of the Green Park' : p.name,
      ...(i === 1 && { openNow: undefined, hours: undefined }),
      ...(i === 2 && { rating: 4.6 }),
    })),
  },
};

/** At a phone's width: the map on top, the list under it, bigger rows for a thumb. */
export const Phone: Story = {
  args: { still: true, defaultSelected: 0 },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 360 }}>
        <Story />
      </div>
    ),
  ],
};
