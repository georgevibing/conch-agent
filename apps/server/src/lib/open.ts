import { execFile } from 'node:child_process';

/**
 * Open `url` (or a file, such as the private page that opens Conch as this
 * computer — ADR 0063) in the default browser (`CONCH_OPEN=1`, as `pnpm
 * start` sets). Resolves once the hand-off is done (at most a few seconds), so
 * a process that's about to exit doesn't take the opener with it. On Linux
 * only with a desktop to show it on: a server has no browser. Says whether
 * there was anything to hand it to.
 */
export function openInBrowser(url: string): Promise<boolean> {
  const desktop = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const opener =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? // `start` is a cmd.exe built-in; this is the same hand-off without a shell.
          { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
        : desktop
          ? { command: 'xdg-open', args: [url] }
          : undefined;
  if (!opener) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(opener.command, opener.args, { windowsHide: true, timeout: 5_000 }, () =>
      resolve(true),
    );
  });
}
