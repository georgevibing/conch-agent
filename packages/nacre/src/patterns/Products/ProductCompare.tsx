import { Check, ShoppingBag, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../../components/Button';
import { bestOf } from './format';
import { Availability, PriceLine, Stars, type ShelfProduct } from './ProductCard';
import styles from './Products.module.css';

export interface ProductCompareProps {
  products: ShelfProduct[];
  locale?: string;
  onClear: () => void;
}

/** The quiet mark on the best of a row, in words as well as light. */
function Best({ children }: { children: ReactNode }) {
  return (
    <span className={styles.best}>
      <Sparkles aria-hidden />
      {children}
    </span>
  );
}

/**
 * Two or three products side by side: price, rating, availability, shop and
 * highlights, each row's best marked and said ("Lowest", "Top rated").
 */
export function ProductCompare({ products, locale, onClear }: ProductCompareProps) {
  const best = bestOf(products);
  const cell = (i: number, row: keyof typeof best) =>
    best[row] === i ? { 'data-best': '' } : undefined;
  return (
    <section className={styles.compare} aria-label={`Comparing ${products.length} products`}>
      <div className={styles.compareHead}>
        <span className={styles.compareTitle}>Side by side</span>
        <Button variant="ghost" size="sm" tone="neutral" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div
        className={styles.compareScroll}
        // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label="Comparison table"
      >
        <table className={styles.table} style={{ ['--ps-cols' as string]: products.length }}>
          <thead>
            <tr>
              <td />
              {products.map((p, i) => (
                <th key={i} scope="col">
                  <span className={styles.compareProduct}>
                    <span className={styles.compareThumb} aria-hidden>
                      {p.pictures?.[0] ? (
                        <img src={p.pictures[0].src} alt="" draggable={false} />
                      ) : (
                        <ShoppingBag />
                      )}
                    </span>
                    <span className={styles.compareName}>{p.title}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Price</th>
              {products.map((p, i) => (
                <td key={i} {...cell(i, 'price')}>
                  <PriceLine price={p.price} was={p.was} locale={locale} size="sm" />
                  {best.price === i && <Best>Lowest</Best>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Rating</th>
              {products.map((p, i) => (
                <td key={i} {...cell(i, 'rating')}>
                  {p.rating ? (
                    <Stars rating={p.rating} locale={locale} />
                  ) : (
                    <span className={styles.none}>No rating</span>
                  )}
                  {best.rating === i && <Best>Top rated</Best>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Availability</th>
              {products.map((p, i) => (
                <td key={i} {...cell(i, 'availability')}>
                  <Availability value={p.availability ?? 'unknown'} />
                  {best.availability === i && <Best>Easiest to get</Best>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Shop</th>
              {products.map((p, i) => (
                <td key={i}>{p.store ?? <span className={styles.none}>Not said</span>}</td>
              ))}
            </tr>
            {products.some((p) => p.highlights?.length) && (
              <tr>
                <th scope="row">Highlights</th>
                {products.map((p, i) => (
                  <td key={i}>
                    {p.highlights?.length ? (
                      <ul className={styles.compareFacts}>
                        {p.highlights.map((h) => (
                          <li key={h}>
                            <Check aria-hidden />
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className={styles.none}>None listed</span>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
