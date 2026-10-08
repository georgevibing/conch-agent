import { ArrowUpRight, BookOpen, ChevronDown } from 'lucide-react';
import { VisuallyHidden } from 'radix-ui';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from 'react';

import { Heading } from '../../components/Text';
import { cx } from '../../utils/cx';
import styles from './Knowledge.module.css';
import { Picture } from './Picture';
import { outside, pictureShape, secureLink, type CardPicture } from './shared';

export interface KnowledgeFactItem {
  label: string;
  value: string;
}

export interface KnowledgeLinkItem {
  title: string;
  url: string;
}

export interface KnowledgeCardProps extends Omit<ComponentProps<'article'>, 'title'> {
  title: string;
  /** A few words of what it is, said first and quietly: "English mathematician". */
  description?: string;
  /** The article's opening, as plain text. */
  extract: string;
  picture?: CardPicture;
  /** Up to eight: Born, Died, Population, Founded… */
  facts?: readonly KnowledgeFactItem[];
  /** The article itself (https only; anything else isn't a link). */
  url: string;
  /** Where it's from: "Wikipedia". */
  source?: string;
  /** The source's own small picture (Conch's site icons), else a book. */
  sourceIcon?: string;
  /** Pages to read next. */
  related?: readonly KnowledgeLinkItem[];
  /** The language the words are in, for screen readers and hyphenation. */
  lang?: string;
  /** Lines of the extract shown before **Read more**. */
  lines?: number;
}

/**
 * A card about a person, place, thing or event, the way a good encyclopedia
 * would set it: what it is as a quiet kicker, the name in the editorial
 * serif, the opening that opens further with **Read more**, the key facts in
 * a tight list, and where it's from. The picture follows its own shape: a wide
 * one leads the card, a tall one stands beside the words; either drifts, very
 * slowly, unless motion is reduced. Everything is plain text from outside.
 */
export function KnowledgeCard({
  title,
  description,
  extract,
  picture,
  facts,
  url,
  source = 'Wikipedia',
  sourceIcon,
  related,
  lang,
  lines = 4,
  className,
  style,
  ...props
}: KnowledgeCardProps) {
  const shape = picture ? pictureShape(picture) : 'none';
  const href = secureLink(url);
  const links = (related ?? []).flatMap((r) => {
    const to = secureLink(r.url);
    return to ? [{ title: r.title, url: to }] : [];
  });
  const shownFacts = (facts ?? []).slice(0, 8);
  const titleId = useId();

  return (
    <article
      aria-labelledby={titleId}
      data-lustre=""
      data-shape={shape}
      className={cx(styles.card, styles.knowledge, className)}
      style={style}
      {...props}
    >
      {shape === 'landscape' && (
        <Picture
          picture={picture}
          className={styles.hero}
          fallback={<span className={styles.veil} />}
        />
      )}
      <div className={styles.knowledgeBody}>
        <div className={styles.knowledgeHead} lang={lang}>
          <Heading level={3} display id={titleId} className={styles.knowledgeTitle}>
            {title}
          </Heading>
          {/* Read after the name, shown above it. */}
          {description && <p className={styles.kicker}>{description}</p>}
        </div>
        {(shape === 'portrait' || shape === 'square') && (
          <Picture
            picture={picture}
            className={styles.portrait}
            fallback={<span className={styles.veil} />}
          />
        )}
        {extract && <Extract text={extract} lines={lines} lang={lang} />}
        {shownFacts.length > 0 && (
          <dl className={styles.facts} lang={lang}>
            {shownFacts.map((fact, i) => (
              <div key={`${fact.label}-${i}`} className={styles.fact}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {(href || links.length > 0) && (
          <footer className={styles.knowledgeFoot}>
            {href && (
              <a className={styles.sourceChip} href={href} {...outside} data-lustre="">
                {sourceIcon ? (
                  <img className={styles.sourceIcon} src={sourceIcon} alt="" />
                ) : (
                  <BookOpen aria-hidden className={styles.sourceIcon} />
                )}
                <span>
                  <VisuallyHidden.Root>Read on</VisuallyHidden.Root> {source}
                </span>
                <ArrowUpRight aria-hidden className={styles.chipArrow} />
              </a>
            )}
            {links.length > 0 && (
              <nav aria-label="See also" className={styles.related}>
                {links.map((link) => (
                  <a key={link.url} className={styles.relatedLink} href={link.url} {...outside}>
                    {link.title}
                  </a>
                ))}
              </nav>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}

/**
 * The opening, a few lines of it, then all of it: the height follows the
 * words on a soft spring, and a fade says there's more. **Read more** shows
 * only when there is more.
 */
function Extract({ text, lines, lang }: { text: string; lines: number; lang?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<number>();
  const [more, setMore] = useState(false);
  const id = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setFull(el.scrollHeight);
      // Folded, it's clipped: the words go further than the box.
      if (!el.dataset.open) setMore(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text]);

  return (
    <div className={styles.extractWrap}>
      <div
        ref={ref}
        id={id}
        lang={lang}
        className={styles.extract}
        data-open={open || undefined}
        data-more={more || undefined}
        style={
          {
            '--kn-lines': lines,
            ...(full !== undefined && { '--kn-full': `${full}px` }),
          } as CSSProperties
        }
      >
        {text.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      {more && (
        <button
          type="button"
          className={styles.readMore}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Show less' : 'Read more'}
          <ChevronDown aria-hidden data-open={open || undefined} />
        </button>
      )}
    </div>
  );
}
