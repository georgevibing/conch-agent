/**
 * `pnpm conch import --from openclaw|hermes [--dry-run]` (ADR 0035): Come
 * home from the terminal. A dry run lists exactly what would come over. A
 * real one brings your profile, memories, skills (off) and routines (drafts);
 * chat bots and keys only ever come over in Conch itself, where you see them.
 */
import type { ImportPlan } from '@conch/protocol';

import type { ImportService } from './service';

export interface ImportIo {
  say: (line?: string) => void;
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  /** A Conch is running: it should do the import, so its stores see it. */
  running: () => Promise<boolean>;
}

const GROUPS: Record<string, string> = {
  persona: 'Your assistant',
  about: 'About you',
  memories: 'Memories',
  skills: 'Skills (they come over off)',
  routines: 'Routines (they come over as drafts)',
  channels: 'Chat bots (only in Conch: Settings → Memory)',
  keys: 'Keys (only in Conch: Settings → Memory)',
};

export function printPlan(plan: ImportPlan, io: ImportIo): void {
  io.say(io.bold(`From ${plan.source.label} (${plan.source.path})`));
  for (const [group, label] of Object.entries(GROUPS)) {
    const items = plan.items.filter((i) => i.group === group);
    if (!items.length) continue;
    io.say();
    io.say(io.bold(label));
    for (const item of items) {
      const mark = item.duplicate ? io.dim('= ') : item.checked ? io.green('✓ ') : io.dim('○ ');
      io.say(`${mark}${item.title}${item.duplicate ? io.dim(' (already here)') : ''}`);
      if (item.warning) io.say(io.yellow(`  ⚠ ${item.warning}`));
    }
  }
  for (const problem of plan.problems) io.say(io.yellow(`⚠ ${problem}`));
}

export async function importCommand(
  args: string[],
  imports: ImportService,
  io: ImportIo,
): Promise<number> {
  const from = args[args.indexOf('--from') + 1];
  if (!args.includes('--from') || (from !== 'openclaw' && from !== 'hermes')) {
    io.say(
      `Say where from: ${io.bold('pnpm conch import --from openclaw')} or ${io.bold('--from hermes')}.`,
    );
    return 1;
  }
  let plan: ImportPlan;
  try {
    plan = await imports.plan(from);
  } catch (error) {
    io.say(`✗ ${(error as Error).message}`);
    return 1;
  }
  printPlan(plan, io);
  if (args.includes('--dry-run')) {
    io.say();
    io.say(
      io.dim('Nothing was changed. Run it again without --dry-run to bring the ticked ones over.'),
    );
    return 0;
  }
  if (await io.running()) {
    io.say();
    io.say(
      'Conch is running, so it should do this itself: Settings → Memory → Bring your things over.',
    );
    io.say(io.dim('Or quit it first (pnpm conch quit) and run this again.'));
    return 1;
  }
  const ids = plan.items
    .filter((i) => i.checked && !i.duplicate && i.group !== 'channels' && i.group !== 'keys')
    .map((i) => i.id);
  if (!ids.length) {
    io.say();
    io.say('Nothing new to bring over.');
    return 0;
  }
  const result = await imports.run(from, ids);
  io.say();
  const failed = result.outcomes.filter((o) => !o.ok);
  io.say(
    `${io.green('✓')} Brought ${result.outcomes.length - failed.length} things over from ${plan.source.label}.`,
  );
  for (const f of failed) io.say(io.yellow(`⚠ ${f.title}: ${f.message}`));
  io.say(io.dim('Changed your mind? Settings → Memory → Undo, within a week.'));
  return failed.length ? 1 : 0;
}
