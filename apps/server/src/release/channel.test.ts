import { describe, expect, it } from 'vitest';

import { channelIn, setChannel, setReleaseAs } from './channel';

const ALPHA = JSON.stringify({
  'release-type': 'node',
  versioning: 'prerelease',
  prerelease: true,
  'prerelease-type': 'alpha.1',
  'initial-version': '0.1.0-alpha.1',
});

const read = (text: string) => JSON.parse(text) as Record<string, unknown>;

describe('channels (ADR 0127)', () => {
  it('reads the channel the configuration releases on', () => {
    expect(channelIn(ALPHA)).toBe('alpha');
    expect(channelIn(JSON.stringify({ prerelease: true, 'prerelease-type': 'beta.1' }))).toBe(
      'beta',
    );
    expect(channelIn(JSON.stringify({ prerelease: false }))).toBe('stable');
    expect(channelIn('{}')).toBe('stable');
  });

  it('moves the start before the first release', () => {
    const beta = setChannel(ALPHA, 'beta');
    expect(read(beta.text)).toMatchObject({
      prerelease: true,
      'prerelease-type': 'beta.1',
      'initial-version': '0.1.0-beta.1',
    });
    expect(beta.next).toBe('The first release will be 0.1.0-beta.1.');
    const stable = setChannel(ALPHA, 'stable');
    expect(read(stable.text)).toMatchObject({ prerelease: false, 'initial-version': '0.1.0' });
    expect(read(stable.text)['prerelease-type']).toBeUndefined();
  });

  it('takes the step from alphas to betas with a one-off release-as', () => {
    const change = setChannel(ALPHA, 'beta', '0.1.0-alpha.4');
    expect(read(change.text)).toMatchObject({
      'release-as': '0.1.0-beta.1',
      'prerelease-type': 'beta.1',
    });
    expect(change.next).toBe('The next release will be 0.1.0-beta.1, then betas.');
  });

  it('promotes pre-releases to their stable version, and starts the next ones after a stable release', () => {
    const stable = setChannel(ALPHA, 'stable', '0.1.0-beta.2');
    expect(read(stable.text)).toMatchObject({ prerelease: false });
    expect(read(stable.text)['release-as']).toBeUndefined();
    expect(stable.next).toBe('The next release will be 0.1.0, the stable one.');
    expect(setChannel(stable.text, 'beta', '0.1.0').next).toBe(
      'The next release will be the first beta of the version after 0.1.0.',
    );
    expect(setChannel(ALPHA, 'alpha', '0.1.0-alpha.2').next).toBe(
      'The next releases will be more alphas of 0.1.0.',
    );
  });

  it('never goes back from betas to alphas of the same version', () => {
    expect(() => setChannel(ALPHA, 'alpha', '0.1.0-beta.1')).toThrow(/would come before it/);
  });

  it('sets an exact next version only when it’s newer and one Conch releases', () => {
    expect(read(setReleaseAs(ALPHA, '1.0.0', '0.4.0').text)['release-as']).toBe('1.0.0');
    expect(() => setReleaseAs(ALPHA, '0.3.0', '0.4.0')).toThrow(/isn’t newer/);
    expect(() => setReleaseAs(ALPHA, '1.0', undefined)).toThrow(/isn’t a version/);
  });
});
