import { join } from 'node:path';

import { ComputerUseApp } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

const ComputerUseFile = z.object({
  version: z.literal(1).default(1),
  /** You turned it on. Off until you do. */
  enabled: z.boolean().default(false),
  /** Apps you said it may always use ("Always" on an app's question). */
  apps: z.array(ComputerUseApp).max(500).default([]),
});
type ComputerUseFile = z.infer<typeof ComputerUseFile>;

/**
 * `~/.conch/computer-use.json`: whether the assistant may use this computer's
 * apps, and the apps you always let it use. Only a person changes either, in
 * Conch (`lib/protect.ts` keeps the assistant's own file tools away). A
 * damaged file goes back to off, with a copy kept.
 */
export class ComputerUseStore {
  #mutex = new Mutex();
  #cache?: Promise<ComputerUseFile>;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get path(): string {
    return join(this.home, 'computer-use.json');
  }

  #read(): Promise<ComputerUseFile> {
    this.#cache ??= readStore(this.path, ComputerUseFile, {
      onRepair: () =>
        this.heal?.('settings', 'Turned off using your apps after its settings were damaged'),
    }).then(
      (read) => read.value,
      () => {
        this.#cache = undefined;
        return ComputerUseFile.parse({});
      },
    );
    return this.#cache;
  }

  #change(change: (file: ComputerUseFile) => ComputerUseFile): Promise<ComputerUseFile> {
    return this.#mutex.run(async () => {
      const next = change(await this.#read());
      this.#cache = Promise.resolve(next);
      await writeJson(this.path, next);
      return next;
    });
  }

  async enabled(): Promise<boolean> {
    return (await this.#read()).enabled;
  }

  async apps(): Promise<ComputerUseApp[]> {
    return (await this.#read()).apps;
  }

  async trusts(id: string): Promise<boolean> {
    return (await this.#read()).apps.some((app) => app.id === id);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.#change((file) => ({ ...file, enabled }));
  }

  async trust(app: ComputerUseApp): Promise<void> {
    await this.#change((file) =>
      file.apps.some((a) => a.id === app.id) ? file : { ...file, apps: [...file.apps, app] },
    );
  }

  async forget(id: string): Promise<void> {
    await this.#change((file) => ({ ...file, apps: file.apps.filter((a) => a.id !== id) }));
  }
}
