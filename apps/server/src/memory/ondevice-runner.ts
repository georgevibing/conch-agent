/**
 * The meaning model's own process (ADR 0041). The gateway starts it when a
 * search first needs the model, and stops it after ten idle minutes, so:
 *
 * - its memory (100 MB for MiniLM, 600 MB for the multilingual model) really
 *   goes back to the computer, which a model unloaded in place doesn't do;
 * - native code reading downloaded files runs away from the gateway, its
 *   keys and its sign-ins: it gets no environment of Conch's, and if it
 *   crashes, only it stops.
 *
 * It speaks over the IPC channel only: `load` once, then `embed`s.
 */
import type { OnDeviceSpec } from './ondevice';
import { loadTransformers, type Runner } from './ondevice-load';

type Message =
  | { type: 'load'; dir: string; spec: OnDeviceSpec }
  | { type: 'embed'; id: number; texts: string[] };

let runner: Runner | undefined;

const send = (message: unknown) => process.send?.(message);

// The gateway went away: so does this.
process.on('disconnect', () => process.exit(0));

process.on('message', (raw: Message) => {
  void (async () => {
    if (raw.type === 'load') {
      try {
        runner = await loadTransformers(raw.dir, raw.spec);
        send({ type: 'ready' });
      } catch (error) {
        send({ type: 'failed', message: (error as Error).message });
      }
      return;
    }
    if (raw.type === 'embed') {
      try {
        if (!runner) throw new Error('The model isn’t loaded.');
        send({ type: 'vectors', id: raw.id, vectors: await runner.embed(raw.texts) });
      } catch (error) {
        send({ type: 'error', id: raw.id, message: (error as Error).message });
      }
    }
  })();
});
