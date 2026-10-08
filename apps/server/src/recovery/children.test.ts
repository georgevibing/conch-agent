import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { watchGateway } from './watchdog';
import { gatewayChildren, serviceChildren } from './children';

async function running(pid: number): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch {
    return false;
  }
}
async function pidMessage(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture did not start')), 5_000);
    child.once('error', reject);
    child.once('message', (value: { pid: number }) => {
      clearTimeout(timer);
      resolve(value.pid);
    });
  });
}

describe.skipIf(process.platform !== 'linux')('gateway descendant cleanup', () => {
  it.each([false, true])(
    'cleans up a surviving child on gateway exit (detached=%s)',
    async (detached) => {
      const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      });
      const gateway = spawn(
        process.execPath,
        [
          '-e',
          `
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: ${detached}, stdio: 'ignore'
      });
      process.send({pid: child.pid});
      setInterval(() => {}, 1000);
    `,
        ],
        { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
      );
      const watchdog = watchGateway(gateway, {
        processGroup: true,
        stopping: () => false,
        incident: () => {},
        repaired: () => {},
      });
      let descendant: number | undefined;
      try {
        descendant = await pidMessage(gateway);
        // Let the independent tracker observe detached ancestry before the parent dies.
        await delay(1_150);
        expect(await running(descendant)).toBe(true);
        const exited = new Promise<void>((resolve) =>
          gateway.once('exit', () => {
            watchdog.close();
            resolve();
          }),
        );
        gateway.kill('SIGKILL');
        await exited;
        for (let tries = 0; tries < 100 && (await running(descendant)); tries++) await delay(10);
        expect(await running(descendant)).toBe(false);
        expect(unrelated.pid).toBeDefined();
        expect(await running(unrelated.pid ?? 0)).toBe(true);
      } finally {
        watchdog.close();
        gateway.kill('SIGKILL');
        unrelated.kill('SIGKILL');
        if (descendant && (await running(descendant))) process.kill(descendant, 'SIGKILL');
      }
    },
  );

  it('cleans up descendants when a gateway cannot process shutdown', async () => {
    const gateway = spawn(
      process.execPath,
      [
        '-e',
        `
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
      process.send({pid: child.pid});
      while (true) {}
    `,
      ],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    const watch = watchGateway(gateway, {
      processGroup: true,
      startupMs: 500,
      recoverMs: 20,
      stopMs: 20,
      pollMs: 10,
      stopping: () => false,
      incident: () => {},
      repaired: () => {},
    });
    let descendant: number | undefined;
    try {
      descendant = await pidMessage(gateway);
      await new Promise<void>((resolve) =>
        gateway.once('exit', () => {
          watch.close();
          resolve();
        }),
      );
      for (let tries = 0; tries < 100 && (await running(descendant)); tries++) await delay(10);
      expect(watch.failed()).toBe(true);
      expect(await running(descendant)).toBe(false);
    } finally {
      watch.close();
      gateway.kill('SIGKILL');
      if (descendant && (await running(descendant))) process.kill(descendant, 'SIGKILL');
    }
  });
});

describe.skipIf(process.platform !== 'linux')('process identity boundaries', () => {
  function stat(pid: number, parent: number, started: number) {
    return `${pid} (a name with ) brackets) S ${parent} ${'0 '.repeat(17)}${started} 0`;
  }
  it('does not signal a reused PID or a process outside the gateway ancestry', () => {
    const files: Record<string, string> = {
      '/proc/101/stat': stat(101, 100, 1),
      '/proc/101/task/101/children': '102 103',
      '/proc/102/stat': stat(102, 101, 2),
      '/proc/102/task/102/children': '',
      '/proc/103/stat': stat(103, 999, 3),
    };
    const signal = vi.fn();
    const tree = gatewayChildren(101, false, {
      read: (path) => {
        const text = files[path];
        if (text === undefined) throw new Error('gone');
        return text;
      },
      signal,
    });
    delete files['/proc/101/stat'];
    files['/proc/102/stat'] = stat(102, 999, 200);
    tree.close();
    tree.close();
    expect(signal).not.toHaveBeenCalled();
  });

  it('retains verified descendants after reparenting and discovers their children', () => {
    const files: Record<string, string> = {
      '/proc/101/stat': stat(101, 100, 1),
      '/proc/101/task/101/children': '102',
      '/proc/102/stat': stat(102, 101, 2),
      '/proc/102/task/102/children': '',
    };
    const signal = vi.fn();
    const tree = gatewayChildren(101, false, {
      read: (path) => {
        const text = files[path];
        if (text === undefined) throw new Error('gone');
        return text;
      },
      signal,
    });
    delete files['/proc/101/stat'];
    files['/proc/102/stat'] = stat(102, 1, 2);
    files['/proc/102/task/102/children'] = '104';
    files['/proc/104/stat'] = stat(104, 102, 4);
    tree.close();
    expect(signal.mock.calls).toEqual([
      [104, 'SIGKILL'],
      [102, 'SIGKILL'],
    ]);
  });
});

describe.skipIf(process.platform !== 'linux')(
  'systemd ownership catches escaped descendants',
  () => {
    const folder = '/sys/fs/cgroup/app.slice/conch.service';
    const stat = (pid: number, parent: number, start: number) =>
      `${pid} (test) S ${parent} ${'0 '.repeat(17)}${start} 0`;
    function fixture() {
      const files: Record<string, string> = {
        '/proc/self/cgroup': '0::/app.slice/conch.service',
        '/proc/self/mountinfo': '1 2 0:3 / /sys/fs/cgroup rw - cgroup2 cgroup rw',
        [folder + '/cgroup.procs']: '101 102',
        '/proc/101/stat': stat(101, 1, 1),
        '/proc/102/stat': stat(102, 101, 2),
      };
      const read = (path: string) => {
        const text = files[path];
        if (text === undefined) throw new Error('gone');
        return text;
      };
      return { files, read };
    }
    it('finds a double-forked child without touching the supervisor or its existing helpers', () => {
      const { files, read } = fixture();
      const members = serviceChildren('conch.service', read, 101);
      expect(members).toBeDefined();
      files[folder + '/cgroup.procs'] = '101 102 103 104';
      files['/proc/103/stat'] = stat(103, 101, 3);
      files['/proc/103/task/103/children'] = '';
      files['/proc/104/stat'] = stat(104, 1, 4);
      const signal = vi.fn();
      const tree = gatewayChildren(103, false, { read, signal, serviceMembers: members });
      delete files['/proc/103/stat'];
      tree.close();
      expect(signal.mock.calls).toEqual([[104, 'SIGKILL']]);
    });
    it('rejects shared slices, another service and a boundary that does not contain this supervisor', () => {
      const { files, read } = fixture();
      expect(serviceChildren('different.service', read, 101)).toBeUndefined();
      files['/proc/self/cgroup'] = '0::/app.slice';
      expect(serviceChildren('conch.service', read, 101)).toBeUndefined();
      expect(serviceChildren('app.slice', read, 101)).toBeUndefined();
      files['/proc/self/cgroup'] = '0::/app.slice/conch.service';
      files[folder + '/cgroup.procs'] = '999';
      expect(serviceChildren('conch.service', read, 101)).toBeUndefined();
    });
    it('stops trusting an old helper PID after its identity changes', () => {
      const { files, read } = fixture();
      const members = serviceChildren('conch.service', read, 101);
      files['/proc/102/stat'] = stat(102, 1, 99);
      expect(members?.()).toEqual([102]);
    });
  },
);
