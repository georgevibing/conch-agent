import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CloudAccountPicker, type CloudAccountItem } from './CloudAccountPicker';

const accounts: CloudAccountItem[] = [
  {
    id: 'admin',
    label: 'admin',
    detail: 'Single sign-on · AdministratorAccess',
    state: 'ready',
    broad: true,
  },
  { id: 'dev', label: 'dev', detail: 'Single sign-on · BedrockDeveloper', state: 'ready' },
  { id: 'old', label: 'old', detail: 'Single sign-on · ReadOnly', state: 'expired' },
];

describe('CloudAccountPicker', () => {
  it('recommends a signed-in account that isn’t an administrator, and says why the other is less safe', async () => {
    const { container } = renderNacre(
      <CloudAccountPicker
        label="AWS accounts"
        accounts={accounts}
        onChoose={() => undefined}
        onSignIn={() => undefined}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('Recommended');
    expect(items[0]).not.toHaveTextContent('Recommended');
    expect(items[0]).toHaveTextContent('Full access. A narrower role is safer.');
    expect(items[2]).toHaveTextContent('Sign-in ended');
    await expectAccessible(container);
  });

  it('uses an account with one press, and signs an ended one in again with another', async () => {
    const onChoose = vi.fn();
    const onSignIn = vi.fn();
    renderNacre(
      <CloudAccountPicker
        label="AWS accounts"
        accounts={accounts}
        onChoose={onChoose}
        onSignIn={onSignIn}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use dev' }));
    expect(onChoose).toHaveBeenCalledWith('dev');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again: old' }));
    expect(onSignIn).toHaveBeenCalledWith('old');
  });

  it('says it’s asking while it checks, then lists the models it found', async () => {
    const { rerender, container } = renderNacre(
      <CloudAccountPicker
        label="AWS accounts"
        accounts={accounts}
        chosen="dev"
        pending="dev"
        onChoose={() => undefined}
      />,
    );
    expect(screen.getByText('Asking which models it can use…')).toBeInTheDocument();
    rerender(
      <CloudAccountPicker
        label="AWS accounts"
        accounts={accounts}
        chosen="dev"
        ready="eu-west-1 · 2 models"
        models={['Claude Opus 5.5', 'Claude Sonnet 5.5']}
        onChoose={() => undefined}
      />,
    );
    expect(screen.getByText('eu-west-1 · 2 models')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Models it can use' })).toHaveTextContent(
      'Claude Sonnet 5.5',
    );
    expect(screen.getByText('In use')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says what to do when nothing was found', () => {
    renderNacre(
      <CloudAccountPicker
        label="AWS accounts"
        accounts={[]}
        empty="No AWS sign-in yet."
        onChoose={() => undefined}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No AWS sign-in yet.');
  });
});
