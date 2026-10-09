/**
 * Which chat a request belongs to, in a form only a provider's prompt cache
 * can use (ADR 0085, amendment of 2026-10-09).
 *
 * Some providers route requests to the same cache when they're told they
 * belong together: OpenAI, Mistral and Cerebras by `prompt_cache_key`, xAI by
 * the `x-grok-conv-id` header. The key Conch sends is an HMAC of the chat's
 * id (or, for a small job such as naming a chat, of the job's instructions)
 * under a random salt made once per install. It says nothing about the person:
 * it can't be turned back into the id, and two installs never share one.
 *
 * The salt lives beside the transcripts, `api-sessions/cache-key.salt`. Losing
 * it costs nothing but a cache that warms again, so a disk that refuses it
 * gets a salt for this run instead, and nothing ever fails for it.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeFileAtomic } from '../../lib/fs';
import { sessionsDir } from './session';

/** The salt's file, in `api-sessions`. */
export const SALT_FILE = 'cache-key.salt';

/** One salt per home, shared by every provider's engine in this process. */
const salts = new Map<string, Promise<Buffer>>();

async function loadSalt(dir: string): Promise<Buffer> {
  const path = join(dir, SALT_FILE);
  try {
    const kept = await readFile(path);
    if (kept.length >= 16) return kept;
  } catch {
    // None yet, or unreadable: a new one.
  }
  const fresh = randomBytes(32);
  await writeFileAtomic(path, fresh).catch(() => undefined);
  return fresh;
}

function saltFor(home: string): Promise<Buffer> {
  const dir = sessionsDir(home);
  let salt = salts.get(dir);
  if (!salt) {
    salt = loadSalt(dir);
    salts.set(dir, salt);
  }
  return salt;
}

/** A chat's key: the same on every request of the chat, different for every other chat. */
export async function chatCacheKey(home: string, conversationId: string): Promise<string> {
  return keyed(await saltFor(home), `chat\u0000${conversationId}`);
}

/**
 * A small job's key: jobs with the same instructions (every chat title, every
 * summary) share one, because they share the cached prefix too.
 */
export async function jobCacheKey(home: string, system: string): Promise<string> {
  return keyed(await saltFor(home), `job\u0000${system}`);
}

/** 32 URL-safe characters: within every provider's limit (Cerebras allows 1,024). */
function keyed(salt: Buffer, scope: string): string {
  return createHmac('sha256', salt).update(scope, 'utf8').digest('base64url').slice(0, 32);
}
