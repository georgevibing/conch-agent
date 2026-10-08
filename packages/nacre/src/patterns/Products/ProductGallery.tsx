import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { PriceLine, shopLink, type ShelfProduct } from './ProductCard';
import styles from './Products.module.css';

export interface ProductGalleryProps {
  /** The product whose pictures are shown; nothing is open without it. */
  product?: ShelfProduct;
  /** Which picture. */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  locale?: string;
}

/** How far a finger must travel sideways to turn the picture. */
const SWIPE = 40;

/**
 * A product's pictures, large: ← and → (or a swipe) between them, the
 * thumbnails to jump, and the way to its shop.
 */
export function ProductGallery({
  product,
  index,
  onIndexChange,
  onClose,
  locale,
}: ProductGalleryProps) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const pictures = product?.pictures ?? [];
  const count = pictures.length;
  const at = Math.min(Math.max(0, index), Math.max(0, count - 1));
  const picture = pictures[at];
  const link = shopLink(product?.url);
  const go = (delta: number) => count > 1 && onIndexChange((at + delta + count) % count);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    }
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') start.current = { x: event.clientX, y: event.clientY };
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    start.current = null;
    if (!from) return;
    const dx = event.clientX - from.x;
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(event.clientY - from.y))
      go(dx < 0 ? 1 : -1);
  };

  return (
    <Dialog.Root
      open={product !== undefined && count > 0}
      onOpenChange={(open) => !open && onClose()}
    >
      <Dialog.Content
        size="lg"
        className={styles.gallery}
        onKeyDown={onKeyDown}
        // The picture is what's being looked at: the focus waits on the dialog, not a button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <Dialog.Header>
          <Dialog.Title>{product?.title}</Dialog.Title>
          <Dialog.Description>
            {count > 1 ? `Picture ${at + 1} of ${count}` : 'Picture'}
            {product?.store ? ` · ${product.store}` : ''}
          </Dialog.Description>
        </Dialog.Header>
        <div
          className={styles.galleryStage}
          onPointerDown={down}
          onPointerUp={up}
          onPointerCancel={() => (start.current = null)}
        >
          {picture && (
            <img
              key={at}
              className={styles.galleryPhoto}
              src={picture.src}
              alt={count > 1 ? `${product?.title}, picture ${at + 1}` : (product?.title ?? '')}
              width={picture.width}
              height={picture.height}
              draggable={false}
            />
          )}
          {count > 1 && (
            <>
              <IconButton
                label="Previous picture"
                shape="circle"
                variant="surface"
                className={styles.galleryPrev}
                onClick={() => go(-1)}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                label="Next picture"
                shape="circle"
                variant="surface"
                className={styles.galleryNext}
                onClick={() => go(1)}
              >
                <ChevronRight />
              </IconButton>
            </>
          )}
        </div>
        <div className={styles.galleryFoot}>
          {count > 1 ? (
            <div className={styles.thumbs} role="group" aria-label="Pictures">
              {pictures.map((p, i) => (
                <button
                  key={`${p.src}-${i}`}
                  type="button"
                  className={styles.thumb}
                  aria-label={`Picture ${i + 1}`}
                  aria-current={i === at || undefined}
                  onClick={() => onIndexChange(i)}
                >
                  <img src={p.src} alt="" draggable={false} />
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          <div className={styles.galleryBuy}>
            {product?.price && (
              <PriceLine price={product.price} was={product.was} locale={locale} />
            )}
            {link && (
              <Button asChild variant="solid" size="sm" trailingIcon={<ArrowUpRight />}>
                <a href={link} target="_blank" rel="noopener noreferrer">
                  Open in {product?.store ?? 'the shop'}
                </a>
              </Button>
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
