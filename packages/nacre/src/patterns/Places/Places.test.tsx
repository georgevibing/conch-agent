import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CAFES, GRID, MOSAIC, MUSEUM, ORIGIN } from './fixtures';
import { clampView, distanceWords, onGrid, openWords, zoomAt } from './geo';
import { Places, type Place } from './Places';

const ATTRIBUTION = '© OpenStreetMap contributors';
const base = {
  query: 'coffee',
  origin: ORIGIN,
  center: ORIGIN,
  zoom: GRID.zoom,
  map: MOSAIC,
  attribution: ATTRIBUTION,
  places: CAFES,
};

const transformOf = (container: HTMLElement) =>
  (container.querySelector('[aria-roledescription="map"] > div') as HTMLElement).style.transform;

describe('Places', () => {
  it('shows the list, the pins and the credit, accessibly', async () => {
    const { container } = renderNacre(<Places {...base} still />);
    expect(
      screen.getByRole('region', { name: /Map of 8 places near The Grand Hotel/ }),
    ).toBeVisible();
    // A long list shows its first five, and all eight one press away.
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: /Show all 8 places/ }));
    expect(screen.getAllByRole('radio')).toHaveLength(8);
    expect(screen.getByText('Coffee near The Grand Hotel')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: ATTRIBUTION })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    // Same-origin pictures only: the drawn tiles, never a remote address.
    const tiles = [...container.querySelectorAll('img')];
    expect(tiles).toHaveLength(6);
    expect(tiles.every((t) => t.getAttribute('src')?.startsWith('data:'))).toBe(true);
    // Open or closed in words, not colour alone.
    expect(screen.getAllByText('Open now').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
    expect(screen.getByText('Open 24 hours')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('puts every pin inside the map where its point is', () => {
    for (const p of CAFES) {
      const at = onGrid(GRID, p.lat, p.lon);
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(1);
      expect(at.y).toBeGreaterThan(0);
      expect(at.y).toBeLessThan(1);
    }
  });

  it('moves between rows with the arrows, opens one, and glides the map to it', async () => {
    const onSelectedChange = vi.fn();
    const { container } = renderNacre(
      <Places {...base} still onSelectedChange={onSelectedChange} />,
    );
    await userEvent.tab();
    // The map takes focus first, then the list is one stop.
    expect(screen.getByRole('region', { name: /Map of/ })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    const rows = screen.getAllByRole('radio');
    rows[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSelectedChange).toHaveBeenLastCalledWith(1);
    expect(rows[1]).toHaveAttribute('aria-checked', 'true');
    // Its details, with directions that open in a tab of their own.
    const directions = screen.getByRole('group', { name: 'Directions to Little Copper Coffee' });
    const links = within(directions).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Apple Maps', 'Google Maps', 'OpenStreetMap']);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getByText('12 Grand Street, London W1J 9AA')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /example\.org/ })).toHaveAttribute(
      'href',
      'https://example.org/copper',
    );
    // Moved in, closer.
    expect(transformOf(container)).toMatch(/scale\(1\.6\)/);
    await expectAccessible(container);
  });

  it('lights a row’s pin and a pin’s row', async () => {
    const { container } = renderNacre(<Places {...base} still />);
    const rows = screen.getAllByRole('radio');
    fireEvent.pointerEnter(rows[2] as HTMLElement);
    const spots = container.querySelectorAll('[data-lit]');
    // The row and its pin.
    expect(spots).toHaveLength(2);
    fireEvent.pointerLeave(rows[2] as HTMLElement);
    const pins = container.querySelectorAll('button[tabindex="-1"]');
    fireEvent.pointerEnter(pins[4] as HTMLElement);
    expect(rows[4]).toHaveAttribute('data-lit');
    // Pressing a pin chooses its place, and pressing it again lets go.
    fireEvent.click(pins[4] as HTMLElement);
    expect(rows[4]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByText('Mill Lane Bakery & Café').length).toBe(2);
    fireEvent.click(pins[4] as HTMLElement);
    expect(rows[4]).toHaveAttribute('aria-checked', 'false');
  });

  it('zooms with its buttons and keys, and pans only inside the mosaic', async () => {
    const { container } = renderNacre(<Places {...base} still />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(transformOf(container)).toMatch(/scale\(1\.5\)/);
    const map = screen.getByRole('region', { name: /Map of/ });
    map.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    // Pushed as far as it goes: the left edge, never beyond.
    expect(transformOf(container)).toMatch(/^translate\(0%/);
    await userEvent.keyboard('0');
    expect(transformOf(container)).toBe('translate(0%, 0%) scale(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show the whole map' }));
    expect(transformOf(container)).toBe('translate(0%, 0%) scale(1)');
  });

  it('shows one place large, with how far it is', async () => {
    const { container } = renderNacre(
      <Places
        mode="place"
        center={MUSEUM}
        zoom={16}
        map={MOSAIC}
        attribution={ATTRIBUTION}
        origin={{ name: 'Mill Lane', lat: 51.5097, lon: -0.1442 }}
        places={[{ ...MUSEUM, distance: 360 }]}
      />,
    );
    expect(screen.getByText('Museum of Small Things')).toBeInTheDocument();
    expect(screen.getByText('360 m from Mill Lane, as the crow flies')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Directions in Google Maps' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('draws outside words as plain text and drops links that aren’t secure', () => {
    const { container } = renderNacre(
      <Places
        {...base}
        defaultSelected={0}
        places={[
          {
            ...(CAFES[0] as Place),
            name: '<img src=x onerror=alert(1)>',
            website: 'javascript:alert(1)',
            url: 'http://example.org/insecure',
            directions: { apple: 'javascript:x', google: 'http://x', osm: 'https://ok.example/' },
          },
        ]}
      />,
    );
    expect(container.querySelectorAll('img[src="x"]')).toHaveLength(0);
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.every((h) => h?.startsWith('https://'))).toBe(true);
    expect(hrefs).toContain('https://ok.example/');
  });

  it('draws a plan where tiles are missing, and says so when nothing was found', () => {
    const { container, rerender } = renderNacre(
      <Places {...base} map={{ ...MOSAIC, tiles: MOSAIC.tiles.map(() => null) }} />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    rerender(<Places {...base} places={[]} />);
    expect(screen.getByText(/Nothing like that near The Grand Hotel/)).toBeInTheDocument();
    expect(screen.getByText(ATTRIBUTION)).toBeInTheDocument();
  });
});

describe('map sums and words', () => {
  it('keeps the view inside the mosaic and zooms around a point', () => {
    expect(clampView({ s: 0.5, tx: 3, ty: -9 })).toEqual({ s: 1, tx: 0, ty: 0 });
    expect(clampView({ s: 2, tx: -3, ty: 0.4 })).toEqual({ s: 2, tx: -1, ty: 0 });
    const z = zoomAt({ s: 1, tx: 0, ty: 0 }, 2, 0.25, 0.25);
    // The point under the pointer stays under it.
    expect((0.25 - z.tx) / z.s).toBeCloseTo(0.25);
    expect(z.s).toBe(2);
  });

  it('says distances and hours as people do', () => {
    expect(distanceWords(118)).toBe('120 m');
    expect(distanceWords(1430)).toBe('1.4 km');
    expect(distanceWords(2000)).toBe('2 km');
    expect(distanceWords(76_800)).toBe('77 km');
    expect(openWords({ open: true, at: '18:00' })).toEqual({
      state: 'Open now',
      next: 'closes 18:00',
    });
    expect(openWords({ open: false, at: '09:00', day: 'Mon' })).toEqual({
      state: 'Closed',
      next: 'opens Mon 09:00',
    });
    expect(openWords({ open: true, always: true })).toEqual({ state: 'Open 24 hours' });
  });
});
