import { describe, expect, it } from 'vitest';

import { gatewayEnv, mergePath, pathFromShell, usualPlaces } from './environment';

describe('the gateway’s environment', () => {
  it('finds the PATH in whatever a login shell prints around it', () => {
    expect(
      pathFromShell('Welcome back!\n__CONCH_PATH__/opt/homebrew/bin:/usr/bin__CONCH_PATH__\nbye'),
    ).toBe('/opt/homebrew/bin:/usr/bin');
    expect(pathFromShell('no marks here')).toBeUndefined();
    expect(pathFromShell('__CONCH_PATH____CONCH_PATH__')).toBeUndefined();
  });

  it('merges folders in order, once each', () => {
    expect(mergePath(['/a:/b', '/b:/c:', undefined, ' /d '], ':')).toBe('/a:/b:/c:/d');
  });

  it('on a Mac, uses the login shell’s PATH, then the usual places, then Node’s own folder last', () => {
    const env = gatewayEnv({
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: '/Users/me',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
        NODE_OPTIONS: '--require /tmp/evil.js',
        CONCH_DESKTOP_WEB: 'http://localhost:5173',
        CONCH_APP: '/old/Conch',
        CONCH_LOG_LEVEL: 'warn',
        LANG: 'el_GR.UTF-8',
      },
      home: '/Users/me/.conch',
      exe: '/Applications/Conch.app/Contents/MacOS/Conch',
      updates: 'download',
      background: false,
      loginPath: '/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin',
      nodeBin: '/Applications/Conch.app/Contents/Resources/node/bin',
      platform: 'darwin',
    });
    const path = env.PATH?.split(':') ?? [];
    expect(path.slice(0, 4)).toEqual([
      '/Users/me/.local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
    ]);
    expect(path.at(-1)).toBe('/Applications/Conch.app/Contents/Resources/node/bin');
    expect(new Set(path).size).toBe(path.length);
    expect(env).toMatchObject({
      CONCH_HOME: '/Users/me/.conch',
      CONCH_SUPERVISED: '1',
      CONCH_OPEN: '0',
      CONCH_APP: '/Applications/Conch.app/Contents/MacOS/Conch',
      CONCH_APP_UPDATES: 'download',
      CONCH_LOG_LEVEL: 'warn',
      LANG: 'el_GR.UTF-8',
    });
    for (const gone of [
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_NO_ATTACH_CONSOLE',
      'NODE_OPTIONS',
      'CONCH_DESKTOP_WEB',
      'CONCH_BACKGROUND',
    ])
      expect(env[gone]).toBeUndefined();
  });

  it('on Windows, keeps the person’s Path (whatever its case) and adds Node last', () => {
    const env = gatewayEnv({
      env: {
        Path: 'C:\\Windows\\system32;C:\\Users\\me\\.local\\bin',
        USERPROFILE: 'C:\\Users\\me',
      },
      home: 'C:\\Users\\me\\.conch',
      exe: 'C:\\Users\\me\\AppData\\Local\\Programs\\Conch\\Conch.exe',
      updates: 'install',
      background: true,
      nodeBin: 'C:\\Users\\me\\AppData\\Local\\Programs\\Conch\\resources\\node',
      platform: 'win32',
    });
    expect(env.PATH).toBeUndefined();
    expect(env.Path).toBe(
      'C:\\Windows\\system32;C:\\Users\\me\\.local\\bin;C:\\Users\\me\\AppData\\Local\\Programs\\Conch\\resources\\node',
    );
    expect(env.CONCH_BACKGROUND).toBe('1');
  });

  it('knows where people’s programs usually are when the shell can’t say', () => {
    expect(usualPlaces('/Users/me', 'darwin')).toContain('/opt/homebrew/bin');
    expect(usualPlaces('/home/me', 'linux')).toContain('/home/me/.local/bin');
    expect(usualPlaces('C:\\Users\\me', 'win32')).toEqual([]);
  });
});
