import { describe, expect, it } from 'vitest';
import { ConchBuild, conchBuildLabel } from './updates';
describe('build labels', () => {
  it('shows Dev without inventing a version or commit', () => {
    expect(conchBuildLabel()).toBe('Dev');
    expect(conchBuildLabel({ kind: 'dev', commit: 'abcdef0123456789' })).toBe('Dev · abcdef0');
  });
  it.each(['0.1.0', '0.1.0-alpha.1', '0.1.0-beta.2'])(
    'keeps the whole release version %s',
    (version) => {
      expect(
        conchBuildLabel(
          ConchBuild.parse({
            kind: 'release',
            version,
            channel: version.includes('alpha')
              ? 'alpha'
              : version.includes('beta')
                ? 'beta'
                : 'stable',
          }),
        ),
      ).toBe(`v${version}`);
    },
  );
});
