import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SkillPermissionList } from './SkillPermissionList';
import { SkillSignatureBadge } from './SkillSignatureBadge';
import { TrustedPublisherList } from './TrustedPublisherList';

describe('SkillPermissionList', () => {
  it('says what the skill can do, commands as code', async () => {
    const { container } = renderNacre(
      <SkillPermissionList
        declared
        capabilities={['commands', 'files']}
        words={['run commands (only `git`)', 'change files in your work folder']}
      />,
    );
    const region = screen.getByRole('region', { name: 'This skill can:' });
    expect(region).toHaveTextContent('run commands (only git)');
    expect(region.querySelector('code')).toHaveTextContent('git');
    expect(region).toHaveTextContent('Anything else it tries asks you first');
    await expectAccessible(container);
  });

  it('says when the list is only the usual one', () => {
    renderNacre(
      <SkillPermissionList declared={false} capabilities={['files', 'web']} words={['a', 'b']} />,
    );
    expect(screen.getByText(/doesn’t say what it needs/)).toBeInTheDocument();
  });
});

describe('SkillSignatureBadge', () => {
  it('says verified, by whom', async () => {
    const { container } = renderNacre(
      <SkillSignatureBadge state="verified" publisher="Ada" fingerprint="3F9A 21C0 7B44 E1D2" />,
    );
    expect(screen.getByRole('region', { name: 'Verified: signed by Ada' })).toHaveTextContent(
      '3F9A 21C0 7B44 E1D2',
    );
    await expectAccessible(container);
  });

  it('warns about someone using a name you trust with another key', () => {
    renderNacre(<SkillSignatureBadge state="untrusted" lookalike publisher="Ada" />);
    expect(
      screen.getByRole('region', { name: 'Signed with a key that isn’t Ada’s' }),
    ).toHaveTextContent('Someone may be pretending');
  });

  it('says why a signature doesn’t hold', () => {
    renderNacre(
      <SkillSignatureBadge state="invalid" problem="It was changed after Ada signed it." />,
    );
    expect(screen.getByRole('region', { name: 'Its signature doesn’t hold' })).toHaveTextContent(
      'changed after Ada signed it',
    );
  });
});

describe('TrustedPublisherList', () => {
  it('lists them and forgets one, never your own key', async () => {
    const onForget = vi.fn();
    const { container } = renderNacre(
      <TrustedPublisherList
        publishers={[
          { fingerprint: 'AAAA', name: 'You', trustedAt: 1, you: true },
          { fingerprint: 'BBBB', name: 'Ada', trustedAt: 2 },
        ]}
        onForget={onForget}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Stop trusting You' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop trusting Ada' }));
    expect(onForget).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'BBBB' }));
    await expectAccessible(container);
  });
});
