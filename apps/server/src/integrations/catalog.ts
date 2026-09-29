import { CatalogEntry } from '@conch/protocol';
import type { z } from 'zod';

/** How a catalog entry turns into an MCP server, given what the user typed. */
export type Blueprint =
  | { type: 'http'; url: string | ((values: Record<string, string>) => string) }
  | { type: 'stdio'; command: string; args: string[] };

export interface CatalogItem extends z.input<typeof CatalogEntry> {
  blueprint?: Blueprint;
  /** Field that carries the bearer token for `token` integrations. */
  tokenField?: string;
  /**
   * No longer offered in the gallery (something built in does it better);
   * already-connected ones keep working.
   */
  retired?: boolean;
}

/**
 * Integrations Conch sets up for you. Every remote one was checked against its
 * vendor's live server (Sept 2026): `oauth` entries support dynamic client
 * registration, so "Connect" is one click with no app to register. Services
 * that only admit pre-approved apps (Google, Slack) connect through your
 * AI provider’s account instead; GitHub takes a token.
 */
const raw: CatalogItem[] = [
  {
    id: 'notion',
    name: 'Notion',
    tagline: 'Pages, docs and databases',
    description: 'Search your workspace, read pages and write new ones.',
    category: 'productivity',
    auth: 'oauth',
    color: '#000000',
    homepage: 'https://www.notion.com',
    featured: true,
    examples: [
      'Find my notes from last week’s planning meeting',
      'Turn this chat into a Notion page',
    ],
    access: ['Search and read the pages you share with it', 'Create and edit pages (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.notion.com/mcp' },
  },
  {
    id: 'gmail',
    name: 'Gmail',
    tagline: 'Your email',
    description: 'Search your inbox, read threads and draft replies.',
    category: 'productivity',
    auth: 'account',
    color: '#EA4335',
    homepage: 'https://mail.google.com',
    featured: true,
    examples: ['What did I miss in my inbox today?', 'Draft a reply to the latest email from Sam'],
    access: ['Read and search email', 'Create drafts'],
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    tagline: 'Your schedule',
    description: 'See what’s coming up and find time for things.',
    category: 'productivity',
    auth: 'account',
    color: '#4285F4',
    homepage: 'https://calendar.google.com',
    featured: true,
    examples: ['What’s on my calendar tomorrow?', 'When am I free for an hour this week?'],
    access: ['See your events', 'Create and change events (asks first)'],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    tagline: 'Docs, Sheets and files',
    description: 'Find and read your documents and spreadsheets.',
    category: 'files',
    auth: 'account',
    color: '#0F9D58',
    homepage: 'https://drive.google.com',
    examples: ['Find the budget spreadsheet and summarise it'],
    access: ['Search and read your files'],
  },
  {
    id: 'slack',
    name: 'Slack',
    tagline: 'Team chat',
    description: 'Search conversations, catch you up and draft messages.',
    category: 'productivity',
    auth: 'account',
    color: '#4A154B',
    homepage: 'https://slack.com',
    examples: ['Catch me up on #general since yesterday'],
    access: ['Read channels you’re in', 'Send messages (asks first)'],
  },
  {
    id: 'github',
    name: 'GitHub',
    tagline: 'Code, issues and pull requests',
    description: 'Read your repositories, triage issues and review pull requests.',
    category: 'developer',
    auth: 'token',
    color: '#181717',
    homepage: 'https://github.com',
    featured: true,
    tokenField: 'token',
    fields: [
      {
        key: 'token',
        label: 'Access token',
        secret: true,
        optional: false,
        placeholder: 'github_pat_…',
        help: 'GitHub makes one for you in a few clicks. You choose which repositories it can see.',
        helpUrl:
          'https://github.com/settings/personal-access-tokens/new?name=Conch&description=Lets+your+assistant+work+with+GitHub+through+Conch&expires_in=90',
        pattern: '^(github_pat_|ghp_|gho_)[A-Za-z0-9_]{20,}$',
        patternHint: 'GitHub tokens start with github_pat_ or ghp_.',
      },
    ],
    steps: [
      'Open GitHub’s token page (the button fills in the name for you).',
      'Pick the repositories it may use, and what it may do with them.',
      'Press “Generate token”, copy it, and paste it here.',
    ],
    examples: ['What’s waiting for my review?', 'Summarise the open issues labelled “bug”'],
    access: [
      'Read the repositories you pick',
      'Open issues and pull requests, if the token allows it',
    ],
    blueprint: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
  },
  {
    id: 'linear',
    name: 'Linear',
    tagline: 'Issues and projects',
    description: 'Find, create and update issues and projects.',
    category: 'productivity',
    auth: 'oauth',
    color: '#5E6AD2',
    homepage: 'https://linear.app',
    featured: true,
    examples: ['What’s assigned to me this cycle?', 'File a bug for what we just found'],
    access: ['Read issues, projects and comments', 'Create and update issues (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.linear.app/mcp' },
  },
  {
    id: 'atlassian',
    name: 'Jira & Confluence',
    tagline: 'Atlassian tickets and wiki',
    description: 'Search Jira issues and Confluence pages, and create new ones.',
    category: 'productivity',
    auth: 'oauth',
    color: '#0052CC',
    homepage: 'https://www.atlassian.com',
    examples: ['Summarise the tickets in the current sprint', 'Find the onboarding page'],
    access: ['Read issues and pages you can see', 'Create and edit them (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' },
  },
  {
    id: 'zapier',
    name: 'Zapier',
    tagline: 'Thousands of other apps',
    description: 'Reach the apps Conch doesn’t cover directly, through actions you pick in Zapier.',
    category: 'productivity',
    auth: 'oauth',
    color: '#FF4F00',
    homepage: 'https://zapier.com/mcp',
    examples: ['Add a row to my expenses sheet', 'Send the summary to my team in Teams'],
    access: ['Only the actions you enable in Zapier'],
    blueprint: { type: 'http', url: 'https://mcp.zapier.com/api/mcp/mcp' },
  },
  {
    id: 'canva',
    name: 'Canva',
    tagline: 'Designs and presentations',
    description: 'Find your designs and create new ones from a description.',
    category: 'productivity',
    auth: 'oauth',
    color: '#00C4CC',
    homepage: 'https://www.canva.com',
    examples: ['Make an Instagram post announcing our open day'],
    access: ['See your designs', 'Create designs (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.canva.com/mcp' },
  },
  {
    id: 'browser',
    name: 'Web browser',
    tagline: 'Click around real websites',
    description:
      'Opens a browser window on this computer to fill in forms, click and read pages you can see.',
    category: 'browser',
    auth: 'none',
    local: true,
    color: '#2D7FF9',
    requires: 'Google Chrome',
    command: 'npx -y @playwright/mcp@latest',
    examples: ['Check whether the library has my book available', 'Fill in this form for me'],
    access: [
      'Opens its own browser window, separate from yours',
      'Visits sites and clicks (asks first)',
    ],
    blueprint: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    // Conch has a browser of its own now (ADR 0014): nothing to install, and it asks per site.
    retired: true,
  },
  {
    id: '1password',
    name: '1Password',
    tagline: 'Environments and variables',
    description:
      'Look after the Environments you keep in 1Password — the names of your variables, and new ones you ask for. It never hands over a secret value, by design: 1Password answers with names only.',
    category: 'developer',
    auth: 'none',
    local: true,
    color: '#145FE4',
    homepage: 'https://www.1password.dev/environments/mcp-server/',
    requires: 'The 1Password app, with its MCP server turned on',
    command: '1password-mcp',
    steps: [
      'In the 1Password app, open Settings → Labs and turn on “Enable local MCP server”.',
      'In Settings → Developer, turn on “Integrate with MCP clients”.',
      'Connect here. 1Password will ask you to approve it the first time, and again when it locks.',
    ],
    examples: [
      'Which Environments do I have?',
      'Add a DATABASE_URL variable to my staging Environment',
    ],
    access: [
      'Sees the names of your Environments and their variables',
      'Creates Environments and adds variables (asks first)',
      'Never reads the secret values themselves',
    ],
    blueprint: { type: 'stdio', command: '1password-mcp', args: [] },
  },
  {
    id: 'home-assistant',
    name: 'Home Assistant',
    tagline: 'Lights, heating and devices',
    description: 'Check on your home and control the devices you expose.',
    category: 'home',
    auth: 'token',
    color: '#18BCF2',
    homepage: 'https://www.home-assistant.io/integrations/mcp_server/',
    tokenField: 'token',
    fields: [
      {
        key: 'url',
        label: 'Home Assistant address',
        secret: false,
        optional: false,
        placeholder: 'http://homeassistant.local:8123',
        help: 'The address you open Home Assistant at.',
      },
      {
        key: 'token',
        label: 'Long-lived access token',
        secret: true,
        optional: false,
        placeholder: 'eyJhbGciOi…',
        help: 'In Home Assistant, open your profile → Security → Create token.',
      },
    ],
    steps: [
      'In Home Assistant, add the “Model Context Protocol Server” integration.',
      'Open your profile → Security, and create a long-lived access token.',
      'Paste the token and your Home Assistant address here.',
    ],
    examples: ['Is the back door locked?', 'Turn the living room lights down to 30%'],
    access: ['The entities you expose to assistants', 'Control devices (asks first)'],
    blueprint: {
      type: 'http',
      url: (values) => `${(values.url ?? '').replace(/\/+$/, '')}/api/mcp`,
    },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    tagline: 'Errors and performance',
    description: 'Look into errors, see what broke and suggest fixes.',
    category: 'developer',
    auth: 'oauth',
    color: '#362D59',
    homepage: 'https://sentry.io',
    examples: ['What are the top new errors this week?'],
    access: ['Read issues, events and projects', 'Update issues (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
  },
  {
    id: 'vercel',
    name: 'Vercel',
    tagline: 'Deployments and projects',
    description: 'Check deployments, read build logs and look through projects.',
    category: 'developer',
    auth: 'oauth',
    color: '#000000',
    homepage: 'https://vercel.com',
    examples: ['Why did my last deployment fail?'],
    access: ['Read projects, deployments and logs'],
    blueprint: { type: 'http', url: 'https://mcp.vercel.com' },
  },
  {
    id: 'supabase',
    name: 'Supabase',
    tagline: 'Databases and backends',
    description: 'Look at your tables, run queries and manage projects.',
    category: 'developer',
    auth: 'oauth',
    color: '#3FCF8E',
    homepage: 'https://supabase.com',
    examples: ['How many sign-ups did we get yesterday?'],
    access: ['Read your projects and data', 'Run queries and change schemas (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.supabase.com/mcp' },
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    tagline: 'Domains, DNS and Workers',
    description: 'Look up and change your Cloudflare account’s settings.',
    category: 'developer',
    auth: 'oauth',
    color: '#F38020',
    homepage: 'https://www.cloudflare.com',
    examples: ['Which DNS records point at the old server?'],
    access: ['Read your account', 'Make changes (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.cloudflare.com/mcp' },
  },
  {
    id: 'stripe',
    name: 'Stripe',
    tagline: 'Payments and customers',
    description: 'Look up payments, customers and subscriptions.',
    category: 'developer',
    auth: 'oauth',
    color: '#635BFF',
    homepage: 'https://stripe.com',
    examples: ['How much did we take this month?', 'Refund the last payment from this customer'],
    access: ['Read payments and customers', 'Create refunds and invoices (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.stripe.com' },
  },
];

export type ResolvedCatalogItem = CatalogEntry &
  Pick<CatalogItem, 'blueprint' | 'tokenField' | 'retired'>;

const items: ResolvedCatalogItem[] = raw.map(({ blueprint, tokenField, retired, ...entry }) => ({
  ...CatalogEntry.parse(entry),
  blueprint,
  tokenField,
  retired,
}));

export const CATALOG: ReadonlyMap<string, ResolvedCatalogItem> = new Map(
  items.map((i) => [i.id, i]),
);

/** The public part of the catalog (no blueprints). */
export function publicCatalog(): CatalogEntry[] {
  return items
    .filter((item) => !item.retired)
    .map(({ blueprint: _b, tokenField: _t, retired: _r, ...entry }) => entry);
}

/** Guess which catalog entry an MCP server someone else configured is, for its logo. */
export function matchCatalog(name: string, url?: string): string | undefined {
  const text = `${name} ${url ?? ''}`.toLowerCase();
  const rules: [RegExp, string][] = [
    [/gmail/, 'gmail'],
    [/calendar/, 'google-calendar'],
    [/drive/, 'google-drive'],
    [/slack/, 'slack'],
    [/notion/, 'notion'],
    [/github/, 'github'],
    [/linear/, 'linear'],
    [/atlassian|jira|confluence/, 'atlassian'],
    [/zapier/, 'zapier'],
    [/canva/, 'canva'],
    [/playwright|browser|puppeteer/, 'browser'],
    [/home.?assistant/, 'home-assistant'],
    [/sentry/, 'sentry'],
    [/vercel/, 'vercel'],
    [/supabase/, 'supabase'],
    [/cloudflare/, 'cloudflare'],
    [/stripe/, 'stripe'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1];
}
