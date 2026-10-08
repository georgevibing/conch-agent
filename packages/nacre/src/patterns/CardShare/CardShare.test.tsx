import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CardShare, type ShareApp } from './CardShare';

const telegram: ShareApp = { id: 'ch_1', kind: 'telegram', name: 'Telegram', color: '#26A5E4' };
const whatsapp: ShareApp = { id: 'ch_2', kind: 'whatsapp', name: 'WhatsApp', color: '#25D366' };
const apps = [telegram, whatsapp];

const noop = () => undefined;
/** A copy that put the picture on the clipboard. */
const copied = () => 'image' as const;

describe('CardShare', () => {
  it('is three named buttons and passes axe', async () => {
    const { container } = renderNacre(
      <CardShare what="chart" apps={apps} onSaveImage={noop} onCopy={copied} onSend={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Save as image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('leaves Send out with no app connected, and keeps the rest working', async () => {
    const save = vi.fn();
    renderNacre(<CardShare apps={[]} onSaveImage={save} onCopy={copied} onSend={noop} />);
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save as image' }));
    expect(save).toHaveBeenCalledOnce();
  });

  it('only shows what the card can do', () => {
    renderNacre(<CardShare apps={apps} onSend={noop} />);
    expect(screen.queryByRole('button', { name: 'Save as image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('sends nothing until the app is chosen and the question answered', async () => {
    const send = vi.fn();
    renderNacre(<CardShare what="chart" apps={apps} onSend={send} />);

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Send this chart to')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();

    // Choosing an app only asks the question, with the app's name in it.
    await userEvent.click(screen.getByRole('button', { name: 'Telegram' }));
    expect(await screen.findByText('Send this chart to Telegram?')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Send to Telegram' }));
    expect(send).toHaveBeenCalledExactlyOnceWith(telegram);
    expect(await screen.findByText('Sent to Telegram')).toBeInTheDocument();
  });

  it('cancel goes back to the apps without sending', async () => {
    const send = vi.fn();
    renderNacre(<CardShare apps={apps} onSend={send} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'WhatsApp' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'WhatsApp' })).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it('reaches every app and the question with the keyboard alone', async () => {
    const send = vi.fn();
    renderNacre(<CardShare what="forecast" apps={apps} onSend={send} />);
    const trigger = screen.getByRole('button', { name: 'Send' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const telegram = await screen.findByRole('button', { name: 'Telegram' });
    await waitFor(() => expect(document.activeElement).not.toBe(trigger));
    telegram.focus();
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toHaveAccessibleName('WhatsApp');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Send this forecast to WhatsApp?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send to WhatsApp' }));
    expect(send).toHaveBeenCalledExactlyOnceWith(whatsapp);
  });

  it('Escape closes the menu and sends nothing', async () => {
    const send = vi.fn();
    renderNacre(<CardShare apps={apps} onSend={send} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Telegram' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Telegram' })).not.toBeInTheDocument(),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('says what the failure was, in the words it was given', async () => {
    const done = vi.fn();
    renderNacre(
      <CardShare
        apps={apps}
        onDone={done}
        onSend={() => Promise.reject(new Error('Telegram isn’t connected right now.'))}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Telegram' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send to Telegram' }));
    expect(await screen.findByText('Telegram isn’t connected right now.')).toBeInTheDocument();
    expect(done).toHaveBeenCalledWith({
      kind: 'failed',
      message: 'Telegram isn’t connected right now.',
    });
  });

  it('says when a copy fell back to words', async () => {
    const done = vi.fn();
    renderNacre(
      <CardShare apps={apps} onCopy={() => Promise.resolve('text' as const)} onDone={done} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied as text')).toBeInTheDocument();
    expect(done).toHaveBeenCalledWith({ kind: 'copied', as: 'text' });
  });

  it('lets the card hold the menu and what it is doing', async () => {
    const onOpenChange = vi.fn();
    renderNacre(
      <CardShare
        what="chart"
        apps={apps}
        open
        onOpenChange={onOpenChange}
        confirming="ch_2"
        doing={{ kind: 'sending', app: whatsapp }}
        onSend={noop}
      />,
    );
    expect(await screen.findByText('Send this chart to WhatsApp?')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Controlled: it stays open until the card says otherwise.
    expect(screen.getByText('Send this chart to WhatsApp?')).toBeInTheDocument();
  });

  it('is not in the picture a card makes of itself', () => {
    const { container } = renderNacre(<CardShare apps={apps} onSaveImage={noop} />);
    expect(container.querySelector('[data-share-hide]')).toBeInTheDocument();
  });
});
