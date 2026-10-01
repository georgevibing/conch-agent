import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SealCoverage } from './SealCoverage';

describe('SealCoverage', () => {
  it('says plainly which providers are sealed and which aren’t', async () => {
    const { container } = renderNacre(
      <SealCoverage
        providers={[
          { id: 'claude-code', label: 'Claude Code', state: 'sealed', note: 'Sealed note.' },
          { id: 'codex-cli', label: 'Codex', state: 'not-sealed', note: 'Can’t here.' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'For the providers you use' });
    expect(region).toHaveTextContent('Claude CodeSealed');
    expect(region).toHaveTextContent('CodexNot sealed');
    await expectAccessible(container);
  });
});
