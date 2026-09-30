import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SkillProblem, type DescriptionDraft } from './SkillProblem';

const NO_DESCRIPTION = 'It has no description, so an assistant wouldn’t know when to use it.';

function describeFix(draft: DescriptionDraft | Error) {
  return {
    kind: 'describe' as const,
    onDraft: vi.fn(() => (draft instanceof Error ? Promise.reject(draft) : Promise.resolve(draft))),
    onSave: vi.fn((_: string) => Promise.resolve()),
  };
}

describe('SkillProblem', () => {
  it('writes the description, shows it for a look, and saves what you kept', async () => {
    const user = userEvent.setup();
    const fix = describeFix({
      description: 'Sorts the Downloads folder by type. Use when asked to clean up downloads.',
      from: 'model',
      noModel: false,
    });
    const { container } = renderNacre(<SkillProblem problem={NO_DESCRIPTION} fix={fix} />);
    expect(screen.getByText('This skill can’t be used yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Write the description for me' }));

    const field = await screen.findByRole('textbox', { name: 'Description' });
    expect(field).toHaveFocus();
    expect(field).toHaveValue(
      'Sorts the Downloads folder by type. Use when asked to clean up downloads.',
    );
    expect(field).toHaveAccessibleDescription(/Written from its instructions/);
    await expectAccessible(container);

    await user.clear(field);
    await user.type(field, 'Tidies downloads.{Enter}Use when asked.');
    // One line: a new line never gets in.
    expect(field).toHaveValue('Tidies downloads. Use when asked.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(fix.onSave).toHaveBeenCalledWith('Tidies downloads. Use when asked.');
  });

  it('says when no model is connected, and lets you type it', async () => {
    const user = userEvent.setup();
    const fix = describeFix({
      description: 'Turn a transcript into action items.',
      from: 'text',
      noModel: true,
    });
    renderNacre(<SkillProblem problem={NO_DESCRIPTION} fix={fix} />);
    await user.click(screen.getByRole('button', { name: 'Write the description for me' }));
    const field = await screen.findByRole('textbox', { name: 'Description' });
    expect(field).toHaveAccessibleDescription(/No model is connected to write one/);
    expect(field).toHaveValue('Turn a transcript into action items.');
  });

  it('never dead-ends when writing fails: an empty box, Save waits for words', async () => {
    const user = userEvent.setup();
    const fix = describeFix(new Error('offline'));
    renderNacre(<SkillProblem problem={NO_DESCRIPTION} fix={fix} />);
    await user.click(screen.getByRole('button', { name: 'Write the description for me' }));
    const field = await screen.findByRole('textbox', { name: 'Description' });
    expect(field).toHaveAccessibleDescription(/couldn’t write one just now/);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(field, 'Answers questions about invoices.');
    expect(save).toBeEnabled();
    // Cancel goes back to the one button.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Write the description for me' }),
    ).toBeInTheDocument();
  });

  it('keeps your words if saving fails', async () => {
    const user = userEvent.setup();
    const fix = describeFix({
      description: 'Does a thing. Use when asked.',
      from: 'model',
      noModel: false,
    });
    fix.onSave.mockRejectedValueOnce(new Error('disk full'));
    renderNacre(<SkillProblem problem={NO_DESCRIPTION} fix={fix} />);
    await user.click(screen.getByRole('button', { name: 'Write the description for me' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Does a thing. Use when asked.',
    );
  });

  it('says where another app’s skill lives, and offers a copy', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const { container } = renderNacre(
      <SkillProblem
        problem="Its SKILL.md has no front matter."
        fix={{ kind: 'copy', owner: 'Claude Code', onCopy }}
      />,
    );
    expect(
      screen.getByText(/lives in Claude Code’s folder, and Conch won’t change it there/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make a copy I can edit' }));
    expect(onCopy).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Write the description for me' })).toBeNull();
    await expectAccessible(container);
  });

  it('offers to look again at a file it couldn’t read', async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn(() => new Promise<void>(() => undefined));
    renderNacre(
      <SkillProblem problem="SKILL.md is too big to read." fix={{ kind: 'check', onCheck }} />,
    );
    const button = screen.getByRole('button', { name: 'Look again' });
    await user.click(button);
    expect(onCheck).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
