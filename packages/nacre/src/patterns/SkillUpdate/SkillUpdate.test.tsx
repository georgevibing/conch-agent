import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderNacre, expectAccessible } from '../../test/render';
import { SkillUpdate } from './SkillUpdate';

const props = {
  title: 'Development previews',
  summary: 'Use devapps.',
  before: 'Use clawapp.',
  instructions: 'Use devapps to start a preview.',
  onUpdate: () => undefined,
  onDismiss: () => undefined,
};

describe('SkillUpdate', () => {
  it('shows proposed text safely and waits for the person', async () => {
    const onUpdate = vi.fn();
    const { container } = renderNacre(
      <SkillUpdate {...props} instructions={'<script>alert(1)</script>'} onUpdate={onUpdate} />,
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(container.querySelector('script')).toBeNull();
    await expectAccessible(container);
    const button = screen.getByRole('button', { name: 'Update skill' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('makes the previous instructions available by keyboard', async () => {
    renderNacre(<SkillUpdate {...props} />);
    const trigger = screen.getByRole('button', { name: 'Current instructions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Use clawapp.')).toBeVisible();
  });

  it('prevents saving a stale proposal and folds after saving', () => {
    const { rerender } = renderNacre(<SkillUpdate {...props} state="stale" />);
    expect(screen.getByRole('button', { name: 'Update skill' })).toBeDisabled();
    rerender(<SkillUpdate {...props} state="saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Updated Development previews');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
