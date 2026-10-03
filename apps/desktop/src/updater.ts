/**
 * Replacing the app with a new version (ADR 0054). The gateway chooses the
 * release (Settings → Health → Updates); the app downloads it with
 * electron-updater, which checks it against the SHA-512 in the release's
 * own `latest*.yml`, then quits and lets the installer start the new one.
 */
import type { AppToGateway, AppUpdates } from '@conch/protocol';
import electronUpdater, { type AppUpdater as ElectronUpdater } from 'electron-updater';

/**
 * Whether this copy can replace itself. A Mac app must be signed for macOS
 * to let it (Squirrel.Mac checks); an AppImage and the Windows installer
 * can; a `.deb`, a portable copy or one that isn't packaged are downloaded
 * by the person instead.
 */
export function updatesMode({
  packaged,
  platform,
  env,
  signed,
}: {
  packaged: boolean;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Signed when it was built (`conch.signed` in the app's package.json). */
  signed: boolean;
}): AppUpdates {
  if (!packaged) return 'download';
  if (platform === 'darwin') return signed ? 'install' : 'download';
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_DIR ? 'download' : 'install';
  if (platform === 'linux') return env.APPIMAGE ? 'install' : 'download';
  return 'download';
}

/** What went wrong with a download, in a sentence a person can act on. */
export function plainUpdateError(message: string): string {
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|offline/i.test(message))
    return 'This computer seems to be offline. Try again when it’s connected.';
  if (/sha512|checksum|mismatch/i.test(message))
    return 'The download didn’t match what the release says it should be, so Conch didn’t install it. Try again.';
  if (/ENOSPC|disk|space/i.test(message))
    return 'There isn’t enough free space on this computer for the update.';
  if (/HttpError: 404|status code 404|Cannot find .*latest/i.test(message))
    return 'That release doesn’t have a download for this computer.';
  if (/code signature|not signed|SecCode|signature/i.test(message))
    return 'macOS didn’t accept the new version’s signature. Download it from its page instead.';
  return 'The download didn’t finish. Try again.';
}

export interface UpdaterDeps {
  send: (message: AppToGateway) => void;
  /** Just before the installer takes over: stop the gateway cleanly. */
  beforeInstall: () => Promise<void>;
  log: (line: string) => void;
  /** For tests. */
  updater?: Pick<
    ElectronUpdater,
    | 'setFeedURL'
    | 'checkForUpdates'
    | 'downloadUpdate'
    | 'quitAndInstall'
    | 'on'
    | 'off'
    | 'autoDownload'
    | 'autoInstallOnAppQuit'
    | 'allowPrerelease'
    | 'allowDowngrade'
    | 'logger'
  >;
}

export class Updater {
  #busy?: string;

  constructor(private readonly deps: UpdaterDeps) {}

  /** Download `version` from `feed` and install it. One at a time; progress and the end go to the gateway. */
  async get(version: string, feed: string): Promise<void> {
    if (this.#busy) return;
    this.#busy = version;
    const updater = this.deps.updater ?? electronUpdater.autoUpdater;
    const { send, log } = this.deps;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = true;
    updater.allowDowngrade = false;
    updater.logger = {
      info: (m: unknown) => log(`[update] ${String(m)}`),
      warn: (m: unknown) => log(`[update] ${String(m)}`),
      error: (m: unknown) => log(`[update] ${String(m)}`),
      debug: () => undefined,
    };
    let last = -1;
    const progress = (info: { percent: number }) => {
      const percent = Math.max(0, Math.min(100, Math.round(info.percent)));
      if (percent === last) return;
      last = percent;
      send({ type: 'update.progress', version, percent });
    };
    updater.on('download-progress', progress);
    try {
      updater.setFeedURL({ provider: 'generic', url: feed });
      const found = await updater.checkForUpdates();
      const offered = found?.updateInfo.version;
      if (offered !== version)
        throw new Error(`The release's files are for ${offered ?? 'nothing'}, not ${version}.`);
      await updater.downloadUpdate();
      send({ type: 'update.ready', version });
      await this.deps.beforeInstall();
      // Quietly on Windows, and start the new version once it's in.
      updater.quitAndInstall(true, true);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      log(`[update] ${version} failed: ${message}`);
      send({ type: 'update.failed', version, message: plainUpdateError(message) });
    } finally {
      updater.off('download-progress', progress);
      this.#busy = undefined;
    }
  }
}
