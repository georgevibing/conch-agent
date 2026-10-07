import { AppWindow, FileText, Globe, Image as ImageIcon, Type, User } from 'lucide-react';
import { useState } from 'react';

import styles from './Story.module.css';
import type { StoryChip } from './types';

const ICONS = {
  site: Globe,
  file: FileText,
  image: ImageIcon,
  person: User,
  app: AppWindow,
  text: Type,
} as const;

/** Only a web link opens, in a new tab: never a path or a script. */
export function webLink(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A chip's picture: its favicon or photo, or its kind's glyph when there's none (or it fails). */
function Face({ chip }: { chip: StoryChip }) {
  const [broken, setBroken] = useState(false);
  const Icon = ICONS[chip.kind];
  return (
    <span className={styles.face} data-kind={chip.kind}>
      {chip.image && !broken ? (
        <img
          src={chip.image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <Icon aria-hidden />
      )}
    </span>
  );
}

/** "amazon.de, zalando.de and 2 more": what the stack shows, in words. */
export function chipsSaid(chips: StoryChip[], max = 3): string {
  const names = chips.slice(0, max).map((c) => c.label);
  const more = chips.length - names.length;
  if (more > 0) return `${names.join(', ')} and ${more} more`;
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * What a story touched, as a small overlapping stack of faces — favicons,
 * files, pictures — up to three, then "+N". Decorative in the row: the
 * row's name says them.
 */
export function ChipStack({ chips, max = 3 }: { chips: StoryChip[]; max?: number }) {
  const shown = chips.slice(0, max);
  const more = chips.length - shown.length;
  return (
    <span className={styles.stack} aria-hidden>
      {shown.map((chip, i) => (
        <Face key={`${chip.kind}:${chip.label}:${i}`} chip={chip} />
      ))}
      {more > 0 && <span className={styles.more}>+{more}</span>}
    </span>
  );
}

/** The same things, opened: a row of small pills, the sites among them links. */
export function ChipList({ chips, label }: { chips: StoryChip[]; label: string }) {
  return (
    <ul className={styles.chipList} aria-label={label}>
      {chips.map((chip, i) => {
        const href = chip.kind === 'site' || chip.kind === 'image' ? webLink(chip.href) : undefined;
        const body = (
          <>
            <Face chip={chip} />
            <span className={styles.chipLabel}>{chip.label}</span>
          </>
        );
        return (
          <li key={`${chip.kind}:${chip.label}:${i}`}>
            {href ? (
              <a className={styles.chip} href={href} target="_blank" rel="noopener noreferrer">
                {body}
              </a>
            ) : (
              <span className={styles.chip} title={chip.href}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
