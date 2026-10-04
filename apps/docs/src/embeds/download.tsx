import { Button } from '@conch/nacre';
import { Download } from 'lucide-react';
import type { ReactNode } from 'react';

import { DOWNLOADS } from '../site/config';
import styles from './embeds.module.css';

/**
 * The app, one press away. One button for every system: the release page has
 * the file for each, so there's nothing to choose here. What's beside it (a
 * second button) sits in the same row.
 */
export function DownloadApp({
  size = 'lg',
  children,
}: {
  size?: 'md' | 'lg';
  children?: ReactNode;
  args?: string[];
}) {
  return (
    <div className={styles.download}>
      <Button size={size} leadingIcon={<Download />} asChild>
        <a href={DOWNLOADS} target="_blank" rel="noreferrer">
          Download Conch
        </a>
      </Button>
      {children}
    </div>
  );
}
