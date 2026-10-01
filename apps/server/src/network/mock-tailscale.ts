/**
 * A pretend Tailscale for the mock engine (`pnpm dev:mock`, e2e): signed in,
 * with the secure address off until someone presses Turn on. It never runs
 * the real program, so tests don't change this computer's tailnet.
 */
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type { TailscaleDeps } from './tailscale';

export function pretendTailscale(): Pick<TailscaleDeps, 'binary' | 'exec' | 'spawn'> {
  let serving = false;
  const name = 'conch-studio.tail1234.ts.net';
  return {
    binary: () => '/pretend/tailscale',
    exec: async (_file, args) => {
      if (args[0] === 'status')
        return {
          stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${name}.` } }),
          stderr: '',
          code: 0,
        };
      if (args[0] === 'serve' && args[1] === 'status')
        return {
          stdout: JSON.stringify(
            serving
              ? { Web: { [`${name}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:0' } } } } }
              : {},
          ).replace(':0', `:${process.env.CONCH_PORT ?? '4317'}`),
          stderr: '',
          code: 0,
        };
      return { stdout: '', stderr: '', code: 0 };
    },
    spawn: (() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => true,
      });
      setTimeout(() => {
        serving = true;
        child.emit('close', 0);
      }, 50);
      return child;
    }) as unknown as typeof spawn,
  };
}
