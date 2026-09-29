import { posix, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findBrowsers, pickBrowser } from './locate';

describe('findBrowsers', () => {
  it('finds Edge on a stock Windows PC', () => {
    const edge = win32.join(
      'C:\\Program Files (x86)',
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    );
    const found = findBrowsers({
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local',
        PROGRAMFILES: 'C:\\Program Files',
        'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      },
      exists: (p) => p === edge,
    });
    expect(found).toEqual([{ id: 'edge', name: 'Microsoft Edge', path: edge }]);
  });

  it('prefers Chrome, then Edge, and lists a downloaded Chromium last', () => {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    const pw = '/Users/ada/Library/Caches/ms-playwright/chromium-1223/chrome';
    const found = findBrowsers({
      platform: 'darwin',
      home: '/Users/ada',
      exists: (p) => [chrome, edge, pw].includes(p),
      downloaded: () => pw,
    });
    expect(found.map((c) => c.id)).toEqual(['chrome', 'edge', 'downloaded']);
  });

  it('looks on PATH on Linux', () => {
    const found = findBrowsers({
      platform: 'linux',
      env: { PATH: '/home/ada/bin:/usr/local/bin' },
      exists: (p) => p === posix.join('/usr/local/bin', 'chromium'),
    });
    expect(found).toEqual([
      { id: 'chromium', name: 'Chromium', path: posix.join('/usr/local/bin', 'chromium') },
    ]);
  });

  it('finds nothing on a bare machine', () => {
    expect(findBrowsers({ platform: 'linux', env: { PATH: '' }, exists: () => false })).toEqual([]);
  });
});

describe('pickBrowser', () => {
  const list = [
    { id: 'chrome' as const, name: 'Google Chrome', path: '/c' },
    { id: 'edge' as const, name: 'Microsoft Edge', path: '/e' },
  ];
  it('honours your pick and falls back when it is gone', () => {
    expect(pickBrowser(list, 'edge')?.id).toBe('edge');
    expect(pickBrowser(list, 'auto')?.id).toBe('chrome');
    expect(pickBrowser(list, 'brave')?.id).toBe('chrome');
    expect(pickBrowser([], 'auto')).toBeUndefined();
  });
});
