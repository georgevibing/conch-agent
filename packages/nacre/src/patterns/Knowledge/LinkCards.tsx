import { ArrowUpRight, FolderGit2, Globe, Play, ShoppingBag } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Knowledge.module.css';
import { Picture } from './Picture';
import { hostOf, outside, secureLink, shortDate, type CardPicture } from './shared';

export type LinkCardKind = 'article' | 'video' | 'product' | 'repo' | 'other';

export interface LinkCardItem {
  url: string;
  title: string;
  /** The site's name, or its host. */
  site: string;
  description?: string;
  picture?: CardPicture;
  /** The site's own small picture (Conch's site icons). */
  icon?: string;
  /** When it was published (ISO). */
  published?: string;
  author?: string;
  kind?: LinkCardKind;
}

export interface LinkCardsProps extends ComponentProps<'section'> {
  links: readonly LinkCardItem[];
  /** For dates: the reader's locale. */
  locale?: string;
}

const KIND: Partial<Record<LinkCardKind, { word: string; icon: ReactNode }>> = {
  video: { word: 'Video', icon: <Play aria-hidden /> },
  repo: { word: 'Repository', icon: <FolderGit2 aria-hidden /> },
  product: { word: 'Product', icon: <ShoppingBag aria-hidden /> },
};

/**
 * Previews of the pages in a reply, as the pages describe themselves: one
 * link is a large card (its picture, the site, the title, a few lines of what
 * it says); several are compact rows in one card. Pressing anywhere opens the
 * page in a tab of its own; hover lifts it into the light. A link that isn't
 * a secure web address is shown, never opened.
 */
export function LinkCards({ links, locale, className, ...props }: LinkCardsProps) {
  const [first] = links;
  if (!first) return null;
  const one = links.length === 1;
  return (
    <section
      aria-label={one ? 'Link preview' : `Link previews, ${links.length} pages`}
      className={cx(styles.links, className)}
      data-count={one ? 'one' : 'many'}
      {...props}
    >
      {one ? (
        <LinkCard link={first} locale={locale} />
      ) : (
        <ul className={cx(styles.card, styles.linkList)}>
          {links.map((link, i) => (
            <li key={`${link.url}-${i}`}>
              <LinkRow link={link} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Pressable({
  href,
  className,
  children,
}: {
  href: string | undefined;
  className: string | undefined;
  children: ReactNode;
}) {
  return href ? (
    <a className={className} href={href} {...outside} data-lustre="">
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

function SiteLine({ link, locale }: { link: LinkCardItem; locale?: string }) {
  const kind = link.kind ? KIND[link.kind] : undefined;
  const date = shortDate(link.published, locale);
  return (
    <span className={styles.siteLine}>
      <span className={styles.siteIcon} aria-hidden>
        {link.icon ? <img src={link.icon} alt="" /> : <Globe />}
      </span>
      <span className={styles.siteName}>{link.site || hostOf(link.url)}</span>
      {kind && (
        <span className={styles.kindTag}>
          {kind.icon}
          {kind.word}
        </span>
      )}
      {date && (
        <time className={styles.siteMeta} dateTime={link.published}>
          {date}
        </time>
      )}
    </span>
  );
}

function Fallback({ link }: { link: LinkCardItem }) {
  return (
    <span className={styles.linkFallback}>
      {link.icon ? <img src={link.icon} alt="" /> : <Globe aria-hidden />}
    </span>
  );
}

function LinkCard({ link, locale }: { link: LinkCardItem; locale?: string }) {
  const href = secureLink(link.url);
  return (
    <Pressable href={href} className={cx(styles.card, styles.linkCard)}>
      {link.picture && (
        <span className={styles.linkHeroWrap}>
          <Picture
            picture={link.picture}
            className={styles.linkHero}
            fallback={<Fallback link={link} />}
          />
          {link.kind === 'video' && (
            <span className={styles.playBadge} aria-hidden>
              <Play />
            </span>
          )}
        </span>
      )}
      <span className={styles.linkText}>
        <SiteLine link={link} locale={locale} />
        <span className={styles.linkTitle}>{link.title}</span>
        {link.description && <span className={styles.linkDescription}>{link.description}</span>}
        {(link.author || !href) && (
          <span className={styles.linkByline}>
            {link.author && <span>{link.author}</span>}
            {!href && <span>Not a secure link, so it doesn’t open</span>}
          </span>
        )}
      </span>
      {href && <ArrowUpRight aria-hidden className={styles.linkArrow} />}
    </Pressable>
  );
}

function LinkRow({ link, locale }: { link: LinkCardItem; locale?: string }) {
  const href = secureLink(link.url);
  return (
    <Pressable href={href} className={styles.linkRow}>
      <span className={styles.linkText}>
        <SiteLine link={link} locale={locale} />
        <span className={styles.rowTitle}>{link.title}</span>
        {link.description && <span className={styles.rowDescription}>{link.description}</span>}
      </span>
      <span className={styles.thumbWrap}>
        <Picture
          picture={link.picture}
          className={styles.thumb}
          fallback={<Fallback link={link} />}
        />
        {link.kind === 'video' && link.picture && (
          <span className={styles.playBadge} data-size="sm" aria-hidden>
            <Play />
          </span>
        )}
      </span>
    </Pressable>
  );
}
