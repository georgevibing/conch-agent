import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ComputerHeader, CoreStrip, HelperList } from './Computer';

describe('ComputerHeader', () => {
  it('says how the computer is doing as its heading, with its facts', async () => {
    const { container } = renderNacre(
      <ComputerHeader
        os="macos"
        name="Apple M3 Pro"
        status="Room to spare"
        facts={['macOS 26.7', '12 cores']}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Room to spare' })).toBeInTheDocument();
    expect(screen.getByText('Apple M3 Pro')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'macOS 26.7',
      '12 cores',
    ]);
    await expectAccessible(container);
  });
});

describe('CoreStrip', () => {
  it('is one picture with one sentence', async () => {
    const { container } = renderNacre(<CoreStrip values={[62.4, 10, 0]} />);
    expect(
      screen.getByRole('img', { name: '3 cores: the busiest at 62%, the quietest at 0%.' }),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('HelperList', () => {
  it('reads each number with its row and column', async () => {
    const { container } = renderNacre(
      <HelperList
        caption="Conch and what it started"
        rows={[
          { id: 'conch', label: 'Conch', cpu: '0.4%', memory: '93 MB' },
          {
            id: 'codex',
            label: 'Codex',
            detail: '2 processes',
            cpu: '3.1%',
            memory: '412 MB',
            trend: { values: [1, 3, 2] },
          },
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Conch and what it started' });
    const codex = within(table).getByRole('row', { name: /Codex/ });
    expect(within(codex).getByRole('rowheader')).toHaveTextContent('Codex2 processes');
    expect(
      within(codex)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['', '3.1%', '412 MB']);
    expect(within(table).getByRole('columnheader', { name: 'Processor' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
