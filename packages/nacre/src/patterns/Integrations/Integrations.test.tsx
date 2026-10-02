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
            name: 'google_mail_create_draft',
            title: 'Save a draft',
            access: 'write',
            alwaysAsks: true,
          },
        ]}
        policy="trust"
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Save a draft' });
    expect(within(group).queryByRole('radio', { name: 'Allow' })).not.toBeInTheDocument();
    expect(within(group).getByRole('radio', { checked: true })).toHaveTextContent('Ask');
    expect(screen.getByText('Always asks')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('radio', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith('google_mail_create_draft', 'off');
    expect(defaultPermission({ access: 'write', alwaysAsks: true }, 'trust')).toBe('ask');
    await expectAccessible(container);
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
