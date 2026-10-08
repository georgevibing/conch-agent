import { describe, expect, it } from 'vitest';

import { ToolView } from '../chat-cards';
import { ProductItem, ProductsView } from './products';

const picture = {
  id: 'att_photo',
  name: 'Kettle.jpg',
  mimeType: 'image/jpeg',
  size: 1200,
  kind: 'image' as const,
  width: 800,
  height: 800,
  createdAt: 1,
};

describe('products view', () => {
  it('is one of the tool views, with its photo as the chat’s own attachment', () => {
    const view = ToolView.parse({
      kind: 'products',
      compare: true,
      items: [
        {
          title: 'Stagg EKG kettle',
          url: 'https://shop.example/stagg',
          picture,
          price: { amount: 149, currency: 'USD' },
          was: { amount: 195, currency: 'USD' },
          rating: { value: 4.6, count: 1840 },
          store: 'Example Shop',
          availability: 'in_stock',
          highlights: ['0.9 litres', 'Holds a temperature'],
        },
      ],
    });
    expect(view.kind).toBe('products');
  });

  it('refuses what could leave the chat another way', () => {
    expect(ProductItem.safeParse({ title: 'A', url: 'http://shop.example/a' }).success).toBe(false);
    expect(ProductItem.safeParse({ title: 'A', url: 'javascript:alert(1)' }).success).toBe(false);
    // A picture is an attachment, never an address.
    expect(
      ProductItem.safeParse({ title: 'A', picture: 'https://cdn.example/a.jpg' }).success,
    ).toBe(false);
    expect(
      ProductItem.safeParse({ title: 'A', price: { amount: 3, currency: 'dollars' } }).success,
    ).toBe(false);
    expect(ProductItem.safeParse({ title: 'A', rating: { value: 7 } }).success).toBe(false);
  });

  it('holds one to twelve products', () => {
    expect(ProductsView.safeParse({ kind: 'products', items: [] }).success).toBe(false);
    const many = Array.from({ length: 13 }, (_, i) => ({ title: `P${i}` }));
    expect(ProductsView.safeParse({ kind: 'products', items: many }).success).toBe(false);
    expect(ProductsView.safeParse({ kind: 'products', items: many.slice(0, 12) }).success).toBe(
      true,
    );
  });
});
