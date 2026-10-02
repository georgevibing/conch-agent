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
  /** The public door's Funnel, once someone turned it on: `{port, path, target}`. */
  let funnel: { port: number; path: string; target: string } | undefined;
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
      if (args[0] === 'serve' && args[1] === 'status') {
        const web: Record<string, { Handlers: Record<string, { Proxy: string }> }> = {};
        if (serving)
          web[`${name}:443`] = {
            Handlers: { '/': { Proxy: `http://127.0.0.1:${process.env.CONCH_PORT ?? '4317'}` } },
          };
        if (funnel)
          web[`${name}:${funnel.port}`] = { Handlers: { [funnel.path]: { Proxy: funnel.target } } };
        return {
          stdout: JSON.stringify({
            Web: web,
            ...(funnel && { AllowFunnel: { [`${name}:${funnel.port}`]: true } }),
          }),
          stderr: '',
          code: 0,
        };
      }
      if (args[0] === 'funnel' && args.at(-1) === 'off') funnel = undefined;
      return { stdout: '', stderr: '', code: 0 };
    },
    spawn: ((_file: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => true,
      });
      setTimeout(() => {
        if (args[0] === 'funnel') {
          const port = Number(
            /^--https=(\d+)$/.exec(args.find((a) => a.startsWith('--https=')) ?? '')?.[1] ?? 443,
          );
          const path = args.find((a) => a.startsWith('--set-path='))?.slice(11) ?? '/';
          funnel = { port, path, target: args.at(-1) ?? '' };
        } else serving = true;
        child.emit('close', 0);
      }, 50);
      return child;
    }) as unknown as typeof spawn,
  };
}
