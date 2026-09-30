import { execFile } from 'node:child_process';

/**
 * Open `url` in the default browser (`CONCH_OPEN=1`, as `pnpm start` sets).
 * Resolves once the hand-off is done (at most a few seconds), so a process
 * that's about to exit doesn't take the opener with it.
 */
export function openInBrowser(url: string): Promise<void> {
  const opener =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? // `start` is a cmd.exe built-in; this is the same hand-off without a shell.
          { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
        : undefined;
  if (!opener) return Promise.resolve();
  return new Promise((resolve) => {
    execFile(opener.command, opener.args, { windowsHide: true, timeout: 5_000 }, () => resolve());
  });
}
