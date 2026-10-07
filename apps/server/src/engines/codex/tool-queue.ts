/**
 * Codex may ask for several dynamic tools at once (ADR 0095). A waiting browser
 * must not hold up independent reads, but writes and unknown tools stay ordered.
 * Names are Conch's internal display names, never descriptions or annotations
 * supplied by an external tool. Guards still run inside each queued callback.
 */
const READS = new Set([
  'Read',
  'mcp__conch__current_time',
  'LS',
  'mcp__conch__read_file',
  'mcp__conch__read_document',
  'mcp__conch__search_files',
  'mcp__conch__web_fetch',
  'mcp__conch__web_search',
]);

export class ToolQueue {
  #reads: Promise<void> = Promise.resolve();
  #browser: Promise<void> = Promise.resolve();
  #barrier: Promise<void> = Promise.resolve();

  run(name: string | undefined, work: () => Promise<void>): Promise<void> {
    const read = name !== undefined && READS.has(name);
    const browser = name?.startsWith('mcp__conch__browser_') ?? false;
    const before = read
      ? [this.#reads, this.#barrier]
      : [this.#reads, this.#browser, this.#barrier];
    const job = Promise.all(before).then(work);
    // A failed tool is still a completed predecessor; callers receive its error.
    const settled = job.catch(() => {});
    if (read) this.#reads = settled;
    else if (browser) this.#browser = settled;
    else this.#barrier = settled;
    return job;
  }
}
