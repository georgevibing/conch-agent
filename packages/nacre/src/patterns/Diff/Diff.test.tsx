import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { sampleDiff } from '../fixtures';
import { Diff, parseUnifiedDiff } from './Diff';

describe('Diff', () => {
  it('parses unified diffs with line numbers', () => {
    const lines = parseUnifiedDiff(sampleDiff);
    expect(lines[0]).toMatchObject({ kind: 'hunk' });
    expect(lines[1]).toMatchObject({ kind: 'context', oldNumber: 12, newNumber: 12 });
    expect(lines[2]).toMatchObject({ kind: 'del', oldNumber: 13, text: "  private buffer = '';" });
    expect(lines[3]).toMatchObject({ kind: 'add', newNumber: 13 });
    expect(lines.some((l) => l.text.startsWith('diff --git'))).toBe(false);
  });

  it('renders stats and announces changes', async () => {
    const { container } = renderNacre(<Diff diff={sampleDiff} filename="session.ts" />);
    expect(screen.getByText('4 additions, 2 deletions')).toBeInTheDocument();
    expect(screen.getAllByText('added')).toHaveLength(4);
    expect(screen.getAllByText('removed')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Diff of session.ts' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
