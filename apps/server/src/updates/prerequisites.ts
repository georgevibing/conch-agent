import { findExecutable, run } from '../lib/proc';

/** Old/custom Linux releases may still require node-pty's native build. The
 * current release makes it optional, so missing compilers never block updates.
 * This probe never installs anything, asks for credentials, or runs target code.
 */
export async function missingNativeBuildTools(): Promise<string[]> {
  const missing: string[] = [];
  let python = false;
  for (const name of ['python3', 'python']) {
    const path = await findExecutable(name);
    if (
      path &&
      (
        await run(path, ['-c', 'import sys; sys.exit(0 if sys.version_info.major == 3 else 1)'], {
          timeout: 5_000,
          input: '',
        })
      ).code === 0
    ) {
      python = true;
      break;
    }
  }
  if (!python) missing.push('Python 3');
  for (const [label, names] of [
    ['make', ['make']],
    ['a C compiler', ['cc', 'gcc', 'clang']],
    ['a C++ compiler', ['c++', 'g++', 'clang++']],
  ] as const) {
    let found = false;
    for (const name of names) {
      if (await findExecutable(name)) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(label);
  }
  return missing;
}

/** Inspect a manifest from git, not install scripts from the proposed update. */
export function requiresNativeBuild(manifest: unknown, platform = process.platform): boolean {
  if (platform !== 'linux' || !manifest || typeof manifest !== 'object') return false;
  const dependencies = 'dependencies' in manifest ? manifest.dependencies : undefined;
  const optional = 'optionalDependencies' in manifest ? manifest.optionalDependencies : undefined;
  return Boolean(
    dependencies &&
    typeof dependencies === 'object' &&
    'node-pty' in dependencies &&
    !(optional && typeof optional === 'object' && 'node-pty' in optional),
  );
}
