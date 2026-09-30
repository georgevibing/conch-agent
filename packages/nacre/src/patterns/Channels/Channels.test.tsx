import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { brandArt } from '../Integrations/brands';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { ChannelCard, ChannelSoon, ChannelTile } from './ChannelCard';
import { ChannelRequest, PersonRow } from './ChannelPeople';
import { GuideSteps } from './GuideSteps';
import { Handset } from './Handset';
import { HelloCard } from './HelloCard';
import { KeyField } from './KeyField';
import { PortalSketch } from './PortalSketch';

describe('Channel logos', () => {
  it('keeps Slack’s own colours, and draws the others as marks', async () => {
    const { container } = renderNacre(
      <>
        <IntegrationLogo brand="slack" name="Slack" />
        <IntegrationLogo brand="telegram" name="Telegram" color="#26A5E4" />
      </>,
    );
    const slack = screen.getByRole('img', { name: 'Slack' });
    const fills = [...slack.querySelectorAll('path')].map((p) => p.getAttribute('fill'));
    expect(fills).toEqual(brandArt.slack?.paths.map((p) => p.fill));
    expect(screen.getByRole('img', { name: 'Telegram' }).querySelectorAll('path')).toHaveLength(1);
    await expectAccessible(container);
  });
});

describe('ChannelTile', () => {
  it('is one button that connects, and says how long it takes', async () => {
    const onConnect = vi.fn();
    const { container } = renderNacre(
      <ChannelTile
        brand="telegram"
        name="Telegram"
        tagline="The easiest."
        minutes={2}
        onConnect={onConnect}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.getByText('About 2 minutes')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('lists what’s coming without making it look pressable', async () => {
    const { container } = renderNacre(
      <ChannelSoon
        apps={[
          { brand: 'signal', name: 'Signal' },
          { brand: 'whatsapp', name: 'WhatsApp' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Coming soon' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
    await expectAccessible(container);
  });
});

describe('ChannelCard', () => {
  it('says what’s wrong and offers the one fix', async () => {
    const onFix = vi.fn();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const { container } = renderNacre(
      <ChannelCard
        brand="telegram"
        app="Telegram"
        name="Ada’s Conch"
        handle="adas_conch_bot"
        state="needs-token"
        message="Telegram stopped accepting this bot’s key."
        action={{ label: 'Paste the new key', onClick: onFix }}
        enabled
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    );
    const card = screen.getByRole('article', { name: /Ada’s Conch/ });
    expect(card).toHaveAccessibleDescription(/stopped accepting/);
    await userEvent.click(screen.getByRole('button', { name: 'Paste the new key' }));
    expect(onFix).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('switch', { name: 'Turn off Telegram' }));
    expect(onToggle).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Ada’s Conch' }));
    expect(onOpen).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('shows quiet facts when all is well, and counts requests', () => {
    renderNacre(
      <ChannelCard
        brand="discord"
        app="Discord"
        name="Conch"
        state="online"
        meta="You and Grace"
        requests={2}
        enabled
      />,
    );
    expect(screen.getByText('You and Grace')).toBeInTheDocument();
    expect(screen.getByText('2 requests')).toBeInTheDocument();
  });
});

describe('GuideSteps', () => {
  it('marks the step you’re on and folds finished ones to a line you can change', async () => {
    const onEdit = vi.fn();
    const { container } = renderNacre(
      <GuideSteps label="Connect Telegram">
        <GuideSteps.Step
          number={1}
          title="Make your bot"
          state="done"
          summary="Done in BotFather"
          onEdit={onEdit}
        >
          hidden
        </GuideSteps.Step>
        <GuideSteps.Step number={2} title="Paste its key" state="current">
          <p>Paste here</p>
        </GuideSteps.Step>
        <GuideSteps.Step number={3} title="Say hello" state="upcoming">
          later
        </GuideSteps.Step>
      </GuideSteps>,
    );
    const list = screen.getByRole('list', { name: 'Connect Telegram' });
    const [first, second, third] = within(list).getAllByRole('listitem');
    expect(second).toHaveAttribute('aria-current', 'step');
    expect(first).toHaveTextContent('Done in BotFather');
    expect(first).not.toHaveTextContent('hidden');
    expect(third).not.toHaveTextContent('later');
    expect(screen.getByText('Paste here')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onEdit).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});

describe('Handset', () => {
  it('is a captioned picture whose words can still be read', async () => {
    const { container } = renderNacre(
      <Handset
        label="What you’ll see in Telegram"
        brand="telegram"
        title="BotFather"
        messages={[
          { id: '1', from: 'you', text: '/newbot' },
          {
            id: '2',
            from: 'them',
            text: (
              <>
                Your key: <Handset.Key>123:abc</Handset.Key>
              </>
            ),
          },
        ]}
        typing
        footer={<Handset.Action>START</Handset.Action>}
      />,
    );
    expect(screen.getByRole('figure', { name: 'What you’ll see in Telegram' })).toBeInTheDocument();
    expect(screen.getByText('You:')).toBeInTheDocument();
    expect(screen.getByText('123:abc').tagName).toBe('MARK');
    expect(screen.getByText('BotFather is writing')).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('HelloCard', () => {
  it('while waiting: a link that opens the app, a QR code and how long it lasts', async () => {
    const { container } = renderNacre(
      <HelloCard
        state="waiting"
        title="Say hello"
        link="https://t.me/bot?start=abc"
        openLabel="Open in Telegram"
        expiresAt={Date.now() + 9 * 60_000 + 1000}
      />,
    );
    const link = screen.getByRole('link', { name: 'Open in Telegram' });
    expect(link).toHaveAttribute('href', 'https://t.me/bot?start=abc');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('img', { name: /Scan with your phone’s camera/ })).toBeInTheDocument();
    expect(screen.getByText(/10 more minutes|9 more minutes/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('when expired, makes a new link; when done, offers what’s next', async () => {
    const onRenew = vi.fn();
    const { rerender } = renderNacre(
      <HelloCard
        state="expired"
        title="That link expired"
        link="https://t.me/bot"
        openLabel="Open"
        onRenew={onRenew}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(onRenew).toHaveBeenCalledOnce();
    rerender(
      <HelloCard
        state="done"
        title="You’re connected"
        openLabel="Open"
        actions={<button type="button">Send a test</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send a test' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('KeyField', () => {
  it('takes a typed or pasted key, and says whose it is or what’s wrong', async () => {
    const onValueChange = vi.fn();
    const readText = vi.fn().mockResolvedValue('  123:abc  ');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    const { container, rerender } = renderNacre(
      <KeyField
        label="Bot key"
        value=""
        onValueChange={onValueChange}
        status="idle"
        description="Where to find it."
      />,
    );
    await userEvent.type(screen.getByLabelText('Bot key'), 'x');
    expect(onValueChange).toHaveBeenLastCalledWith('x');
    await userEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(onValueChange).toHaveBeenLastCalledWith('123:abc');
    await expectAccessible(container);

    rerender(
      <KeyField
        label="Bot key"
        value="123:abc"
        onValueChange={onValueChange}
        status="ok"
        found="Found @bot"
      />,
    );
    expect(screen.getByText('Found @bot')).toBeInTheDocument();

    rerender(
      <KeyField
        label="Bot key"
        value="nope"
        onValueChange={onValueChange}
        status="error"
        error="Telegram doesn’t recognise this key."
      />,
    );
    expect(screen.getByLabelText('Bot key')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Telegram doesn’t recognise this key.')).toBeInTheDocument();
  });

  it('asks for the keyboard when the clipboard can’t be read', async () => {
    const readText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    renderNacre(
      <KeyField label="Bot key" value="" onValueChange={() => undefined} status="idle" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(screen.getByText(/Press Ctrl\+V/)).toBeInTheDocument();
    expect(screen.getByLabelText('Bot key')).toHaveFocus();
  });
});

describe('ChannelRequest and PersonRow', () => {
  it('asks “Is this you?” for the first hello', async () => {
    const onAllow = vi.fn();
    const onBlock = vi.fn();
    const { container } = renderNacre(
      <ChannelRequest
        hello
        name="Ada Lovelace"
        username="ada"
        preview="hi"
        onAllow={onAllow}
        onBlock={onBlock}
      />,
    );
    expect(screen.getByRole('article', { name: 'Is this you? Ada Lovelace' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'That’s me' }));
    expect(onAllow).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Not me' }));
    expect(onBlock).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('lets someone else in, blocks or clears them', async () => {
    const onDismiss = vi.fn();
    renderNacre(
      <ChannelRequest
        name="Grace Hopper"
        preview="hello?"
        count={2}
        when="3 minutes ago"
        onAllow={() => undefined}
        onBlock={() => undefined}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('button', { name: 'Let them in' })).toBeInTheDocument();
    expect(screen.getByText(/2 messages, the last 3 minutes ago/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear Grace Hopper’s request' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('removes a person by name', async () => {
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <ul>
        <PersonRow name="Ada" badge="You" />
        <PersonRow name="Grace" onRemove={onRemove} removeLabel="Stop Grace talking to Conch" />
      </ul>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Stop Grace talking to Conch' }));
    expect(onRemove).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});

describe('PortalSketch', () => {
  it('names the place and says which button to press', async () => {
    const { container } = renderNacre(
      <PortalSketch
        label="The Bot page"
        address="discord.com/developers"
        nav={['General', 'Bot']}
        active="Bot"
        title="Bot"
      >
        <PortalSketch.Button>Reset Token</PortalSketch.Button>
      </PortalSketch>,
    );
    expect(screen.getByRole('figure', { name: 'The Bot page' })).toBeInTheDocument();
    expect(
      screen.getByText('Reset Token').parentElement ?? screen.getByText('Reset Token'),
    ).toHaveTextContent('Reset Token (press this)');
    expect(screen.getByText('(open this)', { exact: false })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
