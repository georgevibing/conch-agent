import { Button, EmptyState } from '@conch/nacre';
import { Compass } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';

import styles from './NotFound.module.css';

/** An address with no page behind it: say so, and offer the way back. */
export function NotFound() {
  useEffect(() => {
    document.title = 'Not here · Conch';
  }, []);
  return (
    <main id="content" className={styles.center}>
      <EmptyState
        size="lg"
        headingLevel={2}
        icon={<Compass />}
        title="There’s no page here"
        description="It may have moved. Search finds every page by name."
        actions={
          <Button asChild>
            <Link to="/">Back to the start</Link>
          </Button>
        }
      />
    </main>
  );
}
