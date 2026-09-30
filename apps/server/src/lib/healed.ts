import { join } from 'node:path';

import { HealLog, type HealArea, type HealNote } from '@conch/protocol';

import { readJson, writeJson } from './fs';
import { newId } from './ids';

/** Enough to see what happened lately; older notes stop mattering. */
const KEPT = 40;
/** The same repair repeating (a flaky server) is one note, refreshed. */
const SAME_WITHIN_MS = 10 * 60_000;

/**
 * What Conch fixed on its own, newest first, kept in `~/.conch/healed.json` so
 * a repair made while starting up (a settings file set aside) is still there
 * to read once you open Conch. Never throws: a note must not break the repair
 * it describes.
 */
export class Healed {
  #notes: HealNote[] = [];
  #loaded?: Promise<void>;
  #saving = Promise.resolve();

  constructor(
    private readonly home: string,
    private readonly emit: (note: HealNote) => void = () => undefined,
  ) {}

  #path() {
    return join(this.home, 'healed.json');
  }

  #load(): Promise<void> {
    this.#loaded ??= readJson<unknown>(this.#path())
      .then((raw) => {
        const parsed = HealLog.safeParse(raw);
        // A note log that won't read is just started again: it's only reassurance.
        this.#notes = parsed.success ? parsed.data.notes : [];
      })
      .catch(() => undefined);
    return this.#loaded;
  }

  async list(): Promise<HealNote[]> {
    await this.#load();
    return this.#notes;
  }

  /** Say what was fixed, in one plain sentence. */
  async note(area: HealArea, message: string): Promise<HealNote> {
    await this.#load();
    const now = Date.now();
    const same = this.#notes.find(
      (n) => n.area === area && n.message === message && now - n.at < SAME_WITHIN_MS,
    );
    const note: HealNote = same
      ? { ...same, at: now }
      : { id: newId('heal'), at: now, area, message };
    this.#notes = [note, ...this.#notes.filter((n) => n !== same)].slice(0, KEPT);
    this.#saving = this.#saving
      .then(() => writeJson(this.#path(), { notes: this.#notes }))
      .catch(() => undefined);
    await this.#saving;
    try {
      this.emit(note);
    } catch {
      // Telling the page is best effort.
    }
    return note;
  }
}
