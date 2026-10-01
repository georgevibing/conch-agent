import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SkillReview } from './SkillReview';

describe('SkillReview', () => {
  it('names what it found, and where', async () => {
    const { container } = renderNacre(
      <SkillReview
        verdict="danger"
        findings={[
          {
            severity: 'danger',
            message: 'Downloads something and runs it.',
            file: 'SKILL.md',
            line: 9,
          },
        ]}
        action={<button type="button">Turn it on anyway…</button>}
      />,
    );
    const region = screen.getByRole('region', { name: 'Conch found something worrying' });
    expect(region).toHaveTextContent('Downloads something and runs it.');
    expect(region).toHaveTextContent('SKILL.md:9');
    await expectAccessible(container);
  });

  it('is a quiet line when it’s fine', () => {
    renderNacre(<SkillReview verdict="clean" findings={[]} />);
    expect(
      screen.getByRole('region', { name: 'Conch read every file in it: nothing worrying' }),
    ).toBeInTheDocument();
  });
});
