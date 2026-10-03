import { cx } from '../../utils/cx';
import { Stack, type StackProps } from '../Stack';
import styles from './Page.module.css';

export type PageProps = Omit<StackProps, 'direction' | 'asChild' | 'inline'>;

/**
 * A page of the app (Apps, Routines, Tasks…): one centred column at
 * `--nc-page-width`, in a pane that scrolls from edge to edge. Fill the space
 * it's given (a flex column); props go to the column, a vertical `Stack`.
 */
export function Page({ gap = 6, className, ...props }: PageProps) {
  return (
    <div className={styles.scroller}>
      <Stack gap={gap} className={cx(styles.column, className)} {...props} />
    </div>
  );
}
