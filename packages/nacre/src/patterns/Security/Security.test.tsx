import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { DeviceList } from './DeviceList';
import { SecretReveal } from './SecretReveal';
import { SecurityCheckup } from './SecurityCheckup';
import { checkupItems, devices } from './fixtures';

describe('SecretReveal', () => {
  it('shows the secret with a copy button', async () => {
    const onCopied = vi.fn();
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { container } = renderNacre(<SecretReveal secret="conch_abc123" onCopied={onCopied} />);
    expect(screen.getByText('conch_abc123')).toBeInTheDocument();
    expect(screen.getByText(/won’t be shown again/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopied).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('SecurityCheckup', () => {
  it('headlines problems, spells out levels and offers commands', async () => {
    const { container } = renderNacre(<SecurityCheckup items={checkupItems} />);
    expect(screen.getByText('2 things need your attention')).toBeInTheDocument();
    expect(screen.getByText(/Needs attention:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says so when everything passed', () => {
    renderNacre(<SecurityCheckup items={checkupItems.filter((i) => i.level === 'ok')} />);
    expect(screen.getByText('Looking good')).toBeInTheDocument();
  });
});

describe('DeviceList', () => {
  it('lists this device first and signs others out', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const { container } = renderNacre(<DeviceList devices={devices} onSignOut={onSignOut} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('This device');
    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iPhone' }));
    expect(onSignOut).toHaveBeenCalledWith(expect.objectContaining({ id: 's_phone' }));
    await expectAccessible(container);
  });
});
