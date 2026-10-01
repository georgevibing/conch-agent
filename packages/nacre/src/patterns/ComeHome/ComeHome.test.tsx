import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { openClawItems, openClawTicked } from './fixtures';
import { ImportPreview } from './ImportPreview';
import { ImportOffer, ImportProgress, ImportSummary } from './ImportSummary';

function Controlled({ onChange }: { onChange?: (ids: string[]) => void }) {
  const [selected, setSelected] = useState(openClawTicked);
  return (
    <ImportPreview
      items={openClawItems}
      selected={selected}
      onSelectedChange={(ids) => {
        setSelected(ids);
        onChange?.(ids);
      }}
      problems={['Its scheduled jobs couldn’t be read, so they stay behind.']}
    />
  );
}

describe('ImportPreview', () => {
  it('groups what would come over, each with a tick, and says why some start unticked', async () => {
    const { container } = renderNacre(<Controlled />);
    const memories = screen.getByRole('region', { name: 'Memories' });
    expect(memories).toHaveTextContent('2 of 3');
    expect(memories).toHaveTextContent('Already in Conch');
    expect(screen.getByRole('checkbox', { name: /Ada takes her tea/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Her sister/ })).toBeChecked();
    const skills = screen.getByRole('region', { name: 'Skills' });
    expect(skills).toHaveTextContent('They come over off');
    expect(skills).toHaveTextContent('Left unticked');
    expect(screen.getByRole('region', { name: 'Chat apps' })).toHaveTextContent(
      'Stop OpenClaw first',
    );
    expect(screen.getByRole('region', { name: 'What stays behind' })).toHaveTextContent(
      'scheduled jobs',
    );
    await expectAccessible(container);
  });

  it('ticks one, or a whole group, and shows an item’s words on request', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderNacre(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: /Your Telegram bot/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining(['channel:telegram']));

    const all = screen.getByRole('checkbox', { name: 'All memories' });
    expect(all).toHaveAttribute('data-state', 'indeterminate');
    await user.click(all);
    expect(onChange.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining(['memory:0', 'memory:1', 'memory:2']),
    );
    await user.click(all);
    expect(onChange.mock.lastCall?.[0]).not.toContain('memory:1');

    const show = screen.getAllByRole('button', { name: 'Show what it says' })[0];
    if (!show) throw new Error('no preview');
    await user.click(show);
    expect(screen.getByText(/British spelling/)).toBeVisible();
  });

  it('folds a long group', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 9 }, (_, i) => ({
      id: `memory:${i}`,
      group: 'memories' as const,
      title: `Fact ${i}`,
    }));
    renderNacre(<ImportPreview items={items} selected={[]} onSelectedChange={() => {}} />);
    expect(screen.getAllByRole('checkbox', { name: /^Fact/ })).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'Show all 9' }));
    expect(screen.getAllByRole('checkbox', { name: /^Fact/ })).toHaveLength(9);
  });
});

describe('ImportOffer, ImportProgress and ImportSummary', () => {
  it('offer, progress and a summary in plain words', async () => {
    const { container, rerender } = renderNacre(
      <ImportOffer
        from="OpenClaw"
        summary="3 memories, 2 skills"
        action={<button type="button">Take a look</button>}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Bring your things from OpenClaw' }),
    ).toHaveTextContent('3 memories, 2 skills');
    await expectAccessible(container);

    rerender(<ImportProgress done={2} total={5} current="Morning briefing" />);
    expect(screen.getByRole('progressbar', { name: 'Bringing your things over' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    expect(container).toHaveTextContent('2 of 5');
    await expectAccessible(container);

    rerender(
      <ImportSummary
        from="OpenClaw"
        counts={{ memories: 2, skills: 1, routines: 1, keys: 0 }}
        next={['Turn on Morning briefing in Routines when you’re ready.']}
        failed={[{ title: 'Telegram bot', message: 'Telegram didn’t know that key.' }]}
        backedUp
        action={<button type="button">Undo</button>}
      />,
    );
    const summary = screen.getByRole('region', { name: 'Your things from OpenClaw are here' });
    expect(summary).toHaveTextContent('2 memories');
    expect(summary).toHaveTextContent('1 skill, off for now');
    expect(summary).toHaveTextContent('1 routine, as a draft');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('2 memories');
    expect(summary).not.toHaveTextContent('0 keys');
    expect(screen.getByRole('list', { name: 'Didn’t come over' })).toHaveTextContent(
      'Telegram didn’t know that key.',
    );
    expect(summary).toHaveTextContent('backed itself up first');
    await expectAccessible(container);
  });
});
