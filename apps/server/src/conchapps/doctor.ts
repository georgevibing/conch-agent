/**
 * Repair everything's look at Conch apps (ADR 0061 §8): every app's files
 * are still what was added (Repair puts them back from the kept copy), its
 * tools start, its data folder reads; and the workshop hasn't grown huge
 * (Repair tidies drafts whose chat is gone).
 */
import { mkdir, readdir } from 'node:fs/promises';

import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { ConchAppService } from './service';

const GROUP = 'Apps';
/** Past this, the drafts in the workshop are worth a look. */
export const WORKSHOP_BIG = 200 * 1024 * 1024;

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

export function conchAppsCheck(service: ConchAppService): DoctorCheck {
  return {
    id: 'conch-apps',
    group: GROUP,
    title: 'Apps you made or added',
    async run({ repair }) {
      await service.load();
      const items: DoctorItem[] = [];
      const open = (id: string) => ({
        kind: 'open' as const,
        label: 'Open Apps',
        place: 'integrations' as const,
        focus: `capp_${id}`,
      });
      for (const app of service.store.peek()) {
        const base = { id: `conch-apps:${app.id}`, group: GROUP, title: app.manifest.name };
        // Its files, as they were added.
        if (!(await service.intact(app.id))) {
          const kept = await service.store.hasKept(app.id, app.hash);
          if (!repair) {
            items.push({
              ...base,
              state: kept ? 'warning' : 'needs-you',
              message: kept
                ? 'Its files aren’t what was added. Repair puts them back.'
                : 'Its files aren’t what was added, and there’s no copy to bring back. Remove it and add it again.',
              ...(!kept && { action: open(app.id) }),
            });
            continue;
          }
          const back = kept && (await service.repairFiles(app.id).catch(() => false));
          items.push({
            ...base,
            state: back ? 'fixed' : 'needs-you',
            message: back
              ? `${app.manifest.name}’s files were put back as they were added.`
              : 'Its files aren’t what was added, and there’s no copy to bring back. Remove it and add it again.',
            ...(!back && { action: open(app.id) }),
          });
          if (!back) continue;
        }
        // Its data folder reads.
        const data = service.store.dataDir(app.id);
        if (
          !(await readdir(data).then(
            () => true,
            () => false,
          ))
        ) {
          if (repair) await mkdir(data, { recursive: true, mode: 0o700 }).catch(() => undefined);
          else {
            items.push({
              ...base,
              state: 'warning',
              message: 'Its data folder is missing. Repair makes it again.',
            });
            continue;
          }
        }
        if (!app.enabled) {
          items.push({ ...base, state: 'off', message: 'Turned off.' });
          continue;
        }
        // Its tools start: only looked at on Repair, or when it has failed already.
        if (repair || service.failure(app.id))
          await service.checkRuntime(app.id).catch(() => undefined);
        const failure = service.failure(app.id);
        items.push(
          failure
            ? { ...base, state: 'needs-you', message: failure, action: open(app.id) }
            : { ...base, state: 'ok', message: 'Working.' },
        );
      }
      // The workshop, where apps are made.
      const bytes = await service.workshop.bytes().catch(() => 0);
      if (bytes > WORKSHOP_BIG) {
        const gone = repair ? await service.tidy().catch(() => 0) : 0;
        const after = repair ? await service.workshop.bytes().catch(() => bytes) : bytes;
        items.push({
          id: 'conch-apps:workshop',
          group: GROUP,
          title: 'Apps being made',
          state: after > WORKSHOP_BIG ? 'warning' : 'fixed',
          message:
            after > WORKSHOP_BIG
              ? `Drafts of apps take ${mb(after)}. Delete chats you don’t need, and their drafts go after 30 days.`
              : `Tidied ${gone} old ${gone === 1 ? 'draft' : 'drafts'} of apps whose chat was gone.`,
        });
      }
      return items;
    },
  };
}
