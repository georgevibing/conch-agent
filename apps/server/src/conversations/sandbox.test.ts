import { describe, expect, it, vi } from 'vitest';
import { sandboxSupport } from './sandbox';

describe('effective command sandbox availability', () => {
  it('does not advertise shell merely because binaries exist', () => {
    expect(
      sandboxSupport(
        () => true,
        'linux',
        () => false,
      ),
    ).toMatchObject({ available: false });
    expect(
      sandboxSupport(
        () => true,
        'darwin',
        () => false,
      ),
    ).toMatchObject({ available: false });
  });
  it('requires all prerequisites before probing the kernel', () => {
    const probe = vi.fn(() => true);
    expect(sandboxSupport((name) => name !== 'socat', 'linux', probe)).toMatchObject({
      available: false,
    });
    expect(probe).not.toHaveBeenCalled();
  });
  it('advertises shell only when prerequisites and real confinement work', () => {
    expect(
      sandboxSupport(
        () => true,
        'linux',
        () => true,
      ),
    ).toEqual({ available: true });
    expect(
      sandboxSupport(
        () => true,
        'win32',
        () => true,
      ),
    ).toMatchObject({ available: false });
  });
});
