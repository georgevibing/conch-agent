/**
 * What each turn's system text says about Conch apps (ADR 0061 §7).
 *
 * The apps themselves — what each is for in its maker's words, its examples
 * and its tools — are in `## Apps` beside every other app
 * (`ConchApps.promptLines`), so they're said once. Here: that Conch can make
 * an app or find one, and, in a chat that's making one, the whole guide and
 * where the draft stands.
 */
import type { ConchAppCheck } from '@conch/protocol';

import { makerGuide } from './guide';
import { plainLine, quoted } from './words';
import type { ConchAppService } from './service';

export const MAKING_APPS = `## Making apps
When the person wants an ability nothing they have offers (keep a diary, track something, read a site's data), offer to make them a Conch app, or look for one first with \`app_find\`. If an app or skill under ## What Conch can turn on already does it, offer that instead.
Read \`app_guide\` before you build or change one. Build first, and ask only what you can't sensibly assume.
Always \`app_check\` and \`app_try\` every tool before \`app_present\`.
The person adds it from the card \`app_present\` (or \`app_get\`) puts under your reply. Never say it's added, installed or ready to use before the card says so.
Their apps are listed under ## Apps: use them by name when they fit, without being asked. A link to an app (GitHub, a .conchapp) goes to \`app_get\`; "share it" or "put it on GitHub" goes to \`app_share\`, whose card they press.`;

function checkLine(check: ConchAppCheck | undefined, hash: string): string {
  if (!check) return 'Not checked yet: run app_check.';
  if (check.hash !== hash) return 'Changed since the last app_check: run it again.';
  const untried = check.tools.map((t) => t.name).filter((t) => !check.tried.includes(t));
  if (check.problems.length)
    return `The last app_check found ${check.problems.length} problem${check.problems.length === 1 ? '' : 's'}: ${check.problems
      .slice(0, 3)
      .map((p) => plainLine(p.message, 200))
      .join(' ')}`;
  if (untried.length) return `It passes so far; still to try with app_try: ${untried.join(', ')}.`;
  return 'It passes and every tool was tried: app_present when it does what was asked.';
}

/**
 * The section for one turn: how making apps works, and in a chat with a
 * draft, the guide and where it stands. Empty where the maker's tools
 * aren't offered.
 */
export async function appsPrompt(
  service: ConchAppService,
  conversationId: string,
  options: { tools: boolean },
): Promise<string> {
  if (!options.tools) return '';
  const drafts = await service.workshop.ofChat(conversationId).catch(() => []);
  if (!drafts.length) return MAKING_APPS;
  const parts = [MAKING_APPS, '## The app being made in this chat'];
  for (const info of drafts.slice(0, 3)) {
    const draft = await service.draft(info).catch(() => undefined);
    if (!draft) continue;
    // A change to an app from elsewhere carries its maker's name: one plain line.
    const name = draft.manifest ? quoted(draft.manifest.name, 40) : 'An app that doesn’t read yet';
    const tried = info.tried[draft.hash] ?? [];
    const check = draft.check && { ...draft.check, tried };
    parts.push(
      [
        `- ${name} (draft \`${draft.id}\`${draft.appId ? `, a change to the app ${draft.appId}` : ''})`,
        `  Files: ${draft.files.map((f) => f.path).join(', ') || 'none'}`,
        `  ${checkLine(check, draft.hash)}`,
      ].join('\n'),
    );
  }
  parts.push(makerGuide());
  return parts.join('\n\n');
}
