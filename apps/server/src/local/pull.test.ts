import { describe, expect, it } from 'vitest';

import { explainPull, phaseOf, PullMeter } from './pull';

describe('a model download, as it goes', () => {
  it('adds every layer up, and works out the speed and the time left', () => {
    let now = 0;
    const meter = new PullMeter(() => now);
    meter.update({ status: 'pulling manifest' });
    expect(meter.phase).toBe('Getting ready');
    expect(meter.totalBytes).toBeUndefined();

    // The weights, then the small layers (template, licence), as Ollama sends them.
    meter.update({
      status: 'pulling dde5aa3fc5ff',
      digest: 'sha256:dde5',
      total: 2_000_000_000,
      completed: 0,
    });
    meter.update({
      status: 'pulling 966de95ca8a6',
      digest: 'sha256:966d',
      total: 1_400,
      completed: 1_400,
    });
    now = 2_000;
    meter.update({
      status: 'pulling dde5aa3fc5ff',
      digest: 'sha256:dde5',
      total: 2_000_000_000,
      completed: 200_000_000,
    });
    now = 4_000;
    meter.update({
      status: 'pulling dde5aa3fc5ff',
      digest: 'sha256:dde5',
      total: 2_000_000_000,
      completed: 400_000_000,
    });

    expect(meter.phase).toBe('Downloading');
    expect(meter.totalBytes).toBe(2_000_001_400);
    expect(meter.completedBytes).toBe(400_001_400);
    expect(meter.bytesPerSecond).toBeCloseTo(100_000_000, -3);
    expect(meter.secondsLeft).toBe(16);

    const snapshot = meter.snapshot({ model: 'llama3.2:3b', label: 'Llama 3.2', state: 'pulling' });
    expect(snapshot).toMatchObject({
      phase: 'Downloading',
      completedBytes: 400_001_400,
      totalBytes: 2_000_001_400,
      secondsLeft: 16,
    });

    meter.update({ status: 'verifying sha256 digest' });
    expect(meter.phase).toBe('Checking the download');
    meter.update({ status: 'writing manifest' });
    meter.update({ status: 'removing unused layers' });
    expect(meter.phase).toBe('Almost done');
    expect(meter.done).toBe(false);
    meter.update({ status: 'success' });
    expect(meter.done).toBe(true);
  });

  it('keeps the bytes when paused, and forgets the speed', () => {
    let now = 0;
    const meter = new PullMeter(() => now);
    meter.update({ digest: 'a', total: 1_000, completed: 100 });
    now = 5_000;
    meter.update({ digest: 'a', total: 1_000, completed: 600 });
    const paused = meter.snapshot({ model: 'm', label: 'M', state: 'paused' });
    expect(paused).toMatchObject({ phase: 'Paused', completedBytes: 600 });
    expect(paused.bytesPerSecond).toBeUndefined();
    expect(paused.secondsLeft).toBeUndefined();
    meter.resume();
    expect(meter.bytesPerSecond).toBeUndefined();
    expect(meter.completedBytes).toBe(600);
  });

  it('never counts more than a layer holds', () => {
    const meter = new PullMeter(() => 0);
    meter.update({ digest: 'a', total: 100, completed: 250 });
    expect(meter.completedBytes).toBe(100);
  });

  it('names each step in plain words', () => {
    expect(phaseOf('pulling manifest')).toBe('Getting ready');
    expect(phaseOf('pulling 4f659a1e86d7')).toBe('Downloading');
    expect(phaseOf('verifying sha256 digest')).toBe('Checking the download');
    expect(phaseOf('writing manifest')).toBe('Almost done');
    expect(phaseOf('success')).toBe('Done');
  });

  it('explains a failed download in words a person can act on', () => {
    expect(explainPull('pull model manifest: file does not exist', 'Qwen3 4B')).toBe(
      'Qwen3 4B isn’t available to download right now.',
    );
    expect(
      explainPull(
        'Get "https://registry.ollama.ai/v2/…": dial tcp: lookup registry.ollama.ai: no such host',
        'Qwen3 4B',
      ),
    ).toMatch(/internet seems to be unreachable\. It picks up where it left off/);
    expect(
      explainPull('write /models/blobs/sha256-x-partial: no space left on device', 'Qwen3 4B'),
    ).toMatch(/isn’t enough disk space/);
  });
});
