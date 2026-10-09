import type { CheckupAction } from '@conch/protocol';

import type { Services } from '../services';
import { secureHome, setAsideWorkspaceRules } from './checkup';

export class FixError extends Error {
  constructor(
    readonly code: 'verify-required' | 'unfixed',
    message: string,
  ) {
    super(message);
  }
}

export interface FixContext {
  /** The request comes from this computer (not relayed by a proxy). */
  local: boolean;
  /** A password or key was entered in the last few minutes ("sudo mode"). */
  verified: boolean;
}

/** "Gmail", "Gmail and Slack", "Gmail, Slack and Notion". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The security checkup's one-click fixes. Every one only takes trust away —
 * back to asking, off, or private — and moves nothing that's already safer.
 * None grants trust, so none needs more than the route it stands in for:
 * where that route asks you to confirm it's you, so does the fix.
 *
 * Reached only through `POST /api/access/fix`, which the gateway's host,
 * origin and sign-in checks cover like every other route. No agent tool
 * calls it, and the agent's browser can't reach the gateway at all.
 */
export async function runFix(
  services: Services,
  action: CheckupAction,
  context: FixContext,
): Promise<string> {
  switch (action) {
    case 'ask-first': {
      const { preferences } = await services.settings.get();
      // Only Full trust goes back to asking; a safer choice (Read only, Auto) stays.
      if (preferences.permissionMode === 'bypassPermissions')
        await services.settings.update({ preferences: { permissionMode: 'default' } });
      return 'New chats ask before acting.';
    }

    case 'check-after-reading':
      await services.settings.update({ preferences: { checkAfterReading: true } });
      return 'The assistant checks with you before acting on what it read.';

    case 'sealed-commands':
      await services.settings.update({ preferences: { sealedCommands: true } });
      return 'Commands run sealed again.';

    case 'check-memories':
      await services.settings.update({ preferences: { checkMemories: true } });
      return 'A memory that looks planted is held and asked about again.';

    case 'integrations-ask': {
      const trusted = (await services.integrations.store.all()).filter(
        (i) => i.enabled && i.policy === 'trust',
      );
      for (const integration of trusted)
        await services.integrations.update(integration.id, { policy: 'ask-writes' });
      const names = trusted.map((i) => i.name);
      if (!names.length) return 'Every integration asks before changes.';
      return `${listOf(names)} ${names.length === 1 ? 'asks' : 'ask'} before changes now.`;
    }

    case 'browser-local-off':
      await services.browser.updateSettings({ allowLocal: false });
      return 'The browser can’t open local apps now.';

    case 'computer-use-off':
      await services.computerUse.setEnabled(false);
      return 'The assistant can’t use your apps now.';

    case 'browser-own-chrome-off':
      await services.browser.setBackend({ kind: 'local' });
      return 'The browser is Conch’s own again; your Chrome is left alone.';

    case 'terminal-remote-off':
      // The terminal's own settings route asks another device to confirm it's
      // you before any change; the fix keeps that rule.
      if (!context.local && !context.verified)
        throw new FixError('verify-required', 'Confirm it’s you to make this change.');
      await services.terminal.updateSettings({ allowRemote: false });
      return 'Other devices can’t open a terminal now.';

    case 'workspace-rules-off': {
      const moved = await setAsideWorkspaceRules(await services.settings.workspace());
      if (!moved.length) return 'Your work folder has no rules of its own.';
      return moved.length === 1
        ? `Turned off. To bring them back, rename ${moved[0]} to drop “.off”.`
        : `Turned off. To bring them back, rename the files ending in “.off” in your work folder.`;
    }

    case 'secure-files': {
      const problems = await secureHome(services.config.CONCH_HOME);
      services.homeProblems = problems;
      if (problems.length)
        throw new FixError(
          'unfixed',
          'Conch still can’t change who may read some of its files. Run the command shown to fix it.',
        );
      return 'Only you can read your Conch files now.';
    }
  }
}
