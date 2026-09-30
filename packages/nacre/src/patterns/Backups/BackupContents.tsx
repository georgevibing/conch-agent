import {
  Blocks,
  Brain,
  KeyRound,
  MessagesSquare,
  Repeat,
  Settings2,
  SquareSlash,
  WandSparkles,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Backups.module.css';
import type { BackupContentsInfo } from './format';

export interface BackupContentsProps extends Omit<ComponentProps<'ul'>, 'children'> {
  contents: BackupContentsInfo;
  /**
   * The keys and sign-ins in it come back too. `false` when they're left out
   * (no passphrase); then integrations that sign in say they'll ask again.
   */
  withSecrets?: boolean;
}

interface Row {
  key: string;
  icon: ReactNode;
  text: string;
  note?: string;
  /** Not in this backup: what's here stays as it is. */
  absent?: boolean;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`;

/**
 * What a restore brings back, in plain words, before anything happens:
 * “12 memories · 3 routines · 5 integrations (you'll sign in to them
 * again) · 240 chats”. What isn't in the backup says it stays as it is.
 */
export function BackupContents({
  contents,
  withSecrets = contents.secrets !== undefined,
  className,
  ...props
}: BackupContentsProps) {
  const signIn = withSecrets ? 0 : contents.integrationsSigningIn;
  const all: (Row | false)[] = [
    contents.memories > 0 && {
      key: 'memories',
      icon: <Brain />,
      text: count(contents.memories, 'memory', 'memories'),
    },
    contents.routines > 0 && {
      key: 'routines',
      icon: <Repeat />,
      text: count(contents.routines, 'routine'),
    },
    contents.skills > 0 && {
      key: 'skills',
      icon: <WandSparkles />,
      text: count(contents.skills, 'skill'),
    },
    contents.commands > 0 && {
      key: 'commands',
      icon: <SquareSlash />,
      text: count(contents.commands, 'command'),
    },
    contents.integrations > 0 && {
      key: 'integrations',
      icon: <Blocks />,
      text: count(contents.integrations, 'integration'),
      note:
        signIn === 0
          ? undefined
          : signIn === contents.integrations
            ? `you’ll sign in to ${signIn === 1 ? 'it' : 'them'} again`
            : `you’ll sign in to ${signIn} of them again`,
    },
    contents.chats === undefined
      ? {
          key: 'chats',
          icon: <MessagesSquare />,
          text: 'Chats aren’t in it',
          note: 'yours stay as they are',
          absent: true,
        }
      : {
          key: 'chats',
          icon: <MessagesSquare />,
          text: count(contents.chats, 'chat'),
          note: contents.attachments
            ? `with ${count(contents.attachments, 'file')} sent in them`
            : undefined,
        },
    contents.settings && {
      key: 'settings',
      icon: <Settings2 />,
      text: 'Your settings and preferences',
    },
    withSecrets && contents.secrets
      ? {
          key: 'secrets',
          icon: <KeyRound />,
          text: 'Your keys and sign-ins',
          note: contents.secrets === 'passphrase' ? 'with your passphrase' : 'as they were here',
        }
      : {
          key: 'secrets',
          icon: <KeyRound />,
          text: contents.secrets ? 'Keys and sign-ins left out' : 'Keys and sign-ins aren’t in it',
          note: 'yours stay as they are',
          absent: true,
        },
  ];
  const rows = all.filter((row): row is Row => row !== false);

  return (
    <ul
      aria-label="What this backup brings back"
      className={cx(styles.contents, className)}
      {...props}
    >
      {rows.map((row) => (
        <li key={row.key} className={styles.item} data-absent={row.absent || undefined}>
          <span className={styles.itemIcon} aria-hidden>
            {row.icon}
          </span>
          <span className={styles.itemText}>
            {row.text}
            {row.note && <span className={styles.itemNote}> · {row.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
