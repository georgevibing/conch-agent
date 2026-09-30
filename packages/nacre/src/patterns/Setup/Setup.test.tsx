import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../components/Button';
import { expectAccessible, renderNacre } from '../../test/render';
import { SetupChecklist } from './SetupChecklist';

describe('SetupChecklist', () => {
  it('says where every step stands in words, not just marks', async () => {
    const { container } = renderNacre(
      <SetupChecklist aria-label="What 1Password needs">
        <SetupChecklist.Step state="done" title="The 1Password app" note="Installed" />
        <SetupChecklist.Step
          state="working"
          title="1Password’s MCP server"
          progress={{ value: 40, label: 'Downloading 1Password · 40%' }}
        />
        <SetupChecklist.Step state="current" title="Turn it on" description="In Settings → Labs." />
        <SetupChecklist.Step state="waiting" title="Say hello" />
        <SetupChecklist.Step state="failed" title="Extension" description="It didn’t download." />
        <SetupChecklist.Step state="unavailable" title="Widget" />
      </SetupChecklist>,
    );
    const list = screen.getByRole('list', { name: 'What 1Password needs' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Done: The 1Password appInstalled',
      'In progress: 1Password’s MCP serverDownloading 1Password · 40%',
      'To do: Turn it onIn Settings → Labs.',
      'Later: Say hello',
      'Didn’t work: ExtensionIt didn’t download.',
      'Not available: Widget',
    ]);
    expect(
      screen.getByRole('progressbar', { name: 'Downloading 1Password · 40%' }),
    ).toHaveAttribute('aria-valuenow', '40');
    await expectAccessible(container);
  });

  it('offers a step’s one button until it’s done, and keeps done steps quiet', async () => {
    const onInstall = vi.fn();
    const { rerender } = renderNacre(
      <SetupChecklist aria-label="Needs">
        <SetupChecklist.Step
          state="current"
          title="The 1Password app"
          description="Conch can install it for you."
          action={<Button onClick={onInstall}>Install 1Password</Button>}
        />
      </SetupChecklist>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Install 1Password' }));
    expect(onInstall).toHaveBeenCalledOnce();

    rerender(
      <SetupChecklist aria-label="Needs">
        <SetupChecklist.Step
          state="done"
          title="The 1Password app"
          description="Conch can install it for you."
          action={<Button onClick={onInstall}>Install 1Password</Button>}
        />
      </SetupChecklist>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Conch can install it for you.')).toBeNull();
  });

  it('skips empty slots when counting steps', () => {
    const later = false;
    renderNacre(
      <SetupChecklist aria-label="Needs">
        {later && <SetupChecklist.Step state="waiting" title="Hidden" />}
        <SetupChecklist.Step state="current" title="First" />
      </SetupChecklist>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
