import { randomUUID } from 'node:crypto';

/** Short, prefixed, URL-safe ids: `c_1a2b3c4d5e6f`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
