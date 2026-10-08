import { ArrowUpRight, Check, Heart, Images, MessageCircle, ShoppingBag } from 'lucide-react';
import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Tooltip } from '../../components/Tooltip';
import {
  AVAILABILITY_WORDS,
  discountOf,
  formatPrice,
  ratingWords,
  shortCount,
  starFills,
  type ShelfAvailability,
  type ShelfPrice,
} from './format';
import styles from './Products.module.css';

/** A picture of a product, served by Conch itself (never a remote address). */
export interface ShelfPicture {
  src: string;
  /** Its own size, so the card holds its shape before it loads. */
  width?: number;
  height?: number;
}

/** One product, as a tool found it. Mirrors `ProductItem` in `@conch/protocol`. */
export interface ShelfProduct {
  title: string;
  /** Its page in the shop: only `https` links are drawn. */
  url?: string;
  /** Its photos, the main one first. */
  pictures?: ShelfPicture[];
  price?: ShelfPrice;
  was?: ShelfPrice;
  rating?: { value: number; count?: number };
  store?: string;
  brand?: string;
  availability?: ShelfAvailability;
  highlights?: string[];
  description?: string;
}

/** Only secure web links leave the chat. */
export const shopLink = (url: string | undefined) =>
  url && /^https:\/\//i.test(url) ? url : undefined;

