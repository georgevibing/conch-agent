/** Repair everything's look at Safe hands (ADR 0028): what holds, and what a person could turn back on. */
import type { DoctorItem, SafetyStatus, Skill } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { SettingsStore } from '../settings/store';
import { sandboxSupport } from './sandbox';

const GROUP = 'This computer';

export function safetyCheck(
  settings: SettingsStore,
  support = sandboxSupport,
  more: {
    /** What sealing means for each provider you use (ADR 0031). */
    providers?: () => Promise<SafetyStatus['providers']>;
    /** Skills, for one whose signature doesn't hold. */
    skills?: () => Promise<Skill[]>;
  } = {},
): DoctorCheck {
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
      item(
        'safety:memories',
        'Checking what it remembers',
        preferences.checkMemories ? 'ok' : 'warning',
        preferences.checkMemories
          ? 'A memory that looks planted is held and asked about before it’s used.'
          : 'Memories that look planted are remembered without asking.',
        preferences.checkMemories
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
            ? {
                kind: 'command',
                label: 'Seal commands',
                command: sandbox.command,
                watch: 'command-sandbox',
              }
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
      // A provider sealed only partly says what's still in reach, and how to fix it.
      for (const p of (await more.providers?.().catch(() => [])) ?? [])
        if (p.state === 'partly')
          item(
            `safety:sealed:${p.id}`,
            `Sealed commands in ${p.label}`,
            'warning',
            p.note,
            p.id === 'codex-agent'
              ? { kind: 'need', label: 'Update Codex', need: 'codex', mode: 'update' }
              : undefined,
          );
      // Signed, and not what was signed: off, and worth a look (ADR 0031).
      for (const skill of (await more.skills?.().catch(() => [])) ?? [])
        if (skill.signature?.state === 'invalid')
          item(
            `safety:signature:${skill.id}`,
            skill.title,
            'warning',
            `${skill.signature.problem ?? 'Its signature doesn’t hold.'} It’s off.`,
            { kind: 'open', label: 'Look at it', place: 'skills', focus: skill.id },
          );
      return items;
    },
  };
}
