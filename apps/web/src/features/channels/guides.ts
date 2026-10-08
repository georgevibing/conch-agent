import { type MailProvider, SLACK_USER_SCOPES } from '@conch/protocol';

/**
 * The words and links for setting up each app, worked out for the person so
 * they never have to invent a name or find a settings page.
 */

export const BOTFATHER_URL = 'https://t.me/BotFather';
export const DISCORD_PORTAL_URL = 'https://discord.com/developers/applications';
export const SLACK_APPS_URL = 'https://api.slack.com/apps';
export const TEAMS_BOTS_URL = 'https://dev.teams.microsoft.com/bots';
/** Twilio: the Console's first page (Account Info), and buying a number that can text. */
export const TWILIO_CONSOLE_URL = 'https://console.twilio.com/';
/** LINE: where an Official Account is made, and where its channel's keys are. */
export const LINE_MANAGER_URL = 'https://manager.line.biz/';
/** Google Chat: the API to turn on, service accounts, and the Chat app's configuration. */
export const GOOGLE_CHAT_API_URL =
  'https://console.cloud.google.com/apis/library/chat.googleapis.com';
export const GOOGLE_SERVICE_ACCOUNTS_URL =
  'https://console.cloud.google.com/iam-admin/serviceaccounts';
export const GOOGLE_CHAT_CONFIG_URL =
  'https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat';
export const LINE_CONSOLE_URL = 'https://developers.line.biz/console/';
export const TWILIO_NUMBERS_URL =
  'https://console.twilio.com/us1/develop/phone-numbers/manage/search?capabilities[sms]=true';
export const WECOM_URL = 'https://work.weixin.qq.com/';
export const WECOM_BOT_DOCS_URL = 'https://developer.work.weixin.qq.com/document/path/101463';
export const WECHAT_SANDBOX_URL = 'https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login';

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

/** A username and a display name for the assistant's own Matrix account. */
export function matrixNames(
  assistant: string,
  owner: string | undefined,
  digits: string,
): { name: string; username: string } {
  const { name, username } = telegramNames(assistant, owner, digits);
  return { name, username: username.replace(/_bot$/, '').replaceAll('_', '-') };
}

/** Four digits, fixed for a visit so the suggestion doesn't change under you. */
export function randomDigits(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * Everything the Slack app needs, so the person only presses Next and Create:
 * a bot you can DM (Messages tab on), the events and permissions it uses, and
 * Socket Mode (no public address needed). One app does both Slack jobs: the
 * channel (its bot) and Slack with every model (ADR 0049), which reads and
 * sends as you with the user scopes. Installing it once covers both.
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
      // Slack keeps messages that start with / for its own commands: Conch's go after this one.
      slash_commands: [
        {
          command: '/conch',
          description: `Conch’s commands: model, clear, goal, plan, help…`,
          usage_hint: '[model | effort | clear | goal | plan | help]',
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          'chat:write',
          // Mentioned in a channel you turned on (ADR 0075), and that channel's name.
          'app_mentions:read',
          'channels:read',
          'im:history',
          'im:read',
          'im:write',
          'users:read',
          'files:read',
          // Pictures and files Conch made, sent in the chat.
          'files:write',
          'reactions:write',
        ],
        user: [...SLACK_USER_SCOPES],
      },
    },
    settings: {
      event_subscriptions: { bot_events: ['message.im', 'app_mention'] },
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
  page: 'general' | 'install-on-team' | 'socket-mode' | 'app-manifest',
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

/**
 * Each mail service as the email setup shows it (ADR 0044): where its app
 * passwords are made, and the steps to get there. The gateway knows the
 * same services' servers (`channels/email.ts`).
 */
export const MAIL_SERVICES = [
  {
    id: 'gmail',
    name: 'Gmail',
    passwords: 'https://myaccount.google.com/apppasswords',
    steps:
      'Google opens App passwords. Type “Conch” as the name, press Create, and copy the 16 letters it shows.',
    note: 'If Google says the setting isn’t available, turn on 2-Step Verification first (Security → 2-Step Verification), then come back.',
    plus: true,
  },
  {
    id: 'icloud',
    name: 'iCloud',
    passwords: 'https://account.apple.com',
    steps:
      'Sign in, open App-Specific Passwords, press +, name it “Conch”, and copy the password Apple shows.',
    note: 'Your Apple Account needs two-factor authentication for this. iCloud doesn’t take +conch addresses, so you write to yourself with “Conch” at the start of the subject.',
    plus: false,
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    passwords: 'https://app.fastmail.com/settings/',
    steps:
      'In Settings → Privacy & Security, find Connected apps & API tokens and press Manage app passwords and access, then New app password. Name it “Conch”, keep Mail, Contacts & Calendars, press Generate password, and copy it.',
    note: 'Fastmail’s Basic plan doesn’t include app passwords.',
    plus: true,
  },
  {
    id: 'outlook',
    name: 'Outlook',
    signInOnly: true,
    note: 'Since September 2024 Microsoft only lets apps into Outlook.com with its own sign-in, which Conch can’t do yet. Forward your Outlook mail to Gmail, iCloud or Fastmail and connect that instead.',
    plus: true,
  },
  {
    id: 'other',
    name: 'Other',
    steps:
      'Make an app password in your mail service’s security settings (or use your mail password if it has none), and copy it.',
    plus: true,
  },
] as const satisfies readonly {
  id: MailProvider;
  name: string;
  passwords?: string;
  steps?: string;
  note?: string;
  signInOnly?: boolean;
  plus: boolean;
}[];

export type MailService = (typeof MAIL_SERVICES)[number];

/** The address mail for Conch goes to: `you+conch@…`, or your own where `+` doesn't work. */
export function conchAddress(address: string, plus: boolean): string {
  const [local = '', domain = ''] = address.trim().toLowerCase().split('@');
  const base = local.split('+')[0] ?? local;
  return plus ? `${base}+conch@${domain}` : `${base}@${domain}`;
}

/** The service an address is most likely at, so the right tab is already chosen. */
export function guessMail(address: string): MailProvider | undefined {
  const domain = address.trim().toLowerCase().split('@')[1] ?? '';
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'gmail';
  if (/^(icloud|me|mac)\.com$/.test(domain)) return 'icloud';
  if (/^(fastmail\.(com|fm)|messagingengine\.com)$/.test(domain)) return 'fastmail';
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'outlook';
  return undefined;
}

/** System Settings' own words, for the iMessage steps. */
export const MAC_SETTINGS = {
  fullDiskAccess: ['Privacy & Security', 'Full Disk Access'],
  automation: ['Privacy & Security', 'Automation'],
} as const;
