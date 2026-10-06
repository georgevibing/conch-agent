import {
  AskedPath,
  FolderGuess,
  FolderListing,
  FolderPlaces,
  MadeFolder,
  MakeFolderBody,
  PickBody,
  type PickPurpose,
  PickPurpose as PickPurposeSchema,
  PickResult,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { theApp } from '../desktop/app';
import { PickerUnavailable, type PickOptions, pickPath } from '../lib/picker';
import {
  FolderError,
  folderPlaces,
  guessFolder,
  listFolder,
  makeFolder,
  type FolderProblem,
  type FolderRules,
} from './folders';

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

/** The desktop app's side of the Open dialog (ADR 0054): shown over its own window. */
export interface AppPicker {
  pick(options: PickOptions): Promise<string | undefined>;
}

/** The page asking is the desktop app's own window (Electron says so in its user agent). */
export function fromTheApp(request: FastifyRequest): boolean {
  return /\bElectron\//.test(request.headers['user-agent'] ?? '');
}

/**
 * `POST /api/pick`: the system's Open dialog, on this computer. In the desktop
 * app it's the app's own, over its window; in a browser here, the gateway
 * asks the system for one. From any other device it's refused in words: the
 * dialog would open where nobody's looking (those devices walk through
 * folders with `/api/pick/list` instead).
 */
export function registerPickRoutes(
  app: FastifyInstance,
  pick: (options: PickOptions) => Promise<string | undefined> = pickPath,
  desktop: () => AppPicker | undefined = theApp,
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
    const options = PICK_PURPOSES[body.data.purpose];
    try {
      const inApp = fromTheApp(request) ? desktop() : undefined;
      // The app couldn't show it (an older app, a closed window): the system's, as before.
      const path = inApp
        ? await inApp.pick(options).catch(() => pick(options))
        : await pick(options);
      return PickResult.parse(path ? { path } : {});
    } catch (error) {
      if (error instanceof PickerUnavailable)
        return reply.code(503).send({ error: 'unavailable', message: error.message });
      throw error;
    }
  });
}

const STATUS: Record<FolderProblem, number> = {
  missing: 404,
  'not-folder': 409,
  denied: 403,
  unreadable: 403,
  exists: 409,
  name: 400,
};

/** Walking through folders is a person's, in Conch: never an access key (a script, the assistant's shell). */
function personOnly(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.access?.kind !== 'bearer') return false;
  void reply.code(403).send({
    error: 'person-only',
    message: 'Only you can look through this computer’s folders, in Conch itself.',
  });
  return true;
}

function fail(reply: FastifyReply, error: unknown) {
  if (!(error instanceof FolderError)) throw error;
  return reply
    .code(STATUS[error.code])
    .send({ error: `folder-${error.code}`, message: error.message });
}

/** What a purpose lets a listing show besides folders. */
function filesFor(purpose: unknown): readonly string[] | 'all' | undefined {
  const parsed = PickPurposeSchema.safeParse(purpose);
  if (!parsed.success) return undefined;
  const options = PICK_PURPOSES[parsed.data];
  if (options.kind !== 'file') return undefined;
  return options.extensions?.length ? options.extensions : 'all';
}

/**
 * Choosing a folder from any device (`/api/pick/places`, `/list`, `/guess`,
 * `POST /api/pick/folder`). Under `/api`, so Host, Origin, Fetch Metadata and
 * sign-in are checked like everything else, and a person only: names of
 * folders, never what's in a file (`folders.ts` says what's left out).
 */
export function registerFolderRoutes(
  app: FastifyInstance,
  rules: () => FolderRules | Promise<FolderRules>,
): void {
  app.get('/api/pick/places', async (request, reply) => {
    if (personOnly(request, reply)) return;
    return FolderPlaces.parse(await folderPlaces(await rules()));
  });

  app.get<{ Querystring: { path?: string; hidden?: string; purpose?: string } }>(
    '/api/pick/list',
    async (request, reply) => {
      if (personOnly(request, reply)) return;
      const path = AskedPath.safeParse(request.query.path ?? '~');
      if (!path.success)
        return reply.code(400).send({ error: 'bad-request', message: 'That isn’t a path.' });
      try {
        const files = filesFor(request.query.purpose);
        const listing = await listFolder(path.data, await rules(), {
          hidden: request.query.hidden === '1',
          ...(files && { files }),
        });
        return FolderListing.parse(listing);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.get<{ Querystring: { path?: string } }>('/api/pick/guess', async (request, reply) => {
    if (personOnly(request, reply)) return;
    const path = AskedPath.safeParse(request.query.path);
    if (!path.success)
      return reply.code(400).send({ error: 'bad-request', message: 'That isn’t a path.' });
    return FolderGuess.parse(await guessFolder(path.data, await rules()));
  });

  app.post('/api/pick/folder', async (request, reply) => {
    if (personOnly(request, reply)) return;
    const body = MakeFolderBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: 'Give the folder a name.' });
    try {
      const path = await makeFolder(body.data.parent, body.data.name, await rules());
      return MadeFolder.parse({ path });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
