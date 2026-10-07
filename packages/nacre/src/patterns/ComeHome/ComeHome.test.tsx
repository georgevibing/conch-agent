import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { openClawItems, openClawTeamItems, openClawTeamTicked, openClawTicked } from './fixtures';
import { ComeHomeHero } from './ComeHomeHero';
import { ImportOverview } from './ImportOverview';
import { ImportPreview, type ImportPreviewItem } from './ImportPreview';
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

  it('shows the model, and another agent’s things together under its name with one tick', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Team() {
      const [selected, setSelected] = useState(openClawTeamTicked);
      return (
        <ImportPreview
          items={openClawTeamItems}
          selected={selected}
          onSelectedChange={(ids) => {
            setSelected(ids);
            onChange(ids);
          }}
        />
      );
    }
    const { container } = renderNacre(<Team />);
    expect(screen.getByRole('region', { name: 'Model' })).toHaveTextContent(
      'Chats you’ve already started keep theirs',
    );
    const atlas = screen.getByRole('region', { name: 'Atlas' });
    expect(atlas).toHaveTextContent('What Atlas knew and did there');
    expect(atlas).toHaveTextContent('3 of 3');
    // Its things aren't mixed in with the main agent's.
    expect(screen.getByRole('region', { name: 'Memories' })).not.toHaveTextContent('Charles');
    // In the order they came.
    const rows = within(atlas).getAllByRole('checkbox').slice(1);
    expect(rows[0]).toHaveAccessibleName(/Quarterly planning/);
    expect(rows.at(-1)).toHaveAccessibleName(/Friday numbers/);
    await user.click(within(atlas).getByRole('checkbox', { name: 'All of Atlas' }));
    expect(onChange.mock.lastCall?.[0]).not.toContain('agent:work:memory:1');
    expect(onChange.mock.lastCall?.[0]).toContain('memory:1');
    expect(screen.getByRole('region', { name: 'Chat apps' })).toHaveTextContent(
      'Slack needs one more key',
    );
    await expectAccessible(container);
  });

  it('shows the agents that come over with their faces, a line about them, and who starts new chats', async () => {
    const user = userEvent.setup();
    const onDefault = vi.fn();
    function Cast() {
      const [selected, setSelected] = useState(openClawTeamTicked);
      const [chosen, setChosen] = useState<string | undefined>('agent:main');
      return (
        <ImportPreview
          items={openClawTeamItems}
          selected={selected}
          onSelectedChange={setSelected}
          defaultAgent={chosen}
          onDefaultAgentChange={(id) => {
            setChosen(id);
            onDefault(id);
          }}
          currentDefault="Conch"
        />
      );
    }
    const { container } = renderNacre(<Cast />);
    const agents = screen.getByRole('region', { name: 'Agents' });
    expect(agents).toHaveTextContent('2 of 2');
    expect(agents).toHaveTextContent(
      'Pearl and Atlas come over as agents of their own, each with its face and voice.',
    );
    // Each is ticked, with its face beside its name.
    expect(within(agents).getByRole('checkbox', { name: /Pearl/ })).toBeChecked();
    // The face is beside the name, so it isn't read out twice.
    expect(agents.querySelector('[data-preset="compass"]')).not.toBeNull();
    expect(agents).toHaveTextContent('Atlas’s model, GPT-5, stays behind');

    const picker = within(agents).getByRole('combobox', { name: 'New chats start with' });
    expect(picker).toHaveTextContent('Pearl');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: 'Conch, as now' }));
    expect(onDefault).toHaveBeenLastCalledWith(undefined);

    // Unticking one leaves it out of the line and the picker.
    await user.click(within(agents).getByRole('checkbox', { name: /Atlas/ }));
    expect(agents).toHaveTextContent(
      'Pearl comes over as an agent of its own, with its face and voice.',
    );
    await user.click(within(agents).getByRole('checkbox', { name: /Pearl/ }));
    expect(within(agents).queryByRole('combobox')).toBeNull();
    expect(agents).toHaveTextContent('Each comes over as an agent of its own');
    await expectAccessible(container);
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
        counts={{ agents: 2, memories: 2, skills: 1, routines: 1, keys: 0 }}
        next={['Turn on Morning briefing in Routines when you’re ready.']}
        failed={[{ title: 'Telegram bot', message: 'Telegram didn’t know that key.' }]}
        backedUp
        action={<button type="button">Undo</button>}
      />,
    );
    const summary = screen.getByRole('region', { name: 'Your things from OpenClaw are here' });
    expect(summary).toHaveTextContent('2 agents');
    expect(summary).toHaveTextContent('2 memories');
    expect(summary).toHaveTextContent('1 skill, off for now');
    expect(summary).toHaveTextContent('1 routine, as a draft');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('2 agents');
    expect(summary).not.toHaveTextContent('0 keys');
    expect(screen.getByRole('list', { name: 'Didn’t come over' })).toHaveTextContent(
      'Telegram didn’t know that key.',
    );
    expect(summary).toHaveTextContent('backed itself up first');
    await expectAccessible(container);
  });
});

describe('Come home, at a glance', () => {
  const many: ImportPreviewItem[] = Array.from({ length: 14 }, (_, n) => ({
    id: `memory:${n}`,
    group: 'memories',
    title: n % 2 ? `Uses Coolify for project ${n}` : `Prefers pnpm for project ${n}`,
  }));

  function Glance() {
    const items = [...openClawItems.filter((i) => i.group !== 'memories'), ...many];
    const [selected, setSelected] = useState(items.map((i) => i.id));
    const [view, setView] = useState('all');
    return (
      <>
        <ComeHomeHero from="OpenClaw" path="~/.openclaw" />
        <ImportOverview items={items} selected={selected} view={view} onViewChange={setView} />
        <ImportPreview
          items={items}
          selected={selected}
          onSelectedChange={setSelected}
          view={view}
        />
      </>
    );
  }

  it('says where things come from, and that nothing there changes', async () => {
    const { container } = renderNacre(<Glance />);
    expect(screen.getByRole('heading', { name: 'Bring your things from OpenClaw' })).toBeVisible();
    expect(screen.getByText(/Nothing there changes, and you can undo it all/)).toBeVisible();
    await expectAccessible(container);
  });

  it('shows one kind at a time from its tile, and searches a long one', async () => {
    const user = userEvent.setup();
    renderNacre(<Glance />);
    const glance = screen.getByRole('group', { name: 'What there is to bring' });
    const tile = within(glance).getByRole('button', { name: /^Memories/ });
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    await user.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Skills' })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search memories' }), 'coolify');
    expect(screen.getByText('7 found')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Untick these' }));
    expect(tile).toHaveTextContent('7of 14');
    await user.click(within(glance).getByRole('button', { name: /^Everything/ }));
    expect(screen.getByRole('region', { name: 'Skills' })).toBeVisible();
  });
});
