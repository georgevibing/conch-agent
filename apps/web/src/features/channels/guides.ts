/**
 * The words and links for setting up each app, worked out for the person so
 * they never have to invent a name or find a settings page.
 */

export const BOTFATHER_URL = 'https://t.me/BotFather';
export const DISCORD_PORTAL_URL = 'https://discord.com/developers/applications';
export const SLACK_APPS_URL = 'https://api.slack.com/apps';

/** Letters, digits and underscores only, as Telegram usernames allow. */
function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 14);
}

/**
 * A name and a username for a new Telegram bot. Usernames are taken across all
 * of Telegram, so a few digits make this one very likely to be free.
 */
export function telegramNames(
  assistant: string,
  owner: string | undefined,
  digits: string,
): { name: string; username: string } {
  const first = owner?.trim().split(/\s+/)[0];
  const name = first ? `${assistant} for ${first}` : assistant;
  const who = slug(first ?? '') || 'my';
  const what = slug(assistant) || 'conch';
  return { name: name.slice(0, 64), username: `${who}_${what}_${digits}_bot`.slice(0, 32) };
}

/** Four digits, fixed for a visit so the suggestion doesn't change under you. */
export function randomDigits(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * Everything the Slack app needs, so the person only presses Next and Create:
 * a bot you can DM (Messages tab on), the events and permissions it uses, and
 * Socket Mode (no public address needed).
 */
export function slackManifest(assistant: string) {
  const name = assistant.slice(0, 35) || 'Conch';
  return {
    display_information: {
      name,
      description: 'Your assistant on Conch, running on your own computer.',
      background_color: '#1d1c1d',
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: {
        display_name:
          name
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .slice(0, 80) || 'conch',
        always_online: true,
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          'chat:write',
          'im:history',
          'im:read',
          'im:write',
          'users:read',
          'files:read',
          'reactions:write',
        ],
      },
    },
    settings: {
      event_subscriptions: { bot_events: ['message.im'] },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}

/**
 * A page of one Slack app's settings, straight there when its id is known
 * (a key gives it away), else the list of your apps to pick it from.
 */
export function slackAppUrl(
  appId: string | undefined,
  page: 'general' | 'install-on-team' | 'socket-mode',
): string {
  return appId && /^A[A-Z0-9]{6,20}$/.test(appId)
    ? `${SLACK_APPS_URL}/${appId}/${page}`
    : SLACK_APPS_URL;
}

/** Opens Slack's "create an app" with everything filled in. */
export function slackCreateUrl(assistant: string): string {
  return `${SLACK_APPS_URL}?new_app=1&manifest_json=${encodeURIComponent(
    JSON.stringify(slackManifest(assistant)),
  )}`;
}
