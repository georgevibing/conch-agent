import type { Attachment, ProductsView } from '@conch/protocol';
import { askRequest, ProductShelf, type ShelfProduct } from '@conch/nacre';

import { attachmentUrl } from './uploads';

/** A photo the gateway fetched and kept as the chat's own attachment, served by Conch. */
const picture = (a: Attachment) => ({ src: attachmentUrl(a.id), width: a.width, height: a.height });

/** A product as the shelf draws it: its photos from Conch, never from the shop. */
export function shelfProduct(item: ProductsView['items'][number]): ShelfProduct {
  const { picture: main, pictures = [], ...rest } = item;
  const photos = [main, ...pictures].filter((a): a is Attachment => a?.kind === 'image');
  return { ...rest, ...(photos.length && { pictures: photos.map(picture) }) };
}

/**
 * What `product_details` found, as a shelf of product cards (ADR 0060 §7).
 * **Ask about this** fills the composer; nothing is sent by itself.
 */
export function ShopShelf({ view, onAsk }: { view: ProductsView; onAsk: (text: string) => void }) {
  return (
    <ProductShelf
      products={view.items.map(shelfProduct)}
      compare={view.compare}
      onAsk={(product) => onAsk(askRequest(product))}
    />
  );
}
