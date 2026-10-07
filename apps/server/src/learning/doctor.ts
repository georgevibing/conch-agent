/**
 * Repair everything's look at quiet learning (ADR 0088): the record of what
 * was learned (read through `readStore`, so a damaged one is set aside and
 * started again by reading it), and whether learning is resting — at its cap,
 * or with no provider that can read a chat. Neither is wrong; both are
 * worth knowing.
 */
import type { DoctorItem } from '@conch/protocol';

import type { Doctor } from '../doctor/service';
import type { QuietLearning } from './service';

const GROUP = 'Your data';

function until(at: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(at);
}

export function registerQuietLearningDoctor(
  doctor: Pick<Doctor, 'register'>,
  learning: Pick<QuietLearning, 'status'>,
): void {
  doctor.register({
    id: 'learning',
    group: GROUP,
    title: 'Learning from your chats',
    async run() {
      const base = {
        id: 'learning:record',
        group: GROUP,
        title: 'Learning from your chats',
      } as const;
      let status;
      try {
        status = await learning.status();
      } catch {
        return [
          {
            ...base,
            state: 'warning',
            message: 'What Conch learned couldn’t be read just now.',
            action: { kind: 'open', label: 'Open memory', place: 'memory' },
          },
        ];
      }
      if (!status.on)
        return [{ ...base, state: 'off', message: 'Learning from your chats is off.' }];
      const items: DoctorItem[] = [];
      const learned = status.entries.filter(
        (e) => e.state === 'applied' || e.state === 'kept',
      ).length;
      items.push({
        ...base,
        state: 'ok',
        message:
          learned === 0
            ? 'Conch learns from your chats once they go quiet. Nothing yet.'
            : `Conch learns from your chats once they go quiet: ${learned === 1 ? 'one thing' : `${learned} things`} so far, each with Undo.`,
      });
      // What waits is a memory the check held: Memory's own check says so, once.
      if (status.paused?.reason === 'cap')
        items.push({
          id: 'learning:paused',
          group: GROUP,
          title: 'Learning is resting',
          state: 'info',
          message: `Learning reached what it may spend this month, so it rests${status.paused.until ? ` until ${until(status.paused.until)}` : ''}.`,
          action: { kind: 'open', label: 'Change what it may spend', place: 'usage' },
        });
      else if (status.paused?.reason === 'no-model')
        items.push({
          id: 'learning:model',
          group: GROUP,
          title: 'Learning is waiting',
          state: 'info',
          message:
            'Learning needs a provider that can write a short answer, like Claude Code, a model API or a model on this computer. It carries on by itself once one is connected.',
          action: { kind: 'open', label: 'Open providers', place: 'providers' },
        });
      return items;
    },
  });
}
