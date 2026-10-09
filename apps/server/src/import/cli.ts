/**
 * `conch import --from openclaw|hermes [--dry-run]` (ADR 0035): Come home
 * from the terminal. A dry run lists exactly what would come over. A real one
 * brings your profile, memories, skills (off) and routines (drafts); chat
 * bots and keys only ever come over in Conch itself, where you see them.
 */
import type { ImportPlan } from '@conch/protocol';

import { working } from '../cli/pearl';
import type { Ui } from '../cli/ui';
import { plural } from '../cli/words';
import type { ImportService } from './service';

export interface ImportIo {
  /** Everything a person reads goes through the terminal kit. */
  ui: Ui;
  /** What to tell people to type: `conch quit` (or `pnpm conch quit` in a checkout). */
  conch: (args: string) => string;
  /** A Conch is running: it should do the import, so its stores see it. */
  running: () => Promise<boolean>;
}

const GROUPS: Record<string, string> = {
  agents: 'Agents',
  about: 'About you',
  memories: 'Memories',
  skills: 'Skills (they come over off)',
  routines: 'Routines (they come over as drafts)',
  channels: 'Chat bots (only in Conch: Settings → What Conch knows)',
  keys: 'Keys (only in Conch: Settings → What Conch knows)',
};

export function printPlan(plan: ImportPlan, io: ImportIo): void {
  const { ui } = io;
  ui.say(`${ui.bold(`From ${plan.source.label}`)}  ${ui.dim(plan.source.path)}`);
  for (const [group, label] of Object.entries(GROUPS)) {
    const items = plan.items.filter((i) => i.group === group);
    if (!items.length) continue;
    ui.blank();
    ui.say(ui.bold(label));
    for (const item of items) {
      const mark = item.duplicate
        ? ui.dim('=')
        : item.checked
          ? ui.success(ui.sym.ok)
          : ui.dim(ui.sym.ring);
      ui.say(`${mark} ${item.title}${item.duplicate ? ui.dim(' (already here)') : ''}`);
      if (item.warning) ui.say(`  ${ui.warning(`${ui.sym.warn} ${item.warning}`)}`);
    }
  }
  for (const problem of plan.problems) ui.note(problem);
}

export async function importCommand(
  args: string[],
  imports: ImportService,
  io: ImportIo,
): Promise<number> {
  const { ui, conch } = io;
  const from = args[args.indexOf('--from') + 1];
  if (!args.includes('--from') || (from !== 'openclaw' && from !== 'hermes')) {
    ui.say('Where are your things coming from?');
    ui.hint(
      `${ui.code(conch('import --from openclaw'))} or ${ui.code(conch('import --from hermes'))}`,
    );
    return 1;
  }
  let plan: ImportPlan;
  try {
    plan = await imports.plan(from);
  } catch (error) {
    ui.error((error as Error).message);
    return 1;
  }
  printPlan(plan, io);
  if (args.includes('--dry-run')) {
    ui.blank();
    ui.hint('Nothing was changed. Run it again without --dry-run to bring the ticked ones over.');
    return 0;
  }
  if (await io.running()) {
    ui.blank();
    ui.note(
      'Conch is running, so it should do this itself: Settings → What Conch knows → Bring your things over.',
    );
    ui.hint(`Or stop it first (${ui.code(conch('quit'))}) and run this again.`);
    return 1;
  }
  const ids = plan.items
    .filter((i) => i.checked && !i.duplicate && i.group !== 'channels' && i.group !== 'keys')
    .map((i) => i.id);
  if (!ids.length) {
    ui.blank();
    ui.say('Nothing new to bring over. You’re all caught up. 🐚');
    return 0;
  }
  ui.blank();
  const result = await working(
    ui,
    `Bringing your things over from ${plan.source.label}`,
    () =>
      imports.run(from, ids, {
        // Their default starts new chats, as it would in Conch with nothing changed.
        ...(plan.defaultAgent && { defaultAgent: plan.defaultAgent }),
      }),
    {
      done: (r) =>
        `Brought ${plural(r.outcomes.filter((o) => o.ok).length, 'thing')} over from ${plan.source.label}. Welcome home. ✨`,
    },
  );
  const failed = result.outcomes.filter((o) => !o.ok);
  for (const f of failed) ui.note(`${f.title}: ${f.message}`);
  ui.hint('Changed your mind? Settings → What Conch knows → Undo, within a week.');
  return failed.length ? 1 : 0;
}
