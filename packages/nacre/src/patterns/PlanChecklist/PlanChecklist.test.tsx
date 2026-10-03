import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { PlanApproval } from './PlanApproval';
import { PlanChecklist, planWindow, type PlanChecklistStep } from './PlanChecklist';

const titles = [
  'Look through the folder',
  'Sort by kind',
  'Rename the screenshots',
  'Bin the duplicates',
];
const at = (done: number, list = titles): PlanChecklistStep[] =>
  list.map((title, i) => ({
    title,
    status: i < done ? 'done' : i === done ? 'active' : 'pending',
  }));
const many = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`);

describe('PlanChecklist', () => {
  it('says how far along it is, and where each step stands, in words', async () => {
    const { container } = renderNacre(<PlanChecklist steps={at(2)} />);
    expect(screen.getByRole('region', { name: 'Plan, 2 of 4 done' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Done: Look through the folder',
      'Done: Sort by kind',
      'Now: Rename the screenshots',
      'Next: Bin the duplicates',
    ]);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveAttribute('data-status', 'done');
    await expectAccessible(container);
  });

  it('draws the check in only for a step that finishes while it’s shown', () => {
    const { container, rerender } = renderNacre(<PlanChecklist steps={at(1)} />);
    // Already done when it appeared: no flourish.
    expect(container.querySelectorAll('[data-fresh]')).toHaveLength(0);
    rerender(<PlanChecklist steps={at(2)} />);
    const fresh = container.querySelectorAll('[data-fresh]');
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.closest('li')?.textContent).toContain('Sort by kind');
  });

  it('shows a long plan around the work, and all of it on request, from the keyboard', async () => {
    renderNacre(<PlanChecklist steps={at(7, many)} limit={6} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText(/Step 8$/).closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('6 steps before')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Show all 12' });
    await userEvent.tab();
    expect(more).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a short plan whole, with nothing to press', () => {
    renderNacre(<PlanChecklist steps={at(0)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('folds to one line when the reply ends, which opens from the keyboard', async () => {
    const { container } = renderNacre(<PlanChecklist steps={at(4)} folded />);
    const line = screen.getByRole('button', { name: 'Plan · 4 of 4 done' });
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    await expectAccessible(container);
    await userEvent.tab();
    expect(line).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(line).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    await expectAccessible(container);
  });

  it('says how far a stopped plan got', () => {
    renderNacre(<PlanChecklist steps={at(1)} folded />);
    expect(screen.getByRole('button', { name: 'Plan · 1 of 4 done' })).toBeInTheDocument();
  });
});

describe('planWindow', () => {
  it('keeps the step just done in view, and never runs past the end', () => {
    expect(planWindow(at(0, many), 6)).toEqual({ start: 0, end: 6 });
    expect(planWindow(at(5, many), 6)).toEqual({ start: 4, end: 10 });
    expect(planWindow(at(11, many), 6)).toEqual({ start: 6, end: 12 });
    expect(planWindow(at(12, many), 6)).toEqual({ start: 6, end: 12 });
    expect(planWindow(at(1), 6)).toEqual({ start: 0, end: 4 });
  });
});

describe('PlanApproval', () => {
  it('asks with the plan, Start and Keep planning, in the assistant’s name', async () => {
    const onStart = vi.fn();
    const onKeepPlanning = vi.fn();
    const { container } = renderNacre(
      <PlanApproval name="Pearl" onStart={onStart} onKeepPlanning={onKeepPlanning}>
        <p>First, look around.</p>
      </PlanApproval>,
    );
    expect(screen.getByRole('region', { name: 'Pearl has a plan' })).toBeInTheDocument();
    expect(screen.getByText('First, look around.')).toBeInTheDocument();
    await expectAccessible(container);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Keep planning' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onKeepPlanning).toHaveBeenCalledOnce();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Start' })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('draws steps when that’s the plan there is', () => {
    renderNacre(<PlanApproval name="Conch" steps={at(-1)} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(titles);
  });

  it('holds both buttons while the answer goes', () => {
    renderNacre(<PlanApproval name="Conch" busy="start" steps={at(-1)} />);
    expect(screen.getByRole('button', { name: /Keep planning/ })).toBeDisabled();
  });

  it('folds to a quiet line once answered, which opens to the plan again', async () => {
    const { container } = renderNacre(<PlanApproval name="Conch" state="started" steps={at(-1)} />);
    const line = screen.getByRole('button', { name: 'Started on the plan' });
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    await userEvent.click(line);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    await expectAccessible(container);
  });

  it('says when it was kept planning, or never answered', () => {
    const { rerender } = renderNacre(<PlanApproval name="Conch" state="kept" />);
    expect(screen.getByRole('button', { name: 'Kept planning' })).toBeInTheDocument();
    rerender(<PlanApproval name="Conch" state="expired" />);
    expect(screen.getByRole('button', { name: 'The plan wasn’t started' })).toBeInTheDocument();
  });
});
