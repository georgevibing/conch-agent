import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { cgroupFolders } from './cgroup';

interface Identity {
  pid: number;
  parent: number;
  started: string;
}

/** Only kernel identity fields. Never read commands, environments or credentials. */
function identity(pid: number, read: (path: string) => string): Identity | undefined {
  try {
    const stat = read(`/proc/${pid}/stat`);
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    const parent = Number(fields[1]);
    const started = fields[19];
    if (Number.isSafeInteger(parent) && started && /^\d+$/.test(started))
      return { pid, parent, started };
  } catch {
    // Already exited, or this host does not expose process identities.
  }
}

/**
 * systemd's service boundary survives double-forking and setsid. Capture the
 * supervisor's existing helpers BEFORE spawn; all new members belong to its
 * gateway. Never apply this to a login session, app slice or another service.
 */
export function serviceChildren(
  unit: string,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  self = process.pid,
): (() => number[]) | undefined {
  if (process.platform !== 'linux' || !unit.endsWith('.service') || unit.includes('/')) return;
  try {
    const folder = cgroupFolders(read('/proc/self/cgroup'), read('/proc/self/mountinfo'))[0];
    if (!folder || posix.basename(folder) !== unit) return;
    const members = () =>
      read(`${folder}/cgroup.procs`)
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((pid) => Number.isSafeInteger(pid) && pid > 1);
    const initial = members();
    if (!initial.includes(self)) return;
    const baseline = new Map<number, string>();
    for (const pid of initial) {
      const entry = identity(pid, read);
      if (!entry) return;
      baseline.set(pid, entry.started);
    }
    return () => {
      try {
        return members().filter(
          (pid) =>
            pid !== self &&
            (!baseline.has(pid) || baseline.get(pid) !== identity(pid, read)?.started),
        );
      } catch {
        return [];
      }
    };
  } catch {
    return;
  }
}

/**
 * One gateway's children, observed by its supervisor while they still have a
 * parent. Remember detached descendants across reparenting and reject PID reuse.
 * POSIX process groups cover even short-lived parents between Linux observations.
 */
export function gatewayChildren(
  pid: number,
  processGroup: boolean,
  deps: {
    read?: (path: string) => string;
    signal?: (pid: number, signal: NodeJS.Signals) => unknown;
    serviceMembers?: () => number[];
  } = {},
) {
  const read = deps.read ?? ((path: string) => readFileSync(path, 'utf8'));
  const signal =
    deps.signal ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  const owned = new Map<number, Identity>();
  const linux = process.platform === 'linux';
  const root = linux ? identity(pid, read) : undefined;
  let closed = false;
  const same = (entry: Identity) => identity(entry.pid, read)?.started === entry.started;
  const sample = () => {
    if (!linux || !root || closed) return;
    for (const [id, entry] of owned) if (!same(entry)) owned.delete(id);
    for (const id of deps.serviceMembers?.() ?? []) {
      if (owned.size >= 4096) break;
      if (id === pid || id === process.pid) continue;
      const entry = identity(id, read);
      if (entry) owned.set(id, entry);
    }
    const queue = [...(same(root) ? [root] : []), ...owned.values()];
    const visited = new Set<number>();
    for (let i = 0; i < queue.length && visited.size < 4096; i++) {
      const parent = queue[i];
      if (!parent || visited.has(parent.pid) || !same(parent)) continue;
      visited.add(parent.pid);
      try {
        const text = read(`/proc/${parent.pid}/task/${parent.pid}/children`);
        for (const word of text.trim().split(/\s+/)) {
          if (owned.size >= 4096) break;
          const id = Number(word);
          if (!Number.isSafeInteger(id) || id <= 1 || id === pid || id === process.pid) continue;
          const child = identity(id, read);
          if (!child || child.parent !== parent.pid || !same(parent)) continue;
          owned.set(id, child);
          queue.push(child);
        }
      } catch {
        // The process may have finished between observations.
      }
    }
  };
  sample();
  const timer = linux ? setInterval(sample, 1_000).unref() : undefined;
  return {
    /** Refresh before requesting shutdown while ancestry is still available. */
    sample,
    close: () => {
      if (closed) return;
      sample();
      closed = true;
      clearInterval(timer);
      if (processGroup && process.platform !== 'win32') {
        try {
          signal(-pid, 'SIGKILL');
        } catch {
          // Its process group is already gone.
        }
      }
      for (const entry of [...owned.values()].reverse()) {
        if (!same(entry)) continue;
        try {
          signal(entry.pid, 'SIGKILL');
        } catch {
          // Already gone. Never retry a numeric PID without checking its identity.
        }
      }
      owned.clear();
    },
  };
}
