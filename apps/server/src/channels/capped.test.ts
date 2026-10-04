import { describe, expect, it } from 'vitest';

import { capOf, ChannelError, readCapped } from './types';

/** A body that keeps coming, counting what was pulled from it. */
function endless(chunk = 64 * 1024, chunks = 1_000) {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled > chunks) controller.close();
      else controller.enqueue(new Uint8Array(chunk));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, pulled: () => pulled, cancelled: () => cancelled };
}

describe('downloads with a cap (ADR 0077)', () => {
  it('stops a download the moment it passes the cap, whatever size it declared', async () => {
    const stream = endless();
    // The app says it's small; it isn't.
    const response = new Response(stream.body, { headers: { 'content-length': '10' } });
    await expect(readCapped(response, 1024 * 1024)).rejects.toBeInstanceOf(ChannelError);
    // Stopped just past one megabyte, not after all 64 of them.
    expect(stream.pulled()).toBeLessThan(25);
    expect(stream.cancelled()).toBe(true);
  });

  it('refuses at once when the size it declares is already too big', async () => {
    const stream = endless();
    const response = new Response(stream.body, { headers: { 'content-length': '999999999' } });
    await expect(readCapped(response, 1024)).rejects.toThrow(/too big/);
    expect(stream.pulled()).toBeLessThan(3);
  });

  it('reads a file within the cap whole', async () => {
    const bytes = await readCapped(new Response(new Uint8Array(5000)), 5000);
    expect(bytes.length).toBe(5000);
  });

  it('takes the smaller of the app’s limit and the caller’s', () => {
    expect(capOf(25, { maxBytes: 20 })).toBe(20);
    expect(capOf(25, { maxBytes: 30 })).toBe(25);
    expect(capOf(25)).toBe(25);
  });
});
