import type { ChannelSecrets } from '@conch/protocol';

/**
 * A channel's keys as Passwords lists them (`Services.#systemKeys`): what
 * each is called, and its value (shown only when the person reveals it).
 * Values Conch made and keeps for itself are listed too, so nothing about
 * a channel is a secret nobody can see.
 */
export function channelKeys(secrets: ChannelSecrets): [string, string][] {
  switch (secrets.kind) {
    case 'slack':
      return [
        ['bot token', secrets.botToken],
        ['app token', secrets.appToken],
      ];
    case 'microsoftteams':
      return [['client secret', secrets.appPassword]];
    case 'matrix':
      return secrets.accessToken ? [['access token', secrets.accessToken]] : [];
    case 'wechat':
      return [
        [secrets.mode === 'wecom' ? 'bot secret' : 'AppSecret', secrets.secret],
        ...(secrets.token ? ([['server Token', secrets.token]] as [string, string][]) : []),
        ...(secrets.aesKey ? ([['EncodingAESKey', secrets.aesKey]] as [string, string][]) : []),
      ];
    case 'email':
      return [['app password', secrets.password]];
    case 'sms':
      return [['Auth Token', secrets.authToken]];
    case 'mattermost':
      return [['bot access token', secrets.token]];
    case 'line':
      return [
        ['channel secret', secrets.channelSecret],
        ['channel access token', secrets.accessToken],
      ];
    // iMessage has no key; a linked device's keys are listed apart (`Services.#systemKeys`).
    case 'imessage':
    case 'whatsapp':
    case 'signal':
      return [];
    default:
      return [['bot token', secrets.token]];
  }
}
