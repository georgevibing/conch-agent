import electronUpdater from 'electron-updater';
import { describe, expect, it } from 'vitest';
import { desktopPackageVersion } from '../../server/src/build.ts';

// Exercise Electron's real version comparison without Electron, network or files.
function updater(build) {
  const app = {
    version: desktopPackageVersion(build),
    name: 'Conch',
    isPackaged: true,
    appUpdateConfigPath: '',
    userDataPath: '',
    baseCachePath: '',
    whenReady: async () => undefined,
    relaunch() {},
    quit() {},
    onQuit() {},
  };
  const value = new electronUpdater.NsisUpdater(null, app);
  value.isUpdateSupported = () => true;
  value.isUserWithinRollout = () => true;
  value.allowDowngrade = false;
  return value;
}
const info = (version) => ({ version, files: [], releaseDate: '2026-10-06' });

describe('desktop package identity', () => {
  it.each(['0.1.0-alpha.1', '0.1.0-beta.1', '0.1.0'])(
    'lets an unpublished Dev package reach %s',
    async (version) => {
      const value = updater({ kind: 'dev', commit: 'a'.repeat(40) });
      expect(await value.isUpdateAvailable(info(version))).toBe(true);
    },
  );
  it('keeps release numbers intact and still refuses a downgrade', async () => {
    const build = { kind: 'release', version: '0.1.0-beta.2', channel: 'beta' };
    expect(desktopPackageVersion(build)).toBe('0.1.0-beta.2');
    const value = updater(build);
    expect(await value.isUpdateAvailable(info('0.1.0-beta.1'))).toBe(false);
    expect(await value.isUpdateAvailable(info('0.1.0'))).toBe(true);
  });
});
