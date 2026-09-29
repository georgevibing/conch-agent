import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Highlight } from './Highlight';

describe('Highlight', () => {
  it('marks the given ranges', () => {
    const { container } = renderNacre(
      <Highlight
        text="deploy the deployment"
        ranges={[
          [0, 6],
          [11, 17],
        ]}
      />,
    );
    const marks = [...container.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toEqual(['deploy', 'deploy']);
    expect(container.textContent).toBe('deploy the deployment');
  });

  it('clips and skips bad ranges', () => {
    const { container } = renderNacre(
      <Highlight
        text="short"
        ranges={[
          [3, 99],
          [2, 4],
          [10, 12],
        ]}
      />,
    );
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['rt']);
    expect(container.textContent).toBe('short');
  });

  it('is accessible', async () => {
    const { container } = renderNacre(<Highlight text="hello world" ranges={[[0, 5]]} />);
    await expectAccessible(container);
  });
});
