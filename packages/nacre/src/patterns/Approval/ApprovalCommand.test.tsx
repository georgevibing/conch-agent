import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ApprovalCommand } from './ApprovalCommand';
import { ApprovalSheet } from './ApprovalSheet';

const long = Array.from({ length: 12 }, (_, i) => `echo line ${i + 1}`).join('\n');

/** jsdom lays nothing out: a block taller than it shows is said here. */
function tall(scroll: number, client: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(client);
}

afterEach(() => vi.restoreAllMocks());

describe('ApprovalCommand', () => {
  it('shows every character of the command, as it would run', async () => {
    const { container } = renderNacre(<ApprovalCommand>{long}</ApprovalCommand>);
    const block = screen.getByRole('group', { name: 'Command' });
    expect(block.querySelector('pre')?.textContent).toBe(long);
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    await expectAccessible(container);
  });

  it('shows a few lines, and the rest a press away, reachable from the keyboard once open', async () => {
    tall(400, 140);
    const user = userEvent.setup();
    const { container } = renderNacre(<ApprovalCommand>{long}</ApprovalCommand>);
    const more = screen.getByRole('button', { name: 'Show all' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Command' })).toHaveAttribute('tabindex', '0');
    await expectAccessible(container);
    await user.click(less);
    expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument();
  });

  it('in the sheet: the heading is the few words, the command is under it', () => {
    renderNacre(
      <ApprovalSheet
        open
        onOpenChange={() => undefined}
        name="Pearl"
        title="Run git and Python in conch-agent"
        command={"cd ~/conch-agent && git checkout AGENTS.md && python3 - <<'EOF'\np=1\nEOF"}
        onDecide={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Run git and Python in conch-agent' });
    expect(screen.getByRole('group', { name: 'Command' })).toHaveTextContent(
      'git checkout AGENTS.md',
    );
    expect(dialog.querySelector('h2')?.textContent).toBe('Run git and Python in conch-agent');
  });
});
