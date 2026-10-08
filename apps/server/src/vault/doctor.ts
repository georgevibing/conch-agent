import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { VaultService } from './service';

const GROUP = 'Your data';
const TITLE = 'Passwords';

/**
 * Repair everything's look at Passwords (ADR 0025): that the vault opens, how
 * its key is kept, anything in a data breach, and each password manager
 * Passwords shows. Never destructive: a damaged item is kept as it is (a
 * restore brings it back), and nothing is unlocked or signed out.
 */
export function vaultCheck(vault: VaultService): DoctorCheck {
  const open = { kind: 'open', label: 'Open Passwords', place: 'passwords' } as const;
  const item = (
    id: string,
    title: string,
    fields: Omit<DoctorItem, 'id' | 'group' | 'title'>,
  ): DoctorItem => ({
    id: `passwords:${id}`,
    group: GROUP,
    title,
    ...fields,
  });
  return {
    id: 'passwords',
    group: GROUP,
    title: TITLE,
    async run() {
      let opened;
      try {
        opened = await vault.store.open();
      } catch (error) {
        return [
          item('vault', TITLE, {
            state: 'needs-you',
            message: (error as Error).message,
            action: open,
          }),
        ];
      }
      const out: DoctorItem[] = [];
      const status = await vault.status();
      const count = [...opened.items.values()].filter((r) => !r.deletedAt).length;
      if (opened.damaged.length)
        out.push(
          item('vault', TITLE, {
            state: 'warning',
            message: `${opened.damaged.length} saved ${opened.damaged.length === 1 ? 'item' : 'items'} couldn’t be opened. They’re kept as they are; restoring a backup with its passphrase brings them back.`,
            action: { kind: 'open', label: 'Restore a backup', place: 'health', focus: 'restore' },
          }),
        );
      else if (opened.tampered)
        out.push(
          item('vault', TITLE, {
            state: 'warning',
            message:
              'Something changed your passwords file outside Conch, and an item may be missing. Check your passwords, or restore a backup.',
            action: open,
          }),
        );
      else if (status.health.compromised)
        out.push(
          item('vault', TITLE, {
            state: 'warning',
            message: `${status.health.compromised} ${status.health.compromised === 1 ? 'password was' : 'passwords were'} in a data breach. Change ${status.health.compromised === 1 ? 'it' : 'them'} first.`,
            action: open,
          }),
        );
      else
        out.push(
          item('vault', TITLE, {
            // A key in a file isn't a warning: without a keychain there's nothing to do about it.
            state: 'ok',
            message:
              status.protection === 'file'
                ? `${count} saved, encrypted on this computer.`
                : `${count} saved, encrypted, with the key in this computer’s keychain.`,
          }),
        );
      for (const source of status.sources) {
        if (source.id === 'conch' || source.state === 'off') continue;
        // A service account whose token stopped working: only a new token fixes it.
        const serviceAccount = source.access?.mode === 'service-account';
        if (serviceAccount && source.state === 'locked') {
          out.push(
            item(source.id, source.name, {
              state: 'needs-you',
              message: source.message ?? '1Password’s service account isn’t working.',
              action: {
                kind: 'open',
                label: 'Replace the token',
                place: 'passwords',
                focus: '1password',
              },
            }),
          );
          continue;
        }
        out.push(
          item(source.id, source.name, {
            state:
              source.state === 'ready' ? 'ok' : source.state === 'error' ? 'warning' : 'needs-you',
            message:
              source.state === 'ready'
                ? `Shown in Passwords${source.count !== undefined ? ` · ${source.count} items` : ''}${serviceAccount ? ' · through a service account' : ''}.`
                : (source.message ?? `${source.name} isn’t ready.`),
            action:
              source.state === 'missing' && source.need
                ? {
                    kind: 'need',
                    label: `Install ${source.name}`,
                    need: source.need,
                    mode: 'install',
                  }
                : open,
          }),
        );
      }
      return out;
    },
  };
}
