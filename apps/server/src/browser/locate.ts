import { existsSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { posix, win32 } from 'node:path';

import type { BrowserCandidate } from '@conch/protocol';

/**
 * Finding a browser to drive (ADR 0014, "Zero setup"). Conch prefers the one
 * you already have, looked up in the places each installer puts it, and only
 * downloads Chromium when there's nothing else.
 */

interface Place {
  id: BrowserCandidate['id'];
  name: string;
  paths: string[];
}

type Env = Record<string, string | undefined>;

function windowsPlaces(env: Env): Place[] {
  const { join } = win32;
  const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.ProgramW6432]
    .filter((r): r is string => Boolean(r))
    .filter((r, i, all) => all.indexOf(r) === i);
  const under = (...parts: string[]) => roots.map((root) => join(root, ...parts));
  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      paths: under('Google', 'Chrome', 'Application', 'chrome.exe'),
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      paths: under('Microsoft', 'Edge', 'Application', 'msedge.exe'),
    },
    {
      id: 'brave',
      name: 'Brave',
      paths: under('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    },
    { id: 'chromium', name: 'Chromium', paths: under('Chromium', 'Application', 'chrome.exe') },
  ];
}

function macPlaces(home: string): Place[] {
  const { join } = posix;
  const app = (bundle: string, binary: string) => [
    join('/Applications', bundle, 'Contents', 'MacOS', binary),
    join(home, 'Applications', bundle, 'Contents', 'MacOS', binary),
  ];
  return [
    { id: 'chrome', name: 'Google Chrome', paths: app('Google Chrome.app', 'Google Chrome') },
    { id: 'edge', name: 'Microsoft Edge', paths: app('Microsoft Edge.app', 'Microsoft Edge') },
    { id: 'brave', name: 'Brave', paths: app('Brave Browser.app', 'Brave Browser') },
    { id: 'chromium', name: 'Chromium', paths: app('Chromium.app', 'Chromium') },
  ];
}

function linuxPlaces(env: Env): Place[] {
  const { join, delimiter } = posix;
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), '/usr/bin', '/snap/bin'];
  const onPath = (...names: string[]) => names.flatMap((n) => dirs.map((d) => join(d, n)));
  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      paths: [...onPath('google-chrome-stable', 'google-chrome'), '/opt/google/chrome/chrome'],
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      paths: [...onPath('microsoft-edge-stable', 'microsoft-edge'), '/opt/microsoft/msedge/msedge'],
    },
    { id: 'brave', name: 'Brave', paths: onPath('brave-browser', 'brave') },
    { id: 'chromium', name: 'Chromium', paths: onPath('chromium', 'chromium-browser') },
  ];
}

export interface LocateOptions {
  env?: Env;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => boolean;
  /** Where a Chromium Conch downloaded would be (`chromium.executablePath()`). */
  downloaded?: () => string | undefined;
}

/** Every browser Conch could drive on this computer, in the order it prefers them. */
export function findBrowsers(options: LocateOptions = {}): BrowserCandidate[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? osPlatform();
  const exists = options.exists ?? existsSync;
  const places =
    platform === 'win32'
      ? windowsPlaces(env)
      : platform === 'darwin'
        ? macPlaces(options.home ?? homedir())
        : linuxPlaces(env);
  const found: BrowserCandidate[] = [];
  for (const place of places) {
    const path = place.paths.find((p) => exists(p));
    if (path) found.push({ id: place.id, name: place.name, path });
  }
  const downloaded = options.downloaded?.();
  if (downloaded && exists(downloaded)) {
    found.push({ id: 'downloaded', name: 'Chromium (downloaded by Conch)', path: downloaded });
  }
  return found;
}

/** The candidate to use: your pick if it's still there, else the first found. */
export function pickBrowser(
  candidates: BrowserCandidate[],
  preferred: string,
): BrowserCandidate | undefined {
  return candidates.find((c) => c.id === preferred) ?? candidates[0];
}
