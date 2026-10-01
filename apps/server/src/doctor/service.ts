/**
 * Repair everything (AGENTS.md agreement 11).
 *
 * Every part of Conch that can break registers a `DoctorCheck` here — see
 * `checks.ts` for the built-in ones, and AGENTS.md for when a new feature must
 * add its own. A look runs every check at once, and the report fills in as
 * each part answers; a repair asks each check to try every safe fix it knows
 * first. Nothing here is destructive and nothing asks anyone: what only a
 * person can do comes back as one action on the item.
 */
import type { DoctorItem, DoctorReport } from '@conch/protocol';

export interface DoctorCheck {
  /** Stable, and the prefix of its items' ids: `providers`. */
  id: string;
  /** The group its items appear under: "Providers". */
  group: string;
  /** What it looks at, for the row shown while it does: "Your providers". */
  title: string;
  /**
   * Look — and with `repair`, try every safe fix first. Never destructive (no
   * wiping, no signing out), never asks anyone, and says what it fixed by
   * returning `fixed` items. May return no items when there's nothing to say.
   */
  run(options: { repair: boolean; signal: AbortSignal }): Promise<DoctorItem[]>;
}

export interface DoctorDeps {
  /** Tells the page as the report fills in (`doctor.report` event). */
  emit: (report: DoctorReport) => void;
  /** Leaves a “fixed on its own” note for each thing a repair fixed. */
  onHeal?: (message: string) => void;
  /** Longest one check may take before it's reported as not answering. */
  timeoutMs?: number;
}

const CHECK_TIMEOUT_MS = 30_000;

export class Doctor {
  #checks: DoctorCheck[] = [];
  #report: DoctorReport = { items: [], checkedAt: 0, running: false, repaired: false };
  #running?: { repair: boolean; done: Promise<DoctorReport> };
  /** A repair asked for while a look was running: it goes next. */
  #queued?: Promise<DoctorReport>;

  constructor(private readonly deps: DoctorDeps) {}

  /** Add a check. Ids are unique: registering one again replaces it. */
  register(check: DoctorCheck): void {
    this.#checks = [...this.#checks.filter((c) => c.id !== check.id), check];
  }

  checks(): readonly DoctorCheck[] {
    return this.#checks;
  }

  get report(): DoctorReport {
    return this.#report;
  }

  /**
   * Look at everything (or repair it). Single-flight: a look joins a running
   * run; a repair asked for during a look runs right after it.
   */
  run(options: { repair?: boolean } = {}): Promise<DoctorReport> {
    const repair = options.repair ?? false;
    const running = this.#running;
    if (running && (running.repair || !repair)) return running.done;
    if (running) {
      this.#queued ??= running.done.then(() => {
        this.#queued = undefined;
        return this.run({ repair: true });
      });
      return this.#queued;
    }
    const done = this.#run(repair).finally(() => (this.#running = undefined));
    this.#running = { repair, done };
    return done;
  }

  /**
   * Look at one check again, after what it watches changed (Passwords
   * unlocked), so the report never says something that's no longer true.
   * Only once there's a report to correct, and never in the middle of a run.
   */
  async refresh(checkId: string): Promise<void> {
    if (this.#running || !this.#report.checkedAt) return;
    const check = this.#checks.find((c) => c.id === checkId);
    if (!check) return;
    const items = await check
      .run({ repair: false, signal: AbortSignal.timeout(this.deps.timeoutMs ?? CHECK_TIMEOUT_MS) })
      .catch(() => undefined);
    if (!items || this.#running) return;
    const before = this.#report.items;
    const ours = (item: DoctorItem) => item.id === checkId || item.id.startsWith(`${checkId}:`);
    const at = before.findIndex(ours);
    const rest = before.filter((item) => !ours(item));
    this.#report = {
      ...this.#report,
      items: at < 0 ? [...rest, ...items] : [...rest.slice(0, at), ...items, ...rest.slice(at)],
    };
    this.deps.emit(this.#report);
  }

  async #run(repair: boolean): Promise<DoctorReport> {
    const checks = this.#checks;
    const results = new Map<string, DoctorItem[]>();
    const placeholder = (check: DoctorCheck): DoctorItem => ({
      id: `${check.id}:checking`,
      group: check.group,
      title: check.title,
      state: 'checking',
      message: repair ? 'Repairing…' : 'Looking…',
    });
    // Items keep the checks' order, whatever order they answer in.
    const items = () => checks.flatMap((check) => results.get(check.id) ?? [placeholder(check)]);
    const publish = (running: boolean) => {
      this.#report = {
        items: items(),
        checkedAt: running ? this.#report.checkedAt : Date.now(),
        running,
        repaired: repair,
      };
      this.deps.emit(this.#report);
    };
    publish(true);

    await Promise.all(
      checks.map(async (check) => {
        const controller = new AbortController();
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('It didn’t answer in time.'));
          }, this.deps.timeoutMs ?? CHECK_TIMEOUT_MS);
        });
        try {
          const found = await Promise.race([
            check.run({ repair, signal: controller.signal }),
            timeout,
          ]);
          results.set(check.id, found);
        } catch (error) {
          results.set(check.id, [
            {
              id: `${check.id}:unchecked`,
              group: check.group,
              title: check.title,
              state: 'warning',
              message: `Conch couldn’t check this: ${(error as Error).message}`,
            },
          ]);
        } finally {
          clearTimeout(timer);
        }
        publish(true);
      }),
    );

    publish(false);
    if (repair)
      for (const item of this.#report.items)
        if (item.state === 'fixed') this.deps.onHeal?.(`${item.title}: ${item.message}`);
    return this.#report;
  }
}
