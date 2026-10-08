import { describe, expect, it } from 'vitest';

import { findLd, isoDuration, ldImage, pageData, plain } from './pageData';

describe('page data', () => {
  it('reads JSON-LD graphs, card tags and the title, and skips broken blocks', () => {
    const html = `<html><head><title>Kettle &amp; co</title>
      <meta property="og:image" content="https://shop.example/k.jpg">
      <meta name="twitter:title" content='A "kettle"'>
      <script type="application/ld+json">{ broken</script>
      <script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Product"],"name":"Kettle","image":[{"url":"/img/k.png"}]}]}</script>
    </head></html>`;
    const data = pageData(html);
    expect(data.title).toBe('Kettle & co');
    expect(data.meta['og:image']).toBe('https://shop.example/k.jpg');
    expect(data.meta['twitter:title']).toBe('A "kettle"');
    const product = findLd(data, 'product');
    expect(product?.name).toBe('Kettle');
    expect(ldImage(product?.image, 'https://shop.example/p/1')).toBe(
      'https://shop.example/img/k.png',
    );
  });
  it('keeps only https pictures, plain text and real durations', () => {
    expect(ldImage('http://shop.example/k.jpg', 'https://shop.example')).toBeUndefined();
    expect(ldImage('javascript:alert(1)', 'https://shop.example')).toBeUndefined();
    expect(ldImage('', 'https://shop.example/p/1')).toBeUndefined();
    expect(plain('<b>Big</b>\n  kettle &#x2014; 2l')).toBe('Big kettle — 2l');
    expect(isoDuration('PT1H20M')).toBe(4800);
    expect(isoDuration('P')).toBeUndefined();
    expect(isoDuration('soon')).toBeUndefined();
  });
});
