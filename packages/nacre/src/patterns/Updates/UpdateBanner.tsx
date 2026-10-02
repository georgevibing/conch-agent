import { Sparkles, X } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Releases.module.css';

export interface UpdateBannerProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** "Conch 0.3 is ready" */
  title: ReactNode;
  onWhatsNew?: () => void;
  onUpdate?: () => void;
  /** Put away: not shown again for this version. */
  onDismiss: () => void;
  whatsNewLabel?: string;
  updateLabel?: string;
  dismissLabel?: string;
}

/**
 * A new release, said once and quietly at the top of the app: "Conch 0.3 is
 * ready · What's new · Update", and a way to put it away. Never a toast or a
 * modal; on a phone the buttons go under the words.
 */
export function UpdateBanner({
  title,
  onWhatsNew,
  onUpdate,
  onDismiss,
  whatsNewLabel = 'What’s new',
  updateLabel = 'Update',
  dismissLabel = 'Not now',
  className,
  ...props
}: UpdateBannerProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.banner, className)} {...props}>
      <Sparkles aria-hidden className={styles.bannerIcon} />
      <p id={titleId} className={styles.bannerTitle}>
        {title}
      </p>
      <div className={styles.bannerActions}>
        {onWhatsNew && (
          <Button size="sm" variant="ghost" onClick={onWhatsNew}>
            {whatsNewLabel}
          </Button>
        )}
        {onUpdate && (
          <Button size="sm" variant="soft" onClick={onUpdate}>
            {updateLabel}
          </Button>
        )}
      </div>
      <IconButton
        size="sm"
        label={dismissLabel}
        tooltip={false}
        onClick={onDismiss}
        className={styles.bannerDismiss}
      >
        <X />
      </IconButton>
    </section>
  );
}
