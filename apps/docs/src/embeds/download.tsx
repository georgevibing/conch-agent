import { Button, Callout } from '@conch/nacre';
import { Download, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { DOWNLOADS, HAS_DOWNLOAD } from '../site/config';
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
  if (!HAS_DOWNLOAD && !children)
    return (
      <Callout tone="neutral" title="Use the terminal installer for this version">
        Desktop downloads have not been published for this version. The command below installs
        Conch.
      </Callout>
    );
  return (
    <div className={styles.download}>
      <Button size={size} leadingIcon={HAS_DOWNLOAD ? <Download /> : <ArrowRight />} asChild>
        <a href={DOWNLOADS} target="_blank" rel="noreferrer">
          {HAS_DOWNLOAD ? 'Download Conch' : 'Install Conch'}
        </a>
      </Button>
      {children}
    </div>
  );
}
