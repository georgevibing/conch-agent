import { expect, it, vi } from 'vitest';
import { waitNotifications } from './notifications';

const telegram = { id: 'telegram-one', kind: 'telegram' as const, name: 'Telegram' };
const email = { id: 'email-one', kind: 'email' as const, name: 'Email' };
it('sends only to the explicitly selected app, with no routine broadcast or fallback', async () => {
  const messageOwner = vi.fn(
    async (_text: string, _options?: { channelId?: string; conversationId?: string }) => ({
      app: 'Telegram',
    }),
  );
  const route = waitNotifications(() => ({
    sendable: async () => [telegram, email],
    messageOwner,
  }));
  const notification = await route.notificationTarget?.('Telegram');
  if (!notification) throw new Error('missing destination');
  await route.tell?.({
    title: 'CI passed',
    body: 'All green',
    conversationId: 'c_one',
    waitId: 'w_one',
    notification,
  });
  expect(messageOwner).toHaveBeenCalledExactlyOnceWith('**CI passed**\nAll green', {
    channelId: telegram.id,
    conversationId: 'c_one',
  });
  messageOwner.mockRejectedValueOnce(new Error('offline'));
  await expect(
    route.tell?.({
      title: 'CI passed',
      body: '',
      conversationId: 'c_one',
      waitId: 'w_two',
      notification,
    }),
  ).rejects.toThrow('offline');
  expect(messageOwner).toHaveBeenCalledTimes(2);
  expect(messageOwner.mock.calls.every((c) => c[1]?.channelId === telegram.id)).toBe(true);
});
it('refuses a missing or ambiguous destination instead of guessing', async () => {
  const messageOwner = vi.fn(
    async (_text: string, _options?: { channelId?: string; conversationId?: string }) => ({
      app: 'Telegram',
    }),
  );
  const route = waitNotifications(() => ({
    sendable: async () => [telegram, { ...telegram, id: 'telegram-two' }, email],
    messageOwner,
  }));
  await expect(route.notificationTarget?.('Telegram')).rejects.toThrow('More than one');
  await expect(route.notificationTarget?.('WhatsApp')).rejects.toThrow('not connected');
  await expect(route.notificationTarget?.('email-one')).resolves.toEqual({
    id: email.id,
    name: 'Email',
  });
  expect(messageOwner).not.toHaveBeenCalled();
});

it('resolves the channel service only after application initialization', async () => {
  let ready = false;
  const messageOwner = vi.fn(async () => ({ app: 'Telegram' }));
  const channels = vi.fn(() => {
    if (!ready) throw new Error('channels have not initialized');
    return { sendable: async () => [telegram], messageOwner };
  });
  const route = waitNotifications(channels);
  expect(channels).not.toHaveBeenCalled();
  ready = true;
  const notification = await route.notificationTarget?.('Telegram');
  if (!notification) throw new Error('missing destination');
  await route.tell?.({
    title: 'Done',
    body: 'Ready',
    conversationId: 'c_one',
    waitId: 'w_one',
    notification,
  });
  expect(messageOwner).toHaveBeenCalledExactlyOnceWith('**Done**\nReady', {
    channelId: telegram.id,
    conversationId: 'c_one',
  });
});
