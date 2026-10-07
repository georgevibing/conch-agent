import type { HostTool } from '../engines/types';

/** A host-owned observation: task wrappers receipt the exact returned sample. */
export function currentTimeTool(now: () => number = Date.now): HostTool {
  return {
    name: 'current_time',
    description:
      'Read the current UTC time from this computer. Use for time checks; Conch records the observation in task evidence.',
    effect: 'read',
    alwaysLoad: true,
    input: {},
    async run() {
      const seconds = Math.floor(now() / 1000);
      return JSON.stringify({
        current_time: new Date(seconds * 1000)
          .toISOString()
          .replace('T', ' ')
          .replace('.000Z', ' UTC'),
        current_time_at: seconds,
      });
    },
  };
}
