import { readFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';

export interface CgroupMemory {
  limitBytes?: number;
  availableBytes?: number;
  pressure?: number;
}

type Reader = (path: string) => Promise<string>;
const read: Reader = (path) =>
  readFile(path, { encoding: 'utf8', signal: AbortSignal.timeout(1_000) });
const unescapeMount = (text: string) =>
  text.replace(/\\(040|011|012|134)/g, (_match, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  );

/** Kernel paths only. Resolve the visible mount, including a namespaced root. */
export function cgroupFolders(membership: string, mounts: string): string[] {
  const path = /^0::([^\n]+)$/m.exec(membership)?.[1];
  if (!path?.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.'))
    return [];
  for (const line of mounts.split('\n')) {
    const [left, right] = line.split(' - ');
    if (!right?.startsWith('cgroup2 ')) continue;
    const fields = left?.split(' ') ?? [];
    const root = unescapeMount(fields[3] ?? '');
    const mount = unescapeMount(fields[4] ?? '');
    if (!mount.startsWith('/') || !root.startsWith('/')) continue;
    const relative =
      root === '/'
        ? path
        : path === root || path === '/'
          ? '/'
          : path.startsWith(root + '/')
            ? path.slice(root.length)
            : undefined;
    if (relative === undefined) continue;
    let folder = posix.join(mount, relative).replace(/\/+$/, '') || '/';
    const folders: string[] = [];
    for (let depth = 0; depth < 64; depth++) {
      folders.push(folder);
      if (folder === mount) return folders;
      folder = dirname(folder);
    }
    // Never partially read a hierarchy and advertise headroom we haven't checked.
    throw new Error('The memory hierarchy is too deep to check.');
  }
  return [];
}

function bytes(text: string | undefined): number | undefined {
  if (!text || !/^\d+\s*$/.test(text)) return;
  const number = Number(text.trim());
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

/** Include every ancestor's shared budget, not only the gateway's leaf cgroup. */
export async function cgroupMemory(reader: Reader = read): Promise<CgroupMemory> {
  const [membership, mounts] = await Promise.all([
    reader('/proc/self/cgroup').catch(() => ''),
    reader('/proc/self/mountinfo').catch(() => ''),
  ]);
  const folders = cgroupFolders(membership, mounts);
  const result: CgroupMemory = {};
  for (const folder of folders) {
    const [current, high, maximum, pressure] = await Promise.all(
      ['memory.current', 'memory.high', 'memory.max', 'memory.pressure'].map((file) =>
        reader(posix.join(folder, file)).catch(() => undefined),
      ),
    );
    const used = bytes(current);
    for (const limit of [bytes(high), bytes(maximum)]) {
      if (limit === undefined) continue;
      result.limitBytes = Math.min(result.limitBytes ?? Infinity, limit);
      // A known budget with unreadable usage cannot safely admit new work.
      result.availableBytes = Math.min(
        result.availableBytes ?? Infinity,
        used === undefined ? 0 : Math.max(0, limit - used),
      );
    }
    const full = /^full avg10=([\d.]+)/m.exec(pressure ?? '')?.[1];
    if (full !== undefined && Number.isFinite(Number(full)))
      result.pressure = Math.max(result.pressure ?? 0, Math.min(100, Number(full)));
  }
  return result;
}
