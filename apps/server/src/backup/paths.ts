import { isAbsolute, relative, resolve } from 'node:path';

import { BACKUP_LIMITS } from '@conch/protocol';

import { safeJoin } from '../lib/fs';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what's refused
const FORBIDDEN = /[\u0000-\u001f\u007f<>:"|?*\\]/;

/**
 * Whether a path from a backup may be written at all: relative, with `/`
 * only, no `.` or `..` parts, no drive letters or streams (`:`), and no name
 * Windows can't hold (`CON`, a trailing dot or space). Every file on every
 * system Conch runs on can be named this way, so nothing real is lost.
 */
export function validRelPath(path: string): boolean {
  if (!path || path.length > BACKUP_LIMITS.maxPath || path.startsWith('/')) return false;
  return path
    .split('/')
    .every(
      (part) =>
        part !== '' &&
        part !== '.' &&
        part !== '..' &&
        !FORBIDDEN.test(part) &&
        !/[. ]$/.test(part) &&
        !WINDOWS_RESERVED.test(part),
    );
}

/**
 * `root` + a path from a backup, one `safeJoin` per part, and checked once
 * more to be inside `root`. Throws on anything that could land elsewhere.
 */
export function safeJoinPath(root: string, path: string): string {
  if (!validRelPath(path)) throw new Error(`Unsafe path in a backup: ${JSON.stringify(path)}`);
  let joined = root;
  for (const part of path.split('/')) joined = safeJoin(joined, part);
  const inside = relative(resolve(root), resolve(joined));
  if (!inside || inside.startsWith('..') || isAbsolute(inside))
    throw new Error(`Unsafe path in a backup: ${JSON.stringify(path)}`);
  return joined;
}
