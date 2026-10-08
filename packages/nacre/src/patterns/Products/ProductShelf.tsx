import { ChevronLeft, ChevronRight, Columns3, Heart } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { trackScrollEdges } from '../../utils/scrollEdges';
import { ProductCard, type ShelfProduct } from './ProductCard';
import { ProductCompare } from './ProductCompare';
import { ProductGallery } from './ProductGallery';
import { useShortlist } from './shortlist';
import styles from './Products.module.css';

/** The most products side by side. */
export const COMPARE_MOST = 3;

export interface ProductShelfProps extends Omit<ComponentProps<'section'>, 'children'> {
  products: ShelfProduct[];
  /** The person is choosing between these: open with the first few side by side. */
  compare?: boolean;
  /** "Ask about this": words for the composer, never sent by themselves. */
  onAsk?: (product: ShelfProduct) => void;
  /** Cards rise in one after another (a reply arriving); history is drawn still. */
  arriving?: boolean;
  /** For prices and numbers; the person's own by default. */
  locale?: string;
}

/** The words **Ask about this** puts in the composer: the person finishes the question. */
export function askRequest(product: Pick<ShelfProduct, 'title' | 'store'>): string {
  return `About the “${product.title}”${product.store ? ` from ${product.store}` : ''}: `;
}

/** What remembers a heart: the shop's page, or the name and shop when there's no page. */
const keyOf = (p: ShelfProduct) => p.url ?? `${p.title}\u0000${p.store ?? ''}`;

/**
 * Products a tool found, on a shelf: one is a wide hero card, two or three
 * stand side by side, more scroll sideways, snapping card by card, with
 * buttons on the edges where there's a pointer and a fade where there's more.
 * Each card's photo opens its gallery; a heart keeps it on the shortlist for
 * the session; **Compare** picks two or three for a table, the best of each
 * row marked in words. Arrow keys move between cards.
 */
export function ProductShelf({
  products,
  compare = false,
  onAsk,
  arriving = true,
  locale,
  className,
  ...props
}: ProductShelfProps) {
  const n = products.length;
  const layout = n === 1 ? 'hero' : n <= COMPARE_MOST ? 'few' : 'shelf';
  const keys = products.map(keyOf);
  const shortlist = useShortlist(keys);
  const canCompare = n > 1;
  const [comparing, setComparing] = useState(compare && canCompare);
  const [picked, setPicked] = useState<number[]>(() =>
    compare && canCompare ? products.slice(0, COMPARE_MOST).map((_, i) => i) : [],
  );
  const [gallery, setGallery] = useState<{ product: number; picture: number }>();
  const track = useRef<HTMLUListElement>(null);

  // Which edges have more beyond them: the fades and the scroll buttons follow.
  useEffect(() => {
    const el = track.current;
    return el ? trackScrollEdges(el) : undefined;
  }, []);

  // ← → Home End move between cards, to the same kind of control on the next one.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onKey = (event: KeyboardEvent) => {
      const moves: Record<string, number | 'first' | 'last'> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        Home: 'first',
        End: 'last',
      };
      const move = moves[event.key];
      if (move === undefined || event.altKey || event.metaKey || event.ctrlKey) return;
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-shelf-item]');
      if (!item) return;
      const items = [...el.querySelectorAll<HTMLElement>('[data-shelf-item]')];
      const at = items.indexOf(item);
      const next =
        move === 'first'
          ? 0
          : move === 'last'
            ? items.length - 1
            : Math.max(0, Math.min(items.length - 1, at + move));
      if (next === at) return;
      event.preventDefault();
      const focus = items[next]?.querySelector<HTMLElement>('[data-card-focus]');
      focus?.focus();
      focus?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  const scroll = (direction: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    const reduced =
      el.closest('[data-nacre-motion="reduced"]') !== null ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
  };

  const pick = (i: number, on: boolean) =>
    setPicked((now) =>
      on
        ? now.includes(i) || now.length >= COMPARE_MOST
          ? now
          : [...now, i].sort((a, b) => a - b)
        : now.filter((j) => j !== i),
    );
  const side = picked.flatMap((i) => (products[i] ? [products[i]] : []));

  return (
    <section
      aria-label={`Products, ${n}`}
      className={cx(styles.shelf, className)}
      data-layout={layout}
      data-arriving={arriving || undefined}
      data-comparing={comparing || undefined}
      {...props}
    >
      {(canCompare || shortlist.count > 0) && (
        <div className={styles.head}>
          <span className={styles.count}>
            {n} products
            {shortlist.count > 0 && (
              <span className={styles.hearted}>
                <Heart aria-hidden />
                {shortlist.count} shortlisted
              </span>
            )}
          </span>
          {canCompare && (
            <Button
              variant={comparing ? 'soft' : 'ghost'}
              tone={comparing ? 'accent' : 'neutral'}
              size="sm"
              leadingIcon={<Columns3 />}
              aria-pressed={comparing}
              onClick={() => setComparing((c) => !c)}
            >
              Compare
            </Button>
          )}
        </div>
      )}

      <div className={styles.viewport}>
        <ul ref={track} className={styles.track} data-layout={layout}>
          {products.map((product, i) => (
            <li key={`${keys[i]}-${i}`} className={styles.item} data-shelf-item="">
              <ProductCard
                product={product}
                index={i}
                layout={layout === 'hero' ? 'hero' : 'tall'}
                locale={locale}
                shortlisted={shortlist.has(keys[i] ?? '')}
                onShortlist={() => shortlist.toggle(keys[i] ?? '')}
                onOpenPicture={(picture) => setGallery({ product: i, picture })}
                onAsk={onAsk && (() => onAsk(product))}
                comparing={comparing}
                picked={picked.includes(i)}
                pickFull={picked.length >= COMPARE_MOST}
                onPick={(on) => pick(i, on)}
              />
            </li>
          ))}
        </ul>
        {layout === 'shelf' && (
          <>
            <IconButton
              label="Scroll back"
              tooltip={false}
              shape="circle"
              variant="surface"
              size="sm"
              tabIndex={-1}
              aria-hidden
              className={styles.scrollBack}
              onClick={() => scroll(-1)}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              label="Scroll on"
              tooltip={false}
              shape="circle"
              variant="surface"
              size="sm"
              tabIndex={-1}
              aria-hidden
              className={styles.scrollOn}
              onClick={() => scroll(1)}
            >
              <ChevronRight />
            </IconButton>
          </>
        )}
      </div>

      {comparing && (
        <p className={styles.compareHint} aria-live="polite">
          {side.length < 2
            ? 'Pick two or three to see them side by side.'
            : side.length >= COMPARE_MOST
              ? `Comparing ${side.length}, the most at once.`
              : `Comparing ${side.length}.`}
        </p>
      )}
      {comparing && side.length >= 2 && (
        <ProductCompare products={side} locale={locale} onClear={() => setPicked([])} />
      )}

      <ProductGallery
        product={gallery ? products[gallery.product] : undefined}
        index={gallery?.picture ?? 0}
        onIndexChange={(picture) => setGallery((g) => g && { ...g, picture })}
        onClose={() => setGallery(undefined)}
        locale={locale}
      />
    </section>
  );
}
