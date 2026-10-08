import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { brandMarks } from './brands';
import { notionTools } from './fixtures';
import { IntegrationCard } from './IntegrationCard';
import { IntegrationHandshake } from './IntegrationHandshake';
import { IntegrationIssueCard } from './IntegrationIssueCard';
import { IntegrationLogo } from './IntegrationLogo';
import { integrationStateMeta, IntegrationStatusBadge } from './status';
import { defaultPermission, humanizeTool, ToolPermissionList } from './ToolPermissionList';

describe('IntegrationLogo', () => {
  it('draws the bundled mark, or a monogram, and names it', async () => {
    const { container } = renderNacre(
      <>
        <IntegrationLogo brand="notion" name="Notion" />
        <IntegrationLogo name="Team wiki" />
        <IntegrationLogo brand="slack" name="Slack" status="needs-auth" />
      </>,
    );
    expect(
      screen.getByRole('img', { name: 'Notion' }).querySelector('path')?.getAttribute('d'),
    ).toBe(brandMarks.notion);
    expect(screen.getByRole('img', { name: 'Team wiki' })).toHaveTextContent('TW');
    // No <img>: nothing is ever fetched.
    expect(container.querySelector('img')).toBeNull();
    await expectAccessible(container);
  });

  it('leaves words like “AI” out of a monogram', () => {
    renderNacre(
      <>
        <IntegrationLogo name="Together AI" />
        <IntegrationLogo name="Hugging Face" />
        <IntegrationLogo name="AI Studio" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Together AI' })).toHaveTextContent(/^T$/);
    expect(screen.getByRole('img', { name: 'Hugging Face' })).toHaveTextContent('HF');
    expect(screen.getByRole('img', { name: 'AI Studio' })).toHaveTextContent(/^S$/);
  });

  it('hides itself when decorative', () => {
    renderNacre(<IntegrationLogo brand="github" name="GitHub" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('IntegrationStatusBadge', () => {
  it('uses plain words for every state', () => {
    renderNacre(
      <>
        {Object.keys(integrationStateMeta).map((s) => (
          <IntegrationStatusBadge key={s} state={s as keyof typeof integrationStateMeta} />
        ))}
      </>,
    );
    for (const label of [
      'Working',
      'Checking…',
      'Signing in…',
      'Needs sign-in',
      'Check this',
      'Not working',
      'Off',
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('IntegrationCard', () => {
  it('a found app is an offer: one button, a way to say no, and no switch or warning', async () => {
    const onSignIn = vi.fn();
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <IntegrationCard
        variant="found"
        name="Asana"
        brand="asana"
        tagline="engineering plugin"
        action={{ label: 'Sign in', onClick: onSignIn }}
        dismiss={{ label: 'Don’t use Asana here', onClick: onDismiss }}
        onOpen={onOpen}
      />,
    );
    const card = screen.getByRole('article', { name: 'Asana' });
    expect(card).not.toHaveAttribute('data-attention');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('engineering plugin')).toBeInTheDocument();
    // Eight of them in a row: each button says which app it signs in to.
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to Asana' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Don’t use Asana here' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Asana' }));
    expect(onOpen).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('says a calm next step in place of its facts, with its button, and never over a problem', async () => {
    const onHello = vi.fn();
    const { container, rerender } = renderNacre(
      <IntegrationCard
        variant="connected"
        name="Telegram"
        brand="telegram"
        state="ok"
        meta="@adas_conch_bot"
        notice={{
          message: 'Say hello from Telegram to finish.',
          label: 'Say hello',
          onClick: onHello,
        }}
        enabled
      />,
    );
    expect(screen.getByText('Say hello from Telegram to finish.')).toBeInTheDocument();
    expect(screen.queryByText('@adas_conch_bot')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Say hello' }));
    expect(onHello).toHaveBeenCalledOnce();
    await expectAccessible(container);
    rerender(
      <IntegrationCard
        variant="connected"
        name="Telegram"
        brand="telegram"
        state="needs-auth"
        message="Telegram stopped accepting this bot’s key."
        notice={{
          message: 'Say hello from Telegram to finish.',
          label: 'Say hello',
          onClick: onHello,
        }}
        enabled
      />,
    );
    expect(screen.queryByRole('button', { name: 'Say hello' })).toBeNull();
    expect(screen.getByText('Telegram stopped accepting this bot’s key.')).toBeInTheDocument();
  });

  it('shows what’s wrong and the one button that fixes it', async () => {
    const onFix = vi.fn();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const { container } = renderNacre(
      <IntegrationCard
        variant="connected"
        name="GitHub"
        brand="github"
        state="needs-auth"
        message="The token was refused."
        action={{ label: 'Paste a new token', onClick: onFix }}
        enabled
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    );
    const card = screen.getByRole('article', { name: 'GitHub' });
    expect(card).toHaveAccessibleDescription(/The token was refused/);
    await userEvent.click(screen.getByRole('button', { name: 'Paste a new token' }));
    expect(onFix).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('switch', { name: 'Turn off GitHub' }));
    expect(onToggle).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    expect(onOpen).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('keeps quiet when all is well', () => {
    renderNacre(
      <IntegrationCard
        variant="connected"
        name="Notion"
        state="ok"
        meta="12 tools"
        enabled
        action={{ label: 'Reconnect', onClick: () => {} }}
      />,
    );
    expect(screen.getByText('12 tools')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('opens a catalog tile from the keyboard', async () => {
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <IntegrationCard
        variant="catalog"
        name="Linear"
        brand="linear"
        tagline="Issues"
        connected
        onOpen={onOpen}
      />,
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('IntegrationHandshake', () => {
  it('announces progress', async () => {
    const { container, rerender } = renderNacre(
      <IntegrationHandshake name="Notion" phase="waiting" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Notion: Connecting…');
    rerender(<IntegrationHandshake name="Notion" phase="connected" />);
    expect(screen.getByRole('status')).toHaveTextContent('Notion: Connected');
    await expectAccessible(container);
  });
});

describe('ToolPermissionList', () => {
  it('groups tools and follows the policy unless you choose', async () => {
    const onChange = vi.fn();
    const { container } = renderNacre(
      <ToolPermissionList tools={notionTools} policy="ask-writes" onChange={onChange} />,
    );
    expect(screen.getByRole('heading', { name: /Looks things up 3/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Makes changes 4/ })).toBeInTheDocument();
    const checked = (name: string) =>
      within(screen.getByRole('radiogroup', { name })).getByRole('radio', { checked: true });
    expect(checked('Search')).toHaveTextContent('Allow');
    expect(checked('Create pages')).toHaveTextContent('Ask');
    expect(checked('Delete a page')).toHaveTextContent('Off');
    expect(screen.getByText('Can delete')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('clears the override when you pick the default again', async () => {
    const onChange = vi.fn();
    renderNacre(<ToolPermissionList tools={notionTools} policy="ask-writes" onChange={onChange} />);
    const pick = (tool: string, choice: string) =>
      userEvent.click(
        within(screen.getByRole('radiogroup', { name: tool })).getByRole('radio', { name: choice }),
      );
    await pick('Edit a page', 'Ask');
    expect(onChange).toHaveBeenLastCalledWith('notion-update-page', null);
    await pick('Create pages', 'Off');
    expect(onChange).toHaveBeenLastCalledWith('notion-create-pages', 'off');
    await userEvent.click(screen.getByRole('button', { name: 'Reset 2 tools you changed' }));
    expect(onChange).toHaveBeenCalledWith('notion-delete', null);
  });

  it('never offers Allow for a tool that always asks, whatever the policy', async () => {
    const onChange = vi.fn();
    const { container } = renderNacre(
      <ToolPermissionList
        tools={[
          {
            name: 'google_calendar_create_event',
            title: 'Add an event',
            access: 'write',
            alwaysAsks: true,
          },
        ]}
        policy="trust"
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Add an event' });
    expect(within(group).queryByRole('radio', { name: 'Allow' })).not.toBeInTheDocument();
    expect(within(group).getByRole('radio', { checked: true })).toHaveTextContent('Ask');
    expect(screen.getByText('Always asks')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('radio', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith('google_calendar_create_event', 'off');
    expect(defaultPermission({ access: 'write', alwaysAsks: true }, 'trust')).toBe('ask');
    await expectAccessible(container);
  });

  it('says what each choice means under it, so Off never reads as “don’t ask”', async () => {
    const { container } = renderNacre(
      <ToolPermissionList
        assistant="Conch"
        tools={[
          { name: 'search', title: 'Search', access: 'read' },
          { name: 'send', title: 'Send an email', access: 'write', asksFirst: true },
          { name: 'post', title: 'Post', access: 'write', policy: 'off' },
        ]}
        policy="ask-writes"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Search' })).toHaveAccessibleDescription(
      'Uses it without asking.',
    );
    expect(screen.getByRole('radiogroup', { name: 'Send an email' })).toHaveAccessibleDescription(
      'Asks you each time.',
    );
    expect(screen.getByRole('radiogroup', { name: 'Post' })).toHaveAccessibleDescription(
      'You turned this off. Conch can’t use it.',
    );
    // No unexplained dot: the words say whose choice it is.
    expect(screen.queryByTitle('You changed this')).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('turns a tool you switched off back on in one press', async () => {
    const onChange = vi.fn();
    renderNacre(
      <ToolPermissionList
        tools={[
          { name: 'send', title: 'Send an email', access: 'write', asksFirst: true, policy: 'off' },
        ]}
        policy="ask-writes"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn on Send an email' }));
    expect(onChange).toHaveBeenLastCalledWith('send', null);
  });

  it('lets a tool that speaks for you be allowed, says what that means, and undoes it', async () => {
    const onChange = vi.fn();
    const send = {
      name: 'google_mail_send',
      title: 'Send an email',
      access: 'write' as const,
      asksFirst: true,
      allowWarning: 'Conch will send emails without showing you first.',
    };
    const { container, rerender } = renderNacre(
      <ToolPermissionList tools={[send]} policy="trust" onChange={onChange} assistant="Conch" />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Send an email' });
    // Don't ask on the app doesn't make it send unasked: Ask until this one tool says Allow.
    expect(within(group).getByRole('radio', { checked: true })).toHaveTextContent('Ask');
    expect(screen.queryByText('Always asks')).not.toBeInTheDocument();
    await userEvent.click(within(group).getByRole('radio', { name: 'Allow' }));
    expect(onChange).toHaveBeenLastCalledWith('google_mail_send', 'allow');
    rerender(
      <ToolPermissionList
        tools={[{ ...send, policy: 'allow' }]}
        policy="trust"
        onChange={onChange}
        assistant="Conch"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Conch will send emails without showing you first.',
    );
    expect(screen.getByRole('radiogroup', { name: 'Send an email' })).toHaveAccessibleDescription(
      'Doesn’t ask. Still asks if the chat read something from outside.',
    );
    await expectAccessible(container);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onChange).toHaveBeenLastCalledWith('google_mail_send', null);
    expect(defaultPermission({ access: 'write', asksFirst: true }, 'trust')).toBe('ask');
  });

  it('matches the protocol’s defaults', () => {
    expect(defaultPermission({ access: 'read' }, 'ask-writes')).toBe('allow');
    expect(defaultPermission({ access: 'read', destructive: true }, 'ask-writes')).toBe('ask');
    expect(defaultPermission({ access: 'write' }, 'ask-writes')).toBe('ask');
    expect(defaultPermission({ access: 'read' }, 'ask')).toBe('ask');
    expect(defaultPermission({ access: 'write' }, 'trust')).toBe('allow');
    expect(humanizeTool('create_pull_request')).toBe('Create pull request');
    expect(humanizeTool('getIssueComments')).toBe('Get issue comments');
  });
});

describe('IntegrationIssueCard', () => {
  it('says what broke and offers the fix', async () => {
    const onFix = vi.fn();
    const { container } = renderNacre(
      <IntegrationIssueCard
        name="Notion"
        state="needs-auth"
        message="Sign in again."
        onFix={onFix}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Notion needs you to sign in again');
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(onFix).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});
