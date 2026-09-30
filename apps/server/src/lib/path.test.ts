import { delimiter } from 'node:path';

import { describe, expect, it } from 'vitest';

import { expandVars, missingDirs, parseRegValues, refreshPath } from './path';

const REG = [
  'HKEY_CURRENT_USER\\Environment',
  '    Path    REG_EXPAND_SZ    C:\\Users\\ada\\.cargo\\bin;%PNPM_HOME%;%NVM_SYMLINK%',
  '    PNPM_HOME    REG_SZ    C:\\Users\\ada\\AppData\\Local\\pnpm',
  '    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp',
  '',
].join('\r\n');

describe('the PATH as it is now', () => {
  it('reads values from reg query output', () => {
    expect(parseRegValues(REG)).toEqual({
      Path: 'C:\\Users\\ada\\.cargo\\bin;%PNPM_HOME%;%NVM_SYMLINK%',
      PNPM_HOME: 'C:\\Users\\ada\\AppData\\Local\\pnpm',
      TEMP: '%USERPROFILE%\\AppData\\Local\\Temp',
    });
  });

  it('expands %VARS% like Windows, ignoring case, and leaves unknown ones alone', () => {
    expect(expandVars('%pnpm_home%;%NOPE%', { PNPM_HOME: 'C:\\pnpm' })).toBe('C:\\pnpm;%NOPE%');
  });

  it('adds only folders it doesn’t have, however they’re spelled', () => {
    const current = ['C:\\Windows', 'C:\\Tools\\'].join(delimiter);
    expect(
      missingDirs(current, ['c:\\windows', 'C:\\Tools', 'C:\\New', 'C:\\New\\', '%UNSET%']),
    ).toEqual(['C:\\New']);
  });

  it.runIf(process.platform === 'win32')('reads the real registry without failing', async () => {
    const added = await refreshPath({ force: true });
    expect(Array.isArray(added)).toBe(true);
    // A second look straight away finds nothing new.
    expect(await refreshPath({ force: true })).toEqual([]);
  });
});
