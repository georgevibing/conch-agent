/**
 * Repair everything's look at your past chats from other apps (ADR 0111):
 * whether their list reads, and chats on this computer not brought in yet.
 */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../../doctor/service';
import type { ChatImportService } from './service';

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export function pastChatsCheck(chats: ChatImportService): DoctorCheck {
  return {
    id: 'past-chats',
    group: 'Your data',
    title: 'Past chats from other apps',
    async run({ repair }) {
      const items: DoctorItem[] = [];
      try {
        await chats.store.entries();
      } catch {
        // The list itself won't read (a disk error): look again, and say so if it still won't.
        chats.store.reload();
        if (repair) await chats.store.entries().catch(() => undefined);
        return [
          {
            id: 'past-chats:list',
            group: 'Your data',
            title: 'Past chats',
            state: 'needs-you',
            message:
              'The list of chats you brought in won’t read. Bring them in again to rebuild it.',
            action: { kind: 'open', label: 'Bring them in', place: 'memory', focus: 'past-chats' },
          },
        ];
      }
      const status = await chats.status();
      // Once you've brought chats in, new ones follow by themselves: a repair brings them now.
      if (status.last && !status.running && status.sources.some((s) => s.fresh > 0) && repair) {
        await chats.keepUp();
        return [
          {
            id: 'past-chats:fresh',
            group: 'Your data',
            title: 'Past chats',
            state: 'fixed',
            message: 'Bringing in your newest chats from other apps.',
          },
        ];
      }
      const waiting = status.sources.filter((s) => s.fresh > 0);
      if (!status.brought && waiting.length)
        items.push({
          id: 'past-chats:found',
          group: 'Your data',
          title: 'Past chats',
          state: 'off',
          message: `${plural(
            waiting.reduce((n, s) => n + s.fresh, 0),
            'conversation',
          )} from ${waiting.map((s) => s.label).join(' and ')} could be searched here too.`,
          action: { kind: 'open', label: 'Take a look', place: 'memory', focus: 'past-chats' },
        });
      return items;
    },
  };
}
