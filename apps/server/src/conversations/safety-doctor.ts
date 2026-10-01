/** Repair everything's look at Safe hands (ADR 0028): what holds, and what a person could turn back on. */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { SettingsStore } from '../settings/store';
import { sandboxSupport } from './sandbox';

const GROUP = 'This computer';

export function safetyCheck(settings: SettingsStore, support = sandboxSupport): DoctorCheck {
  return {
    id: 'safety',
    group: GROUP,
    title: 'Safety',
    async run() {
      const { preferences } = await settings.get();
      const items: DoctorItem[] = [];
      const item = (
        id: string,
        title: string,
        state: DoctorItem['state'],
        message: string,
        action?: DoctorItem['action'],
      ) => items.push({ id, group: GROUP, title, state, message, ...(action && { action }) });
      item(
        'safety:reading',
        'Checking after reading',
        preferences.checkAfterReading ? 'ok' : 'warning',
        preferences.checkAfterReading
          ? 'After reading something from outside, the assistant checks with you before acting.'
          : 'The assistant acts on what it read without checking with you.',
        preferences.checkAfterReading
          ? undefined
          : { kind: 'open', label: 'Turn it on', place: 'security' },
      );
      const sandbox = support();
      if (!sandbox.available)
        item(
          'safety:sealed',
          'Sealed commands',
          sandbox.command ? 'needs-you' : 'off',
          sandbox.reason,
          sandbox.command
            ? { kind: 'command', label: 'Copy', command: sandbox.command }
            : undefined,
        );
      else
        item(
          'safety:sealed',
          'Sealed commands',
          preferences.sealedCommands ? 'ok' : 'off',
          preferences.sealedCommands
            ? 'Commands can’t read where your keys and passwords live.'
            : 'Commands aren’t sealed.',
          preferences.sealedCommands
            ? undefined
            : { kind: 'open', label: 'Seal them', place: 'security' },
        );
      return items;
    },
  };
}
