import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolView } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentStore } from '../attachments/store';
import type { AppFetcher, AppFetchResponse } from '../conchapps/types';
import type { ToolContext } from '../conversations/manager';
import { cleanView } from '../conversations/views';
import { amountOf, availabilityOf, productTools, readProduct } from './products';

// The smallest real PNG: one transparent pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
).toString('base64');

const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

/** A shop page with a full schema.org Product. */
const KETTLE = `<!doctype html><html><head><title>Kettle | Shop</title>
<meta property="og:site_name" content="Lakeland">
${ld({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [] },
    {
      '@type': 'Product',
      name: 'Stagg EKG <b>Electric</b> Kettle',
      description: 'A pour-over kettle that holds a temperature.',
      brand: { '@type': 'Brand', name: 'Fellow' },
      image: ['https://cdn.shop.example/kettle.png', { url: 'https://cdn.shop.example/side.png' }],
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.6', reviewCount: 1840 },
      additionalProperty: [{ '@type': 'PropertyValue', name: 'Capacity', value: '0.9 l' }],
      color: 'Matte black',
      offers: {
        '@type': 'Offer',
        price: '149.00',
        priceCurrency: 'usd',
        availability: 'https://schema.org/InStock',
        priceSpecification: [
          {
            '@type': 'UnitPriceSpecification',
            priceType: 'https://schema.org/StrikethroughPrice',
            price: 195,
            priceCurrency: 'USD',
          },
        ],
      },
    },
  ],
})}
</head><body><h1>Kettle</h1><script>ignore()</script></body></html>`;

/** A page with only Open Graph and product tags. */
const META_ONLY = `<html><head>
<meta property="og:type" content="product">
<meta property="og:title" content="Linen &amp; cotton throw">
<meta property="og:image" content="/img/throw.png">
<meta property="product:price:amount" content="39,90">
<meta property="product:price:currency" content="EUR">
<meta property="product:original_price:amount" content="49,90">
<meta property="product:original_price:currency" content="EUR">
<meta property="product:availability" content="out of stock">
</head></html>`;

describe('reading a shop page', () => {
  it('takes what a schema.org Product says, as plain text', () => {
    const p = readProduct(KETTLE, 'https://www.shop.example/kettle');
    expect(p).toMatchObject({
      title: 'Stagg EKG Electric Kettle',
      brand: 'Fellow',
      store: 'Lakeland',
      price: { amount: 149, currency: 'USD' },
      was: { amount: 195, currency: 'USD' },
      rating: { value: 4.6, count: 1840 },
      availability: 'in_stock',
      highlights: ['Capacity: 0.9 l', 'Colour: Matte black'],
      photos: ['https://cdn.shop.example/kettle.png', 'https://cdn.shop.example/side.png'],
    });
  });

  it('falls back to the page’s product tags', () => {
    const p = readProduct(META_ONLY, 'https://www.throws.example/p/1');
    expect(p).toMatchObject({
      title: 'Linen & cotton throw',
      store: 'throws.example',
      price: { amount: 39.9, currency: 'EUR' },
      was: { amount: 49.9, currency: 'EUR' },
      availability: 'out_of_stock',
      photos: ['https://www.throws.example/img/throw.png'],
    });
  });

  it('says nothing for a page that sells nothing, or whose data is broken', () => {
    expect(readProduct('<html><title>Search: kettles</title></html>', 'https://s.example/')).toBe(
      undefined,
    );
    expect(
      readProduct(
        '<script type="application/ld+json">{"@type": "Product", name: </script>',
        'https://s.example/',
      ),
    ).toBe(undefined);
  });

  it('reads prices and availability however shops write them', () => {
    expect(amountOf('1,299.00')).toBe(1299);
    expect(amountOf('1.299,00')).toBe(1299);
    expect(amountOf('12,99')).toBe(12.99);
    expect(amountOf('$149')).toBe(149);
    expect(amountOf('free')).toBeUndefined();
    expect(availabilityOf('http://schema.org/PreOrder')).toBe('preorder');
    expect(availabilityOf('LimitedAvailability')).toBe('limited');
    expect(availabilityOf('SoldOut')).toBe('out_of_stock');
    expect(availabilityOf('maybe')).toBe('unknown');
    // A rating out of ten is drawn out of five.
    const ten = readProduct(
      ld({ '@type': 'Product', name: 'X', aggregateRating: { ratingValue: 8, bestRating: 10 } }),
      'https://s.example/x',
    );
    expect(ten?.rating?.value).toBe(4);
    // A "was" that isn't more than the price is left out.
    const same = readProduct(
      ld({
        '@type': 'Product',
        name: 'Y',
        offers: {
          price: 20,
          priceCurrency: 'GBP',
          priceSpecification: { priceType: 'ListPrice', price: 20, priceCurrency: 'GBP' },
        },
      }),
      'https://s.example/y',
    );
    expect(same?.price).toEqual({ amount: 20, currency: 'GBP' });
    expect(same?.was).toBeUndefined();
  });

  it('keeps only secure photo addresses', () => {
    const p = readProduct(
      ld({
        '@type': 'Product',
        name: 'Z',
        image: ['http://cdn.example/a.png', 'javascript:alert(1)', 'https://u:p@cdn.example/b.png'],
      }),
      'https://s.example/z',
    );
    expect(p?.photos).toEqual([]);
  });
});

