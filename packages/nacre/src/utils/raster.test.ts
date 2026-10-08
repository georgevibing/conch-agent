import { afterEach, describe, expect, it } from 'vitest';

import { cardSvg, CardImageError } from './raster';

/** jsdom lays nothing out: a card says how big it is, as a real one would. */
function sized<T extends Element>(element: T, width = 480, height = 260): T {
  element.getBoundingClientRect = () =>
    ({
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const card = host.firstElementChild as HTMLElement;
  document.body.append(host);
  return sized(card);
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-nacre-mode');
});

describe('cardSvg', () => {
  it('serialises an <svg> card standalone, with a background behind it', async () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<svg viewBox="0 0 200 100" class="chart"><rect width="200" height="100"/><text x="4" y="20">Mon</text></svg>';
    document.body.append(host);
    const svg = sized(host.firstElementChild as SVGSVGElement, 400, 200);

    const made = await cardSvg(svg, { background: '#101418' });
    expect(made.width).toBe(400);
    expect(made.height).toBe(200);
    expect(made.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(made.svg).toContain('width="400" height="200"');
    // Never transparent: a chat app shows a see-through PNG as a mess.
    expect(made.svg).toContain('<rect width="100%" height="100%" fill="#101418"/>');
    expect(made.svg).toContain('viewBox="0 0 200 100"');
    // The text is in the picture, not left to a stylesheet that can't travel.
    expect(made.svg).toContain('Mon');
    // Classes are gone: everything painted is written on the element.
    expect(made.svg).not.toContain('class="chart"');
  });

  it('wraps a DOM card in a foreignObject with the page’s CSS and the mode it is in', async () => {
    document.documentElement.setAttribute('data-nacre-mode', 'dark');
    const card = mount('<section class="wx"><h3>Berlin</h3><p>12°C, rain</p></section>');

    const made = await cardSvg(card, { background: 'rgb(13, 17, 22)' });
    expect(made.svg).toContain('<foreignObject');
    expect(made.svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(made.svg).toContain('<style type="text/css">');
    expect(made.svg).toContain('data-nacre-mode="dark"');
    expect(made.svg).toContain('Berlin');
    expect(made.svg).toContain('12°C, rain');
    // Animation off, so nothing renders mid-fade and comes out invisible.
    expect(made.svg).toContain('animation: none !important');
  });

  it('leaves the share bar and anything undrawable out of the picture', async () => {
    const card = mount(
      '<section><p>Keep me</p><canvas></canvas><iframe src="about:blank"></iframe><div data-share-hide="">Send</div></section>',
    );
    const made = await cardSvg(card);
    expect(made.svg).toContain('Keep me');
    expect(made.svg).not.toContain('<canvas');
    expect(made.svg).not.toContain('<iframe');
    // The bar is still serialised, then hidden by the export's own rule.
    expect(made.svg).toContain('[data-share-hide] { display: none !important; }');
  });

  it('adds the padding asked for, and gives a DOM card room to be taller', async () => {
    const card = mount('<section><p>Hello</p></section>');
    const made = await cardSvg(card, { padding: 12, width: 100, height: 50 });
    expect(made.width).toBe(124);
    // Room to spare below: a clipped card is the one failure we refuse, and
    // `cardPng` trims the spare background back off afterwards.
    expect(made.height).toBeGreaterThan(74);
    expect(made.svg).toMatch(/<foreignObject x="12" y="12" width="100" height="\d+">/);
  });

  it('is padded on every side of an <svg> card too, at the size it was asked for', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg viewBox="0 0 10 5"><rect width="10" height="5"/></svg>';
    document.body.append(host);
    const svg = sized(host.firstElementChild as SVGSVGElement, 200, 100);
    const made = await cardSvg(svg, { padding: 8 });
    expect([made.width, made.height]).toEqual([216, 116]);
    expect(made.svg).toContain('<g transform="translate(8 8)">');
  });

  it('says so rather than making a blank picture of a card that isn’t on screen', async () => {
    const card = mount('<section><p>Hidden</p></section>');
    sized(card, 0, 0);
    await expect(cardSvg(card)).rejects.toBeInstanceOf(CardImageError);
    await expect(cardSvg(card)).rejects.toThrow(/isn’t on screen/);
  });
});
