import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from '../../components/Button';
import { expectAccessible, renderNacre } from '../../test/render';
import { ProgramUpdates } from './ProgramUpdates';
import { SoftwareUpdate } from './SoftwareUpdate';

describe('SoftwareUpdate', () => {
  it('says an update is ready, keeps what’s new folded away, and offers one button', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <SoftwareUpdate
        state="available"
        title="An update is ready"
        detail="12 improvements · Checked 2 hours ago"
        whatsNew={['Attach files to a message', 'Terminals heal themselves']}
        more={10}
        action={<Button>Update Conch</Button>}
        footnote="Conch restarts by itself. Your chats are safe."
      />,
    );
    const region = screen.getByRole('region', { name: 'An update is ready' });
    expect(region).toHaveTextContent('12 improvements · Checked 2 hours ago');
    expect(screen.getByRole('button', { name: 'Update Conch' })).toBeInTheDocument();
    expect(screen.queryByText('Attach files to a message')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    expect(screen.getByText('Attach files to a message')).toBeVisible();
    expect(screen.getByText('and 10 more')).toBeVisible();
    await expectAccessible(container);
  });

  it('shows the step it’s on while updating, and no button', async () => {
    const { container } = renderNacre(
      <SoftwareUpdate
        state="updating"
        title="Updating Conch"
        progress={{ label: 'Installing', value: 40, step: 2, steps: 3 }}
        action={<Button>Update Conch</Button>}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Installing · 2 of 3' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByRole('button', { name: 'Update Conch' })).toBeNull();
    await expectAccessible(container);
  });

  it('says why one press can’t do it, with the command to copy', async () => {
    const { container } = renderNacre(
      <SoftwareUpdate
        state="available"
        title="An update is ready"
        blocked={{
          reason: 'Conch’s folder has changes that aren’t saved in git (1 file).',
          command: 'cd "/home/ada/conch"\ngit stash\ngit pull --ff-only',
        }}
      />,
    );
    expect(screen.getByText(/changes that aren’t saved in git/)).toBeInTheDocument();
    expect(screen.getByText(/git pull --ff-only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('announces how the last update went, in one sentence', () => {
    renderNacre(
      <SoftwareUpdate
        state="available"
        title="An update is ready"
        notice={{
          tone: 'warning',
          message: 'The update didn’t install, so Conch went back to the version you had.',
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/went back to the version you had/);
  });
});

describe('ProgramUpdates', () => {
  it('lists each program with its version, and one button where there’s an update', async () => {
    const { container } = renderNacre(
      <ProgramUpdates aria-label="Programs Conch uses">
        <ProgramUpdates.Item
          name="Claude Code"
          version="2.1.284"
          state="current"
          status="Up to date"
        />
        <ProgramUpdates.Item
          name="Codex"
          version="0.159.0"
          state="available"
          action={<Button size="sm">Update to 0.160.0</Button>}
        />
        <ProgramUpdates.Item
          name="uv"
          version="0.8.3"
          state="updating"
          status="Updating…"
          progress={{ value: 40, label: 'Downloading uv · 40%' }}
        />
        <ProgramUpdates.Item
          name="op"
          version="2.30.0"
          state="failed"
          action={<Button size="sm">Try again</Button>}
          message="Couldn’t download op: the internet seems to be unreachable."
        />
      </ProgramUpdates>,
    );
    const list = screen.getByRole('list', { name: 'Programs Conch uses' });
    expect(list.children).toHaveLength(4);
    expect(list.children[0]).toHaveTextContent('Claude Code2.1.284Up to date');
    expect(screen.getByRole('button', { name: 'Update to 0.160.0' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading uv · 40%' })).toBeInTheDocument();
    expect(list.children[3]).toHaveTextContent(/internet seems to be unreachable/);
    await expectAccessible(container);
  });
});
