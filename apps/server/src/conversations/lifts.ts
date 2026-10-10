/**
 * Which chats lifted each class of step with Always allow (ADR 0128), kept in
 * `auto-lifts.json` under Conch's home. A card for a class the person already
 * lifted in another chat offers Always allow for every chat; the answer itself
 * lives in `preferences.autoAllowed`, never here. Derived: a backup doesn't
 * carry it, and losing it only means the offer comes one chat later.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

const File = z.object({
  version: z.literal(1),
  /** Each class, with the chats that lifted it, newest last. */
  lifts: z.record(z.string(), z.array(z.string()).max(8)),
});

/** How many chats are remembered per class: the offer needs one other, not a history. */
const CHATS_KEPT = 8;

export class AutoLifts {
  readonly #path: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(home: string) {
    this.#path = join(home, 'auto-lifts.json');
  }

  /** The chats that lifted this class, by id. */
  async seen(cls: string): Promise<string[]> {
    const file = await this.#read();
    return file.lifts[cls] ?? [];
  }

  /** This chat lifted the class (the person pressed Always allow on its card). */
  note(cls: string, conversationId: string): Promise<void> {
    const run = this.#queue.then(async () => {
      const file = await this.#read();
      const chats = (file.lifts[cls] ?? []).filter((id) => id !== conversationId);
      chats.push(conversationId);
      file.lifts[cls] = chats.slice(-CHATS_KEPT);
      await this.#write(file);
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #read(): Promise<z.infer<typeof File>> {
    try {
      const parsed = File.safeParse(JSON.parse(await readFile(this.#path, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      /* Missing or unreadable: nothing lifted yet. */
    }
    return { version: 1, lifts: {} };
  }

  async #write(file: z.infer<typeof File>): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    await rename(tmp, this.#path);
  }
}
