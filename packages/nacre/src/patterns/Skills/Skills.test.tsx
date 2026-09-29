import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { skills } from './fixtures';
import { SkillCard } from './SkillCard';
import { skillHue, SkillIcon } from './SkillIcon';
import { SkillUsed } from './SkillUsed';

const weekly = skills[0] as (typeof skills)[number];
const openclaw = skills[3] as (typeof skills)[number];

describe('SkillCard', () => {
  it('shows what it is, how to ask for it, and whether it’s on', () => {
    renderNacre(<SkillCard {...weekly} onOpen={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByRole('article', { name: 'Weekly review' })).toBeInTheDocument();
    expect(screen.getByText(/Drafts a weekly review/)).toBeInTheDocument();
    expect(screen.getByText('/weekly-review')).toBeInTheDocument();
    expect(screen.getByText('Automatically')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Turn off Weekly review' })).toBeChecked();
  });

  it('opens from the title and toggles from the switch', async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    renderNacre(<SkillCard {...openclaw} onOpen={onOpen} onToggle={onToggle} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'GitHub triage' }));
    expect(onOpen).toHaveBeenCalled();
    await user.click(screen.getByRole('switch', { name: 'Turn on GitHub triage' }));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(screen.getByText('OpenClaw')).toBeInTheDocument();
  });

  it('says what’s wrong with a broken skill instead of offering a switch', () => {
    renderNacre(<SkillCard {...(skills[5] as (typeof skills)[number])} onToggle={vi.fn()} />);
    expect(screen.getByText(/no front matter/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('marks a title and description that are still being written', () => {
    renderNacre(
      <SkillCard
        variant="preview"
        name="new"
        title="New skill"
        description=""
        mode="auto"
        pending
      />,
    );
    const busy = document.querySelectorAll('[aria-busy="true"]');
    expect(busy).toHaveLength(2);
    expect(screen.getByText('Writing a description…')).toBeInTheDocument();
  });

  it('is accessible', async () => {
    const { container } = renderNacre(
      <div>
        {skills.map((s) => (
          <SkillCard key={s.name} {...s} onOpen={vi.fn()} onToggle={vi.fn()} />
        ))}
      </div>,
    );
    await expectAccessible(container);
  });
});

describe('SkillIcon', () => {
  it('keeps a skill’s colour stable and shows its initial', () => {
    expect(skillHue('weekly-review')).toBe(skillHue('weekly-review'));
    expect(new Set(skills.map((s) => skillHue(s.name))).size).toBeGreaterThan(2);
    const { container } = renderNacre(<SkillIcon name="weekly-review" title="weekly review" />);
    expect(container.textContent).toBe('W');
  });
});

describe('SkillUsed', () => {
  it('says which skill shaped the reply, and opens it', async () => {
    const onOpen = vi.fn();
    renderNacre(
      <SkillUsed name="weekly-review" title="Weekly review" by="assistant" onOpen={onOpen} />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Used the Weekly review skill');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Weekly review' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
