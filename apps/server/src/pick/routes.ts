import { PickBody, type PickPurpose, PickResult } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import { PickerUnavailable, type PickOptions, pickPath } from '../lib/picker';

/** What each purpose asks for: the page names one, never a prompt or file types. */
export const PICK_PURPOSES: Record<PickPurpose, PickOptions> = {
  'keepassxc-database': {
    prompt: 'Choose your KeePassXC database',
    kind: 'file',
    extensions: ['kdbx'],
  },
  'keepassxc-keyfile': { prompt: 'Choose the key file for your KeePassXC database', kind: 'file' },
  workspace: { prompt: 'Choose the folder your assistant works in', kind: 'folder' },
  'watch-folder': { prompt: 'Choose the folder to watch for changes', kind: 'folder' },
  'conch-app': { prompt: 'Choose the app to add', kind: 'file', extensions: ['conchapp'] },
};

/**
 * `POST /api/pick`: the system's Open dialog, on this computer. From any
 * other device it's refused in words: the dialog would open where nobody's
 * looking.
 */
export function registerPickRoutes(
  app: FastifyInstance,
  pick: (options: PickOptions) => Promise<string | undefined> = pickPath,
): void {
  app.post('/api/pick', async (request, reply) => {
    const body = PickBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: 'Nothing to choose.' });
    if (request.access?.kind !== 'local')
      return reply.code(403).send({
        error: 'not-here',
        message: 'The Open dialog shows on the computer Conch runs on. Choose it there.',
      });
    try {
      const path = await pick(PICK_PURPOSES[body.data.purpose]);
      return PickResult.parse(path ? { path } : {});
    } catch (error) {
      if (error instanceof PickerUnavailable)
        return reply.code(503).send({ error: 'unavailable', message: error.message });
      throw error;
    }
  });
}
