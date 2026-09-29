import type { PermissionTool } from './ToolPermissionList';

export const brands = [
  { id: 'notion', name: 'Notion', color: '#000000', tagline: 'Pages, docs and databases' },
  { id: 'gmail', name: 'Gmail', color: '#EA4335', tagline: 'Your email' },
  { id: 'google-calendar', name: 'Google Calendar', color: '#4285F4', tagline: 'Your schedule' },
  { id: 'google-drive', name: 'Google Drive', color: '#0F9D58', tagline: 'Docs, Sheets and files' },
  { id: 'slack', name: 'Slack', color: '#4A154B', tagline: 'Team chat' },
  { id: 'github', name: 'GitHub', color: '#181717', tagline: 'Code, issues and pull requests' },
  { id: 'linear', name: 'Linear', color: '#5E6AD2', tagline: 'Issues and projects' },
  {
    id: 'atlassian',
    name: 'Jira & Confluence',
    color: '#0052CC',
    tagline: 'Atlassian tickets and wiki',
  },
  { id: 'zapier', name: 'Zapier', color: '#FF4F00', tagline: 'Thousands of other apps' },
  { id: 'canva', name: 'Canva', color: '#00C4CC', tagline: 'Designs and presentations' },
  { id: 'browser', name: 'Web browser', color: '#2D7FF9', tagline: 'Click around real websites' },
  {
    id: 'home-assistant',
    name: 'Home Assistant',
    color: '#18BCF2',
    tagline: 'Lights, heating and devices',
  },
  { id: 'sentry', name: 'Sentry', color: '#362D59', tagline: 'Errors and performance' },
  { id: 'vercel', name: 'Vercel', color: '#000000', tagline: 'Deployments and projects' },
  { id: 'supabase', name: 'Supabase', color: '#3FCF8E', tagline: 'Databases and backends' },
  { id: 'cloudflare', name: 'Cloudflare', color: '#F38020', tagline: 'Domains, DNS and Workers' },
  { id: 'stripe', name: 'Stripe', color: '#635BFF', tagline: 'Payments and customers' },
];

export const notionTools: PermissionTool[] = [
  {
    name: 'notion-search',
    title: 'Search',
    description: 'Search your workspace and connected apps.',
    access: 'read',
  },
  {
    name: 'notion-fetch',
    title: 'Read a page',
    description: 'Get the full content of a page or database by its URL.',
    access: 'read',
  },
  { name: 'notion-get-users', description: 'List the people in your workspace.', access: 'read' },
  {
    name: 'notion-create-pages',
    title: 'Create pages',
    description:
      'Create one or more pages with properties and content. Pages are created in your private section unless you name a parent page or database, and can include Markdown such as headings, lists, to-dos and code blocks.',
    access: 'write',
  },
  {
    name: 'notion-update-page',
    title: 'Edit a page',
    description: 'Change a page’s properties or content.',
    access: 'write',
    policy: 'allow',
  },
  {
    name: 'notion-move-pages',
    title: 'Move pages',
    description: 'Move pages to a new parent.',
    access: 'write',
  },
  {
    name: 'notion-delete',
    title: 'Delete a page',
    description: 'Move a page to the trash.',
    access: 'write',
    destructive: true,
    policy: 'off',
  },
];