/** Five stars filled to the nearest half, with the number beside them; read aloud as words. */
export function Stars({
  rating,
  locale,
}: {
  rating: { value: number; count?: number };
  locale?: string;
}) {
  return (
    <span className={styles.rating} role="img" aria-label={ratingWords(rating, locale)}>
      <span className={styles.stars} aria-hidden>
        {starFills(rating.value).map((fill, i) => (
          <span
            key={i}
            className={styles.star}
            data-fill={fill === 1 ? 'full' : fill === 0.5 ? 'half' : 'none'}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" />
            </svg>
          </span>
        ))}
      </span>
      <span className={styles.ratingValue} aria-hidden>
        {new Intl.NumberFormat(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(rating.value)}
      </span>
      {rating.count !== undefined && (
        <span className={styles.ratingCount} aria-hidden>
          ({shortCount(rating.count, locale)})
        </span>
      )}
    </span>
  );
}

/** A calm dot and the word: never the colour alone. */
export function Availability({ value }: { value: ShelfAvailability }) {
  return (
    <span className={styles.availability} data-availability={value}>
      <span className={styles.dot} aria-hidden />
      {AVAILABILITY_WORDS[value]}
    </span>
  );
}

/** The price large, the one before struck through, and the reduction said in words. */
export function PriceLine({
  price,
  was,
  locale,
  size = 'md',
}: {
  price?: ShelfPrice;
  was?: ShelfPrice;
  locale?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!price) return <span className={styles.noPrice}>No price on the page</span>;
  const off = discountOf(price, was);
  return (
    <span className={styles.priceLine} data-size={size}>
      <span className={styles.price}>{formatPrice(price, locale)}</span>
      {off !== undefined && was && (
        <>
          <s className={styles.was}>
            <span className="nc-visually-hidden">was </span>
            {formatPrice(was, locale)}
          </s>
          <span className="nc-visually-hidden">, {off}% off</span>
        </>
      )}
    </span>
  );
}

export interface ProductCardProps {
  product: ShelfProduct;
  index: number;
  /** `hero`: one product, laid out wide with its highlights. */
  layout: 'hero' | 'tall';
  locale?: string;
  shortlisted: boolean;
  onShortlist: () => void;
  onOpenPicture: (picture: number) => void;
  onAsk?: () => void;
  /** Compare mode: the card can be picked. */
  comparing: boolean;
  picked: boolean;
  /** No more can be picked (three already are). */
  pickFull: boolean;
  onPick: (picked: boolean) => void;
}

/** How far the photo leans toward the pointer, at most (degrees, each way). */
const TILT = 1;

/**
 * One product on the shelf: its photo on a porcelain stage (leaning a little
 * toward the pointer), its shop, its name, stars, price and availability, and
 * what to do next.
 */
export function ProductCard({
  product,
  index,
  layout,
  locale,
  shortlisted,
  onShortlist,
  onOpenPicture,
  onAsk,
  comparing,
  picked,
  pickFull,
  onPick,
}: ProductCardProps) {
  const titleId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const [popping, setPopping] = useState(false);
  const pictures = product.pictures ?? [];
  const photo = pictures[0];
  const off = discountOf(product.price, product.was);
  const link = shopLink(product.url);
  const from = [product.brand, product.store].filter(Boolean).join(' · ');
  const shop = product.store ?? 'the shop';
  const hero = layout === 'hero';

  // The photo leans toward a mouse; a finger or reduced motion leaves it still (CSS).
  const lean = (event: PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el || event.pointerType !== 'mouse') return;
    const box = el.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 2 - 1;
    const y = ((event.clientY - box.top) / box.height) * 2 - 1;
    el.style.setProperty('--ps-lean-x', (Math.max(-1, Math.min(1, x)) * TILT).toFixed(3));
    el.style.setProperty('--ps-lean-y', (Math.max(-1, Math.min(1, y)) * TILT).toFixed(3));
    el.dataset.leaning = '';
  };
  const rest = () => {
    const el = stage.current;
    if (!el) return;
    el.style.setProperty('--ps-lean-x', '0');
    el.style.setProperty('--ps-lean-y', '0');
    delete el.dataset.leaning;
  };

  const ratio = photo?.width && photo.height ? photo.width / photo.height : undefined;

  return (
    <article
      className={styles.card}
      data-layout={layout}
      data-lustre=""
      data-out={product.availability === 'out_of_stock' || undefined}
      data-picked={picked || undefined}
      aria-labelledby={titleId}
      style={{ '--ps-i': index } as CSSProperties}
    >
      <div
        ref={stage}
        className={styles.stage}
        onPointerMove={lean}
        onPointerLeave={rest}
        style={ratio ? ({ '--ps-photo-ratio': ratio } as CSSProperties) : undefined}
      >
        {photo ? (
          <button
            type="button"
            className={styles.photoButton}
            data-card-focus=""
            aria-label={`Look closer at ${product.title}${pictures.length > 1 ? `, ${pictures.length} pictures` : ''}`}
            onClick={() => onOpenPicture(0)}
          >
            <img
              className={styles.photo}
              src={photo.src}
              alt=""
              width={photo.width}
              height={photo.height}
              draggable={false}
              decoding="async"
            />
          </button>
        ) : (
          <span className={styles.noPhoto} aria-hidden>
            <ShoppingBag />
          </span>
        )}
        <span className={styles.floor} aria-hidden />
        {off !== undefined && (
          <span className={styles.discount} aria-hidden>
            −{off}%
          </span>
        )}
        {pictures.length > 1 && (
          <span className={styles.photoCount} aria-hidden>
            <Images />
            {pictures.length}
          </span>
        )}
        <Tooltip content={shortlisted ? 'On your shortlist' : 'Add to your shortlist'}>
          <button
            type="button"
            className={styles.heart}
            aria-pressed={shortlisted}
            aria-label={`Shortlist ${product.title}`}
            data-popping={popping || undefined}
            data-card-focus={photo ? undefined : ''}
            onClick={() => {
              // Only a person's press plays the pop.
              if (!shortlisted) setPopping(true);
              onShortlist();
            }}
            onAnimationEnd={() => setPopping(false)}
          >
            <Heart aria-hidden />
          </button>
        </Tooltip>
      </div>

      <div className={styles.body}>
        {from && <p className={styles.from}>{from}</p>}
        <h3 id={titleId} className={styles.title} title={product.title}>
          {product.title}
        </h3>
        {product.rating && <Stars rating={product.rating} locale={locale} />}
        <PriceLine
          price={product.price}
          was={product.was}
          locale={locale}
          size={hero ? 'lg' : 'md'}
        />
        {product.availability && product.availability !== 'unknown' && (
          <Availability value={product.availability} />
        )}
        {hero && product.highlights?.length ? (
          <ul className={styles.highlights}>
            {product.highlights.map((h) => (
              <li key={h}>
                <Check aria-hidden />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {hero && product.description && <p className={styles.description}>{product.description}</p>}
      </div>

      <div className={styles.actions}>
        {comparing ? (
          <Checkbox
            size="sm"
            className={styles.pick}
            label="Compare"
            checked={picked}
            disabled={!picked && pickFull}
            onCheckedChange={(checked) => onPick(checked === true)}
            aria-label={`Compare ${product.title}`}
          />
        ) : (
          onAsk && (
            <Button
              variant="soft"
              tone="neutral"
              size="sm"
              leadingIcon={<MessageCircle />}
              onClick={onAsk}
              aria-label={`Ask about ${product.title}`}
            >
              Ask about this
            </Button>
          )
        )}
        {link &&
          (hero ? (
            <Button
              asChild
              variant="ghost"
              tone="neutral"
              size="sm"
              trailingIcon={<ArrowUpRight />}
              className={styles.openText}
            >
              <a href={link} target="_blank" rel="noopener noreferrer">
                Open in {shop}
              </a>
            </Button>
          ) : (
            <Tooltip content={`Open in ${shop}`}>
              <Button
                asChild
                variant="ghost"
                tone="neutral"
                size="sm"
                leadingIcon={<ArrowUpRight />}
                className={styles.open}
              >
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${product.title} in ${shop}`}
                />
              </Button>
            </Tooltip>
          ))}
      </div>
    </article>
  );
}
