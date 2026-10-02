import {
  AppWindow,
  BadgeCheck,
  Blocks,
  Globe,
  MessageCircle,
  MessagesSquare,
  MonitorSmartphone,
  Repeat,
  Router,
  ShieldAlert,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Backups.module.css';
import { powerWords, type BackupPowerInfo } from './format';

export interface BackupPowersProps extends Omit<ComponentProps<'div'>, 'children'> {
  powers: BackupPowerInfo[];
  /** More of them than listed. */
  more?: number;
}

const ICONS: Record<BackupPowerInfo['kind'], ReactNode> = {
  'runs-program': <SquareTerminal />,
  'integration-never-asks': <Blocks />,
  'tools-never-ask': <Wrench />,
  'chats-never-ask': <MessagesSquare />,
  'routine-never-asks': <Repeat />,
  'browser-sites': <Globe />,
  'browser-local': <Router />,
  'terminal-remote': <MonitorSmartphone />,
  'channel-people': <MessageCircle />,
  'trusted-publishers': <BadgeCheck />,
  'page-data-sites': <AppWindow />,
};

/**
 * What in a backup can act for you, shown before it's restored: a program
 * it runs on this computer (with the command), and whatever it sets to act
 * without asking first. Calm, but hard to miss — a backup made by someone
 * else could carry any of these. Nothing when there's nothing to say.
 */
export function BackupPowers({ powers, more = 0, className, ...props }: BackupPowersProps) {
  const heading = useId();
  if (!powers.length) return null;
  return (
    <div className={cx(styles.powers, className)} {...props}>
      <p className={styles.powersHead} id={heading}>
        <ShieldAlert aria-hidden />
        <span>This backup lets Conch act for you</span>
      </p>
      <ul className={styles.powersList} aria-labelledby={heading}>
        {powers.map((power, i) => {
          const words = powerWords(power);
          return (
            <li key={`${power.kind}-${i}`} className={styles.power}>
              <span className={styles.powerIcon} aria-hidden>
                {ICONS[power.kind]}
              </span>
              <span className={styles.powerText}>
                {words.subject && <span className={styles.powerSubject}>{words.subject}</span>}
                <span className={styles.powerWhat}>{words.text}</span>
                {words.code && <code className={styles.powerCode}>{words.code}</code>}
              </span>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <p className={styles.powersMore}>{`And ${new Intl.NumberFormat().format(more)} more.`}</p>
      )}
      <p className={styles.powersNote}>Restore it only if you set these up yourself.</p>
    </div>
  );
}
