/**
 * Publishing for the mock engine (`pnpm dev:mock`, e2e): the same steps a
 * person sees — GitHub's code, then uploading, then published — without ever
 * running `gh`. A developer pressing **Publish on GitHub** while trying Conch
 * out must never make a real repository with the sign-in on their machine.
 */
import type { PublishState } from '@conch/protocol';

import { DEVICE_URL } from './publish';
import type { Publisher } from './types';

export function createPretendPublisher(options: { stepMs?: number } = {}): Publisher {
  const step = options.stepMs ?? 1_500;
  const states = new Map<string, PublishState>();
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timer.unref();
    timers.add(timer);
  };
  return {
    state: (appId) => states.get(appId) ?? { state: 'idle' },
    async publish(app) {
      const now = states.get(app.id);
      if (now && (now.state === 'needs-sign-in' || now.state === 'publishing')) return now;
      const signIn: PublishState = { state: 'needs-sign-in', code: 'CONC-H123', url: DEVICE_URL };
      states.set(app.id, signIn);
      later(step, () => {
        states.set(app.id, { state: 'publishing', step: 'Uploading' });
        later(step, () =>
          states.set(app.id, {
            state: 'published',
            url: `https://github.com/conch-mock/${app.id}`,
            version: app.manifest.version,
          }),
        );
      });
      return signIn;
    },
  };
}
