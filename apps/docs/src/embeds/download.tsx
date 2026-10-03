import type { OsName } from '@conch/nacre';
import { Button, OsMark, Text } from '@conch/nacre';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { DOWNLOADS } from '../site/config';
import styles from './embeds.module.css';

const NAMES: Record<OsName, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

/** The system this page is read on, from the browser: macOS when it can't tell. */
export function likelyOs(): OsName {
  if (typeof navigator === 'undefined') return 'macos';
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  if (/Win/i.test(platform)) return 'windows';
  if (/Linux|X11|CrOS/i.test(platform) && !/Android/i.test(platform)) return 'linux';
  return 'macos';
}

/** The app for this computer, one press away, and the other systems beside it. */
export function DownloadApp({ size = 'lg' }: { size?: 'md' | 'lg'; args?: string[] }) {
  const [os] = useState(likelyOs);
  const others = (Object.keys(NAMES) as OsName[]).filter((name) => name !== os);
  return (
    <div className={styles.download}>
      <Button size={size} leadingIcon={<Download />} asChild>
        <a href={DOWNLOADS} target="_blank" rel="noreferrer">
          Download for {NAMES[os]}
        </a>
      </Button>
      <Text as="p" size="sm" tone="muted" className={styles.downloadOthers}>
        <span className={styles.system}>
          <OsMark os={others[0] ?? 'linux'} />
          {NAMES[others[0] ?? 'linux']}
        </span>{' '}
        and{' '}
        <span className={styles.system}>
          <OsMark os={others[1] ?? 'windows'} />
          {NAMES[others[1] ?? 'windows']}
        </span>{' '}
        are on the same page.
      </Text>
    </div>
  );
}