describe('product_details', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function tool(pages: Record<string, AppFetchResponse>) {
    dir = await mkdtemp(join(tmpdir(), 'conch-products-'));
    const store = new AttachmentStore(dir);
    const fetcher = vi.fn<AppFetcher>(async (_app, request) => {
      return (
        pages[request.url] ?? {
          ok: false,
          status: 0,
          headers: {},
          body: '',
          refused: 'Private network addresses are refused.',
        }
      );
    });
    const ctx = { conversationId: 'c1', signal: new AbortController().signal } as ToolContext;
    const [details] = productTools(ctx, { fetcher, store });
    if (!details) throw new Error('expected the tool');
    return { details, fetcher, store };
  }
  const html = (body: string): AppFetchResponse => ({
    ok: true,
    status: 200,
    headers: { 'content-type': 'text/html' },
    body,
  });
  const png: AppFetchResponse = {
    ok: true,
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: PNG,
    bodyBase64: true,
  };

  it('is a read that shows its row, and tells every model to judge, not repeat', async () => {
    const { details } = await tool({});
    expect(details).toMatchObject({ name: 'product_details', effect: 'read', row: true });
    expect(details.description).toMatch(/web_search first/);
    expect(details.description).toMatch(/do not list the products/i);
    expect(details.description).toMatch(/which one to pick and why/);
  });

  it('shows each product it could read, with its photos kept in the chat, and says what failed', async () => {
    const { details, store } = await tool({
      'https://www.shop.example/kettle': html(KETTLE),
      'https://cdn.shop.example/kettle.png': png,
      'https://cdn.shop.example/side.png': png,
      'https://www.throws.example/p/1': html(META_ONLY),
      'https://search.example/?q=kettle': html('<html><title>Results</title></html>'),
      'https://locked.example/p': { ok: false, status: 403, headers: {}, body: '' },
      'https://files.example/manual.pdf': { ...png, headers: {} },
    });
    const out = await details.run({
      urls: [
        'https://www.shop.example/kettle',
        'https://www.throws.example/p/1',
        'https://search.example/?q=kettle',
        'https://locked.example/p',
        'https://files.example/manual.pdf',
        'https://10.0.0.1/admin',
      ],
      compare: true,
    });
    if (typeof out === 'string') throw new Error('expected a view');
    const said = JSON.parse(out.text) as { products: Record<string, unknown>[]; note?: string };
    expect(said.products).toHaveLength(6);
    expect(said.products[0]).toMatchObject({
      found: true,
      price: '149.00 USD',
      was: '195.00 USD',
      rating: '4.6/5 from 1840',
    });
    expect(said.products[0]).not.toHaveProperty('missing');
    // The throw's photo address went nowhere: honest about it, and its rating.
    expect(said.products[1]).toMatchObject({ found: true, missing: ['rating', 'photo'] });
    expect(said.products[2]).toMatchObject({ found: false, problem: /No product details/ });
    expect(said.products[3]).toMatchObject({ found: false, problem: /403/ });
    expect(said.products[4]).toMatchObject({ found: false, problem: /download/ });
    expect(said.products[5]).toMatchObject({ found: false, problem: /Private network/ });
    expect(said.note).toMatch(/Do not repeat them/);

    // The view passes the same check every view does before it's logged.
    const view = cleanView(out.view);
    expect(view && ToolView.parse(view)).toBeTruthy();
    if (view?.kind !== 'products') throw new Error('expected products');
    expect(view.compare).toBe(true);
    expect(view.items).toHaveLength(2);
    const [kettle, throwItem] = view.items;
    expect(kettle?.picture).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 1 });
    expect(kettle?.pictures).toHaveLength(1);
    expect(await store.inConversation(kettle?.picture?.id ?? '', 'c1')).toBeDefined();
    expect(kettle?.url).toBe('https://www.shop.example/kettle');
    expect(throwItem?.picture).toBeUndefined();
    // Nothing in the view is a remote picture address.
    expect(JSON.stringify(view)).not.toMatch(/cdn\.shop\.example/);
  });

  it('refuses an address that isn’t a secure web page, and draws nothing when nothing was found', async () => {
    const { details, fetcher } = await tool({});
    const out = await details.run({ urls: ['http://shop.example/a'], compare: false });
    if (typeof out === 'string') throw new Error('expected a result');
    expect(out.view).toBeUndefined();
    expect(JSON.parse(out.text).products[0]).toMatchObject({ found: false, problem: /https/ });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
