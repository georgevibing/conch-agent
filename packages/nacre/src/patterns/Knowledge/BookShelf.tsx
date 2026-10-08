import { ArrowUpRight, Star } from 'lucide-react';
import { Toolbar, VisuallyHidden } from 'radix-ui';
import { useState, type ComponentProps, type CSSProperties } from 'react';

import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import styles from './Knowledge.module.css';
import { Picture } from './Picture';
import { useScrollEdges } from './useScrollEdges';
import { outside, secureLink, tintOf, type CardPicture } from './shared';

export interface ShelfBook {
  title: string;
  authors: readonly string[];
  year?: number;
  cover?: CardPicture;
  pages?: number;
  subjects?: readonly string[];
  /** The book's page at its library (https only). */
  url: string;
  /** Readers' average, out of 5. */
  rating?: number;
  ratings?: number;
}

export interface BookShelfProps extends ComponentProps<'section'> {
  books: readonly ShelfBook[];
  /** Where the books are from, for the link out: "Open Library". */
  source?: string;
  locale?: string;
}

const byline = (book: ShelfBook) => book.authors.slice(0, 2).join(', ');

/** "Tehanu, by Ursula K. Le Guin, 1990": what a book's button is called. */
const bookName = (book: ShelfBook) =>
  [book.title, book.authors.length ? `by ${byline(book)}` : '', book.year ? String(book.year) : '']
    .filter(Boolean)
    .join(', ');

/**
 * Books found, standing on a shelf: each cover at its own shape, on a plank
 * with a soft shadow under it. Hover or focus pulls a book forward on a
 * spring and names it under the shelf; pressing it opens its details (who
 * wrote it, when, how long, what readers thought, what it's about) and a link
 * to its page. Arrow keys move along the shelf; one tab stop for the lot. A
 * book without a cover gets one drawn from its title. A single book is shown
 * open beside its details instead.
 */
export function BookShelf({
  books,
  source = 'Open Library',
  locale,
  className,
  ...props
}: BookShelfProps) {
  const [active, setActive] = useState(0);
  const [shelfRef, edges] = useScrollEdges<HTMLDivElement>();
  const [first] = books;
  if (!first) return null;
  const label = books.length === 1 ? 'Book' : `Books, ${books.length} found`;

  if (books.length === 1) {
    const book = first;
    return (
      <section aria-label={label} className={cx(styles.card, styles.bookOne, className)} {...props}>
        <span className={styles.bookOneCover}>
          <Cover book={book} />
        </span>
        <BookDetails book={book} source={source} locale={locale} />
      </section>
    );
  }

  const current = books[active] ?? first;
  return (
    <section aria-label={label} className={cx(styles.shelfView, className)} {...props}>
      <Toolbar.Root
        ref={shelfRef}
        {...edges}
        aria-label="Books"
        orientation="horizontal"
        className={styles.shelf}
      >
        {books.map((book, i) => (
          <Popover.Root key={`${book.url}-${i}`}>
            <Popover.Trigger asChild>
              <Toolbar.Button
                className={styles.book}
                aria-label={bookName(book)}
                data-lustre=""
                style={{ '--bk-ratio': ratioOf(book.cover) } as CSSProperties}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
              >
                <Cover book={book} />
              </Toolbar.Button>
            </Popover.Trigger>
            <Popover.Content
              side="top"
              align="center"
              padding="md"
              className={styles.bookPopover}
              aria-label={book.title}
            >
              <BookDetails book={book} source={source} locale={locale} compact />
            </Popover.Content>
          </Popover.Root>
        ))}
      </Toolbar.Root>
      <div className={styles.plank} aria-hidden />
      <p className={styles.shelfCaption} aria-hidden>
        <span className={styles.shelfCaptionTitle}>{current.title}</span>
        {current.authors.length > 0 && <span> · {byline(current)}</span>}
        {current.year !== undefined && <span> · {current.year}</span>}
      </p>
    </section>
  );
}

/** A cover's width over its height: the picture's own, else a book's usual 2 : 3. */
function ratioOf(cover: CardPicture | undefined): number {
  if (cover?.width && cover.height)
    return Math.min(0.85, Math.max(0.55, cover.width / cover.height));
  return 2 / 3;
}

function Cover({ book }: { book: ShelfBook }) {
  return (
    <span className={styles.cover}>
      <Picture
        picture={book.cover}
        className={styles.coverPicture}
        fallback={
          <span
            className={styles.drawnCover}
            style={{ '--bk-tint': tintOf(book.title) } as CSSProperties}
          >
            <span className={styles.drawnTitle}>{book.title}</span>
            {book.authors[0] && <span className={styles.drawnAuthor}>{book.authors[0]}</span>}
          </span>
        }
      />
      <span className={styles.spine} aria-hidden />
    </span>
  );
}

function BookDetails({
  book,
  source,
  locale,
  compact,
}: {
  book: ShelfBook;
  source: string;
  locale?: string;
  compact?: boolean;
}) {
  const href = secureLink(book.url);
  const number = new Intl.NumberFormat(locale);
  const facts = [
    book.year !== undefined && String(book.year),
    book.pages && `${number.format(book.pages)} pages`,
  ].filter(Boolean);
  return (
    <div className={styles.bookDetails} data-compact={compact || undefined}>
      <p className={styles.bookTitle}>{book.title}</p>
      {book.authors.length > 0 && <p className={styles.bookBy}>{byline(book)}</p>}
      {(facts.length > 0 || book.rating !== undefined) && (
        <p className={styles.bookMeta}>
          {facts.join(' · ')}
          {book.rating !== undefined && (
            <span className={styles.rating}>
              {facts.length > 0 && <span aria-hidden> · </span>}
              <Star aria-hidden />
              <span>
                {book.rating.toFixed(1)}
                <VisuallyHidden.Root> out of 5</VisuallyHidden.Root>
              </span>
              {book.ratings ? (
                <span className={styles.ratingCount}>
                  ({number.format(book.ratings)} {book.ratings === 1 ? 'rating' : 'ratings'})
                </span>
              ) : null}
            </span>
          )}
        </p>
      )}
      {book.subjects && book.subjects.length > 0 && (
        <ul className={styles.subjects} aria-label="Subjects">
          {book.subjects.slice(0, 4).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {href && (
        <a className={styles.sourceChip} href={href} {...outside} data-lustre="">
          <span>
            <VisuallyHidden.Root>Open on</VisuallyHidden.Root> {source}
          </span>
          <ArrowUpRight aria-hidden className={styles.chipArrow} />
        </a>
      )}
    </div>
  );
}
