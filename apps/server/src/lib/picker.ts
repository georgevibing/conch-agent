/**
 * The operating system's own Open dialog, shown on this computer, so a
 * person chooses a file or folder the way they always do instead of typing
 * a path. A browser can't hand a page a real path; the gateway, running on
 * the same computer, can ask the system for one.
 *
 * Only for requests from this computer: a phone can't see a dialog on the
 * Mac across the room (`routes` checks `access.kind === 'local'`).
 *
 * - macOS: AppleScript's `choose file` / `choose folder`, in front of
 *   whatever app is in front (the browser);
 * - Windows: the .NET Open dialog, through PowerShell;
 * - Linux: `zenity`, or `kdialog`.
 *
 * The prompt and file types go in as arguments to a fixed script (never
 * pasted into it), and cancelling is an answer, not an error.
 */
import { platform as osPlatform } from 'node:os';

import { findExecutable, run } from './proc';

export interface PickOptions {
  /** What it's for, shown in the dialog: "Choose your KeePassXC database". */
  prompt: string;
  /** A file (the default) or a folder. */
  kind?: 'file' | 'folder';
  /** File extensions to allow, without dots: `['kdbx']`. */
  extensions?: string[];
  /** Where it opens. */
  startIn?: string;
}

export class PickerUnavailable extends Error {}

const SAFE_EXT = /^[A-Za-z0-9]{1,10}$/;

/** The chosen path, or undefined when the person cancelled. */
export async function pickPath(
  options: PickOptions,
  platform: NodeJS.Platform = osPlatform(),
): Promise<string | undefined> {
  const extensions = (options.extensions ?? []).filter((e) => SAFE_EXT.test(e));
  const folder = options.kind === 'folder';
  const prompt = options.prompt.slice(0, 200);
  const timeout = 10 * 60_000;

  if (platform === 'darwin') {
    // Arguments, not interpolation: the prompt can't change the script.
    const script = [
      'on run argv',
      '  set thePrompt to item 1 of argv',
      '  set isFolder to item 2 of argv is "folder"',
      '  set types to {}',
      '  if (count of argv) > 3 then set types to items 4 thru -1 of argv',
      '  set front to path to frontmost application as text',
      '  tell application front',
      '    activate',
      '    if isFolder then',
      '      set chosen to choose folder with prompt thePrompt',
      '    else if (count of types) > 0 then',
      '      set chosen to choose file with prompt thePrompt of type types',
      '    else',
      '      set chosen to choose file with prompt thePrompt',
      '    end if',
      '  end tell',
      '  return POSIX path of chosen',
      'end run',
    ].join('\n');
    const result = await run(
      '/usr/bin/osascript',
      ['-e', script, prompt, folder ? 'folder' : 'file', options.startIn ?? '', ...extensions],
      { timeout },
    );
    if (result.code !== 0) {
      if (/-128|User canceled/i.test(result.stderr)) return undefined;
      throw new PickerUnavailable('The Open dialog didn’t come up.');
    }
    return result.stdout.trim().replace(/\/$/, '') || undefined;
  }

  if (platform === 'win32') {
    const filter = extensions.length
      ? `${extensions.map((e) => `*.${e}`).join(';')}|${extensions.map((e) => `*.${e}`).join(';')}`
      : 'All files|*.*';
    const script = folder
      ? `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = $env:CONCH_PICK_PROMPT; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`
      : `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = $env:CONCH_PICK_PROMPT; $d.Filter = $env:CONCH_PICK_FILTER; if ($d.ShowDialog() -eq 'OK') { $d.FileName }`;
    const result = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      timeout,
      env: { ...process.env, CONCH_PICK_PROMPT: prompt, CONCH_PICK_FILTER: filter } as Record<
        string,
        string
      >,
    });
    if (result.code !== 0) throw new PickerUnavailable('The Open dialog didn’t come up.');
    return result.stdout.trim() || undefined;
  }

  const zenity = await findExecutable('zenity');
  if (zenity) {
    const result = await run(
      zenity,
      [
        '--file-selection',
        `--title=${prompt}`,
        ...(folder ? ['--directory'] : []),
        ...(extensions.length
          ? [`--file-filter=${extensions.map((e) => `*.${e}`).join(' ')}`]
          : []),
      ],
      { timeout },
    );
    // zenity exits 1 when cancelled.
    if (result.code === 1) return undefined;
    if (result.code !== 0) throw new PickerUnavailable('The Open dialog didn’t come up.');
    return result.stdout.trim() || undefined;
  }
  const kdialog = await findExecutable('kdialog');
  if (kdialog) {
    const result = await run(
      kdialog,
      folder
        ? ['--getexistingdirectory', options.startIn ?? '.', '--title', prompt]
        : [
            '--getopenfilename',
            options.startIn ?? '.',
            extensions.map((e) => `*.${e}`).join(' ') || '*',
            '--title',
            prompt,
          ],
      { timeout },
    );
    if (result.code === 1) return undefined;
    if (result.code !== 0) throw new PickerUnavailable('The Open dialog didn’t come up.');
    return result.stdout.trim() || undefined;
  }
  throw new PickerUnavailable('This computer has no Open dialog Conch can show.');
}
