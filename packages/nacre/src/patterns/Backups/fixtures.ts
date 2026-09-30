import type { BackupListItem } from './BackupList';
import type { BackupContentsInfo } from './format';

export const everything: BackupContentsInfo = {
  settings: true,
  memories: 12,
  commands: 4,
  routines: 3,
  skills: 2,
  integrations: 5,
  integrationsSigningIn: 5,
  chats: 240,
  attachments: 18,
  secrets: 'passphrase',
};

/** A daily backup: chats in, keys not (they're on this computer already). */
export const daily: BackupContentsInfo = { ...everything, secrets: undefined };

/** Made without chats or keys. */
export const light: BackupContentsInfo = {
  ...everything,
  chats: undefined,
  attachments: undefined,
  secrets: undefined,
  integrationsSigningIn: 3,
};

export const backups: BackupListItem[] = [
  {
    id: 'auto-20260930-031200',
    title: 'Today at 3:12 AM',
    kind: 'automatic',
    summary: '12 memories · 3 routines · 2 skills · 5 integrations · 240 chats · 48 MB',
  },
  {
    id: 'undo-20260929-140200',
    title: 'Yesterday at 2:02 PM',
    kind: 'before-restore',
    summary: '12 memories · 3 routines · 2 skills · 5 integrations · 236 chats · 47 MB',
  },
  {
    id: 'auto-20260929-031000',
    title: 'Yesterday at 3:10 AM',
    kind: 'automatic',
    summary: '11 memories · 3 routines · 2 skills · 5 integrations · 231 chats · 46 MB',
  },
  {
    id: 'auto-20260928-030800',
    title: 'Sunday at 3:08 AM',
    kind: 'automatic',
    summary: '11 memories · 3 routines · 1 skill · 4 integrations · 225 chats · 45 MB',
  },
  {
    id: 'auto-20260921-030500',
    title: '21 Sept at 3:05 AM',
    kind: 'automatic',
    summary: '9 memories · 2 routines · 1 skill · 4 integrations · 190 chats · 39 MB',
  },
];
