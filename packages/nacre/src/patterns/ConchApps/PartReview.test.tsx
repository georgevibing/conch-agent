import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ProviderCard } from '../Providers/ProviderCard';
import { AppMadeBadge } from './AppMadeBadge';
import { AppOffer } from './AppOffer';
import {
  fireworks,
  fireworksProvider,
  fireworksWords,
  zulip,
  zulipChannel,
  zulipWords,
} from './fixtures';
import { MakeWithConch } from './MakeWithConch';
import { PartReview, partReady } from './PartReview';

const card = (over: Partial<Parameters<typeof AppOffer>[0]> = {}) => (
  <AppOffer
    action="add"
    manifest={fireworks}
    tools={[]}
    source={{ kind: 'made' }}
    signature={{ state: 'unsigned' }}
    words={fireworksWords}
    state="ready"
    brings={{ provider: fireworksProvider }}
    {...over}
  />
);

describe('PartReview', () => {
  it('says what a provider is, where its key goes, and its models with their price', async () => {
    const { container } = renderNacre(
      <PartReview
        provider={fireworksProvider}
        values={{ key: '', fields: {} }}
        onValuesChange={() => {}}
        test={{ state: 'idle' }}
        onTest={() => {}}
      />,
    );
    const review = screen.getByRole('region', { name: 'Fireworks AI, as a provider' });
    expect(review).toHaveTextContent('its key goes only to api.fireworks.ai');
    const models = within(review).getByRole('list', { name: 'Fireworks AI’s models' });
    expect(models).toHaveTextContent('Llama 4 Maverick');
    expect(models).toHaveTextContent('1M');
    expect(models).toHaveTextContent('$0.22 in · $0.88 out');
    // Nothing to test with until the key is in.
    expect(screen.getByRole('button', { name: 'Test it' })).toBeDisabled();
    expect(screen.getByText('Paste your Fireworks API key to test it.')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows a chat app’s steps and every field it needs', async () => {
    const onValuesChange = vi.fn();
    const { container } = renderNacre(
      <PartReview
        channel={zulipChannel}
        values={{ key: '', fields: {} }}
        onValuesChange={onValuesChange}
        test={{ state: 'idle' }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Talk to me on Zulip' })).toHaveTextContent(
      'it can’t read your chats or use your apps',
    );
    expect(
      within(screen.getByRole('list', { name: 'In Zulip' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    await userEvent.type(screen.getByLabelText('Your Zulip address'), 'h');
    expect(onValuesChange).toHaveBeenLastCalledWith({ key: '', fields: { site: 'h' } });
    // A token is masked; an address isn't.
    expect(screen.getByLabelText('The bot’s API key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Your Zulip address')).not.toHaveAttribute('type', 'password');
    await expectAccessible(container);
  });

  it('knows when everything the test needs is typed', () => {
    expect(partReady({ provider: fireworksProvider }, { key: ' ', fields: {} })).toBe(false);
    expect(partReady({ provider: fireworksProvider }, { key: 'fw_1', fields: {} })).toBe(true);
    expect(
      partReady({ provider: { ...fireworksProvider, key: undefined } }, { key: '', fields: {} }),
    ).toBe(true);
    expect(
      partReady({ channel: zulipChannel }, { key: '', fields: { site: 'a', email: 'b' } }),
    ).toBe(false);
  });
});

describe('AppOffer with a provider', () => {
  it('tests the key, then adds it, with the key going along and nothing else', async () => {
    const onTest = vi.fn(async () => ({
      state: 'passed' as const,
      said: 'Hello there!',
      model: fireworksProvider.models[0]?.id,
      ms: 512,
    }));
    const onAdd = vi.fn();
    const { container } = renderNacre(card({ onTest, onAdd }));
    const add = screen.getByRole('button', { name: 'Add Fireworks AI to my providers' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Fireworks API key'), 'fw_123');
    // Typed, but not tested: Add still waits.
    expect(add).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Test it' }));
    expect(onTest).toHaveBeenCalledWith({ key: 'fw_123', fields: {} });
    expect(await screen.findByText(/Llama 4 Maverick answered in 0\.5 s/)).toBeInTheDocument();
    expect(add).toBeEnabled();
    await expectAccessible(container);
    await userEvent.click(add);
    expect(onAdd).toHaveBeenCalledWith({}, { key: 'fw_123', fields: {} });
  });

  it('says why a test failed, and typing again asks for another', async () => {
    const onTest = vi.fn(async () => ({
      state: 'failed' as const,
      message: 'Fireworks AI refused your key.',
    }));
    renderNacre(card({ onTest }));
    await userEvent.type(screen.getByLabelText('Fireworks API key'), 'fw_x');
    await userEvent.click(screen.getByRole('button', { name: 'Test it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fireworks AI refused your key.');
    await userEvent.type(screen.getByLabelText('Fireworks API key'), 'y');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Test it' })).toBeEnabled();
  });

  it('once added, says where to find it', async () => {
    renderNacre(card({ state: 'added' }));
    expect(screen.getByRole('status')).toHaveTextContent('Fireworks AI is one of your providers');
    expect(screen.getByText(/Pick Llama 4 Maverick in the model picker/)).toBeInTheDocument();
  });

  it('a chat app’s card: Add to Talk to me here, once its bot answered', async () => {
    const onAdd = vi.fn();
    renderNacre(
      card({
        manifest: zulip,
        words: zulipWords,
        brings: { channel: zulipChannel },
        onAdd,
        onTest: async () => ({ state: 'passed', said: 'Connected as Conch (@conch-bot)', ms: 300 }),
      }),
    );
    await userEvent.type(screen.getByLabelText('Your Zulip address'), 'https://a.zulipchat.com');
    await userEvent.type(screen.getByLabelText('The bot’s email'), 'bot@a.zulipchat.com');
    await userEvent.type(screen.getByLabelText('The bot’s API key'), 'k');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Test it' }));
    });
    expect(
      await screen.findByText(
        /Connected as Conch \(@conch-bot\)\. After you add it, say hello from Zulip/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Zulip to Talk to me here' }));
    expect(onAdd).toHaveBeenCalledWith(
      {},
      {
        key: '',
        fields: { site: 'https://a.zulipchat.com', email: 'bot@a.zulipchat.com', apiKey: 'k' },
      },
    );
  });
});

describe('MakeWithConch', () => {
  it('makes one from a name typed or tapped, with Enter or the button', async () => {
    const onMake = vi.fn();
    const { container } = renderNacre(
      <MakeWithConch
        question="Which provider?"
        note="Nothing is added until you press Add."
        examples={['Fireworks AI', 'Baseten']}
        onMake={onMake}
      />,
    );
    const make = screen.getByRole('button', { name: 'Make it with Conch' });
    expect(make).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Baseten' }));
    expect(screen.getByLabelText('Which provider?')).toHaveValue('Baseten');
    await userEvent.click(make);
    expect(onMake).toHaveBeenLastCalledWith('Baseten');
    await userEvent.clear(screen.getByLabelText('Which provider?'));
    await userEvent.type(screen.getByLabelText('Which provider?'), 'Groq{Enter}');
    expect(onMake).toHaveBeenLastCalledWith('Groq');
    await expectAccessible(container);
  });
});

describe('where it came from', () => {
  it('a provider card says made by you, or added from a link', async () => {
    const { container } = renderNacre(
      <>
        <ProviderCard name="Fireworks AI" tagline="Fast open models" state="ready" origin="made" />
        <ProviderCard name="Baseten" tagline="Models at work" state="signed-out" origin="link" />
        <AppMadeBadge kind="link" />
      </>,
    );
    expect(screen.getByText('Made by you')).toBeInTheDocument();
    expect(screen.getAllByText('Added from a link')).toHaveLength(2);
    await expectAccessible(container);
  });
});
