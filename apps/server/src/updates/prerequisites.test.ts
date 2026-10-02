import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findExecutable, run } from '../lib/proc';
import { missingNativeBuildTools, requiresNativeBuild } from './prerequisites';

vi.mock('../lib/proc', () => ({ findExecutable: vi.fn(), run: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('native build prerequisites', () => {
  it('only requires compilers for a mandatory Linux native build', () => {
    const mandatory = { dependencies: { 'node-pty': '1.1.0' } };
    expect(requiresNativeBuild(mandatory, 'linux')).toBe(true);
    expect(requiresNativeBuild(mandatory, 'win32')).toBe(false);
    expect(requiresNativeBuild(mandatory, 'darwin')).toBe(false);
    expect(requiresNativeBuild({ optionalDependencies: { 'node-pty': '1.1.0' } }, 'linux')).toBe(
      false,
    );
    expect(
      requiresNativeBuild({ ...mandatory, optionalDependencies: { 'node-pty': '1.1.0' } }, 'linux'),
    ).toBe(false);
    expect(requiresNativeBuild(null, 'linux')).toBe(false);
  });

  it('names missing tools without trying to install them', async () => {
    vi.mocked(findExecutable).mockResolvedValue(undefined);
    expect(await missingNativeBuildTools()).toEqual([
      'Python 3',
      'make',
      'a C compiler',
      'a C++ compiler',
    ]);
    expect(run).not.toHaveBeenCalled();
  });

  it('accepts alternate compiler and Python names, and probes Python with no stdin', async () => {
    vi.mocked(findExecutable).mockImplementation(async (name) =>
      ['python', 'make', 'clang', 'clang++'].includes(name) ? `/bin/${name}` : undefined,
    );
    vi.mocked(run).mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    expect(await missingNativeBuildTools()).toEqual([]);
    expect(run).toHaveBeenCalledExactlyOnceWith('/bin/python', expect.any(Array), {
      timeout: 5000,
      input: '',
    });
  });

  it('does not count an unusable Python executable as ready', async () => {
    vi.mocked(findExecutable).mockImplementation(async (name) => `/bin/${name}`);
    vi.mocked(run).mockResolvedValue({ code: 1, stdout: '', stderr: '' });
    expect(await missingNativeBuildTools()).toEqual(['Python 3']);
  });
});
