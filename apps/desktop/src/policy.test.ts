import { describe, expect, it } from 'vitest';

import {
  allowPermission,
  appAction,
  appFile,
  externalUrl,
  isConch,
  isSignInWindow,
  originOf,
  STATUS_PAGE,
} from './policy';

const ORIGINS = ['http://127.0.0.1:4317'];

describe('where the window may go', () => {
  it('stays on Conch’s own origin', () => {
    expect(isConch('http://127.0.0.1:4317/settings/health', ORIGINS)).toBe(true);
    for (const url of [
      'http://127.0.0.1:4318/',
      'http://localhost:4317/',
      'https://127.0.0.1:4317/',
      'http://127.0.0.1:4317.evil.example/',
      'https://accounts.google.com/o/oauth2',
      'file:///C:/Windows/System32/calc.exe',
      'about:blank',
      'not a url',
    ])
      expect(isConch(url, ORIGINS)).toBe(false);
    expect(originOf('data:text/html,hi')).toBeUndefined();
  });

  it('hands only web and mail links to the person’s apps', () => {
    expect(externalUrl('https://github.com/giotiskl/conch-agent')).toBe(
      'https://github.com/giotiskl/conch-agent',
    );
    expect(externalUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'smb://server/share',
      'ms-msdt:/id PCWDiagnostic',
      'vscode://file/x',
      'data:text/html,<script>',
      '',
    ])
      expect(externalUrl(url)).toBeUndefined();
  });

  it('knows Conch’s sign-in windows, and nothing else, as sign-in windows', () => {
    expect(
      isSignInWindow('http://127.0.0.1:4317/integrations/done?opening=1', 'conch-sign-in', ORIGINS),
    ).toBe(true);
    expect(
      isSignInWindow(
        'http://127.0.0.1:4317/providers/done?opening=1',
        'conch-provider-sign-in',
        ORIGINS,
      ),
    ).toBe(true);
    expect(isSignInWindow('about:blank', 'conch-google', ORIGINS)).toBe(true);
    expect(isSignInWindow('about:blank', '', ORIGINS)).toBe(false);
    expect(isSignInWindow('http://127.0.0.1:4317/settings', 'conch-sign-in', ORIGINS)).toBe(false);
    expect(isSignInWindow('https://evil.example/integrations/done', 'conch-sign-in', ORIGINS)).toBe(
      false,
    );
  });

  it('serves its own two files from its own scheme, and nothing else', () => {
    expect(appFile(STATUS_PAGE)).toBe('status.html');
    expect(appFile(`${STATUS_PAGE}?state=stopped&message=x`)).toBe('status.html');
    expect(appFile('conch-app://app/status.js')).toBe('status.js');
    for (const url of [
      'conch-app://app/../../package.json',
      'conch-app://app/%2e%2e/main.cjs',
      'conch-app://app/main.cjs',
      'conch-app://elsewhere/status.html',
      'file:///C:/app/status.html',
      'http://127.0.0.1:4317/status.html',
    ])
      expect(appFile(url)).toBeUndefined();
  });

  it('reads the status page’s buttons, and nobody else’s', () => {
    expect(appAction(`${STATUS_PAGE}?state=stopped#retry`)).toBe('retry');
    expect(appAction(`${STATUS_PAGE}#log`)).toBe('log');
    expect(appAction(`${STATUS_PAGE}#quit`)).toBe('quit');
    expect(appAction(`${STATUS_PAGE}#retry-now`)).toBeUndefined();
    expect(appAction(STATUS_PAGE)).toBeUndefined();
    expect(appAction('http://127.0.0.1:4317/#retry')).toBeUndefined();
    expect(appAction('conch-app://app/status.js#retry')).toBeUndefined();
  });
});

describe('permissions', () => {
  it('grants what Conch uses, to Conch only', () => {
    const page = 'http://127.0.0.1:4317/';
    expect(allowPermission('notifications', page, ORIGINS)).toBe(true);
    expect(allowPermission('clipboard-sanitized-write', page, ORIGINS)).toBe(true);
    expect(allowPermission('notifications', 'https://evil.example/', ORIGINS)).toBe(false);
    for (const permission of ['geolocation', 'midi', 'openExternal', 'hid', 'serial', 'usb'])
      expect(allowPermission(permission, page, ORIGINS)).toBe(false);
  });

  it('lets voice use the microphone, never the camera or the screen', () => {
    const page = 'http://127.0.0.1:4317/';
    expect(allowPermission('media', page, ORIGINS, ['audio'])).toBe(true);
    expect(allowPermission('media', page, ORIGINS, ['audio', 'video'])).toBe(false);
    expect(allowPermission('media', page, ORIGINS, ['video'])).toBe(false);
    expect(allowPermission('media', page, ORIGINS, [])).toBe(false);
  });
});
