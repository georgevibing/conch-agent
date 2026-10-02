import { CatalogEntry } from '@conch/protocol';
import type { z } from 'zod';

import { type Cues, named } from './cues';

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
  /** What it needs from this computer (`setup/known.ts`), in order. */
  needs?: string[];
  /** The need whose path is the program to start, wherever it was found. */
  program?: string;
  /**
   * Everything it needs is here, yet it won't start: most likely a switch in
   * another app is off. Said on its card; `steps` say where the switch is.
   */
  switchedOff?: string;
  /**
   * How to tell a message is about this app, so the chat can offer to connect
   * it (`cues.ts`). Every entry declares them: precise ones, or none at all.
   */
  cues: Cues;
}

/**
 * Conch's own families of tools, each with its own sign-in: they need no MCP
 * blueprint, and still work with every provider (ADR 0037, ADR 0049).
 */
export const HOST_FAMILIES: ReadonlySet<CatalogEntry['auth']> = new Set(['google', 'slack']);

/**
 * Whether Conch connects an entry itself, so it never depends on the model
 * provider's own setup (ADR 0049): an MCP server it reaches, or a family of
 * its own tools. `catalog.test.ts` holds every entry to it.
 */
export function connectsItself(entry: Pick<CatalogItem, 'auth' | 'blueprint'>): boolean {
  return Boolean(entry.blueprint) || HOST_FAMILIES.has(entry.auth);
}

/**
 * Integrations Conch sets up for you. Every one belongs to Conch, so it works
 * with every model whichever provider answers (ADR 0049). Every remote one was
 * checked against its vendor's live server (Sept and Oct 2026): `oauth` entries
 * support dynamic client registration, so "Connect" is one click with no app
 * to register. Google connects through your own Google OAuth client, Slack
 * through your own Slack app; GitHub takes a token.
 *
 * Checked means registering, not reading metadata: a service can advertise a
 * registration address and still refuse a new app (Figma answers 403). Apps
 * people would look for that take no new apps at all — Asana, HubSpot, Box,
 * PagerDuty, Zendesk, Xero, Figma — aren't here: Conch could never sign in to
 * them, and a tile that can't connect is worse than no tile.
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
    cues: {
      match: [
        named('Notion'),
        /\bnotion\s+(?:pages?|docs?|documents?|databases?|dbs?|workspaces?|wiki|templates?|boards?|tables?|dashboards?|calendar|teamspaces?|ai|account|notes|sidebar|inbox)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+|our\s+)?notion\b/i,
      ],
      // “The notion of…”, “a notion that…”.
      not: [/\bnotions?\s+(?:of|that|about|is|was|seems|behind)\b/gi],
      links: [/\bnotion\.so\/[\w-]/i],
    },
  },
  {
    id: 'gmail',
    name: 'Gmail',
    tagline: 'Your email',
    description: 'Search your inbox, read threads and draft replies.',
    category: 'productivity',
    auth: 'google',
    color: '#EA4335',
    homepage: 'https://mail.google.com',
    featured: true,
    examples: ['What did I miss in my inbox today?', 'Draft a reply to the latest email from Sam'],
    access: ['Read and search email', 'Create drafts'],
    cues: {
      match: [
        /\bmy\s+(?:g-?mail|e-?mail\s+inbox|inbox)\b/i,
        /\b(?:in|from|check|search|open|through)\s+(?:my\s+)?g-?mail\b/i,
        /\bg-?mail\s+(?:inbox|threads?|messages?|e-?mails?|labels?|drafts?|search)\b/i,
        // “Check my email”, but not “check my email for typos”.
        /\b(?:check|search|scan|go\s+through|look\s+(?:in|through)|summari[sz]e|triage|clean\s+up)\s+(?:my\s+|our\s+)?(?:inbox|mail|e-?mails?)\b(?!\s+(?:for|draft|copy|text|signature|template|address|tone|below|above|here|before|again)\b)/i,
        /\bunread\s+(?:e-?mails?|mail)\b/i,
        /\b(?:latest|last|newest|recent|most\s+recent)\s+e-?mails?\s+(?:from|about|with)\b/i,
        /\be-?mails?\s+(?:I|we)\s+(?:got|received|missed)\b/i,
      ],
      // Another app's inbox (“my inbox in Linear”).
      not: [
        /\binbox\s+(?:in|on)\s+(?!g-?mail\b)\p{L}+/giu,
        /\b(?:linear|slack|notion|github|jira|zendesk|intercom|front|asana|todoist)\s+inbox\b/gi,
      ],
      links: [/\bmail\.google\.com\b/i],
    },
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    tagline: 'Your schedule',
    description: 'See what’s coming up and find time for things.',
    category: 'productivity',
    auth: 'google',
    color: '#4285F4',
    homepage: 'https://calendar.google.com',
    featured: true,
    examples: ['What’s on my calendar tomorrow?', 'When am I free for an hour this week?'],
    access: ['Read your calendar events (no changes)'],
    cues: {
      match: [
        /\bgoogle\s+cal(?:endar)?\b/i,
        /\bg-?cal\b/i,
        /\b(?:my|our)\s+(?:google\s+|work\s+)?calendars?\b/i,
        /\b(?:am|are)\s+(?:I|we)\s+(?:free|busy|available)\s+(?:on|at|this|next|tomorrow|today|tonight|in\s+the|for\s+(?:an?|\d)|between|before|after|later)\b/i,
        /\bmy\s+(?:meetings|schedule|agenda|appointments|events)\s+(?:for\s+)?(?:today|tomorrow|tonight|this\s+(?:week|morning|afternoon|evening)|next\s+week|on\s+(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?)\b/i,
        /\bcalendar\s+(?:invites?|invitations?)\b/i,
      ],
      // Calendars that aren't yours to open, and the one you're building.
      not: [
        /\bcalendars?\s+(?:components?|views?|widgets?|apps?|ui|librar(?:y|ies)|lib|pickers?|grids?|pages?|screens?|features?|modules?|code|files?|implementations?|designs?|mockups?|years?|months?|days?|systems?)\b/gi,
        /\b(?:gregorian|julian|lunar|advent|academic|fiscal|school|liturgical|hebrew|jewish|chinese|mayan|islamic|hijri|perpetual|wall|desk|content|editorial|release|marketing|social\s+media|publishing|tide|garden(?:ing)?|planting)\s+calendars?\b/gi,
      ],
      links: [/\bcalendar\.google\.com\b/i],
    },
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    tagline: 'Docs, Sheets and files',
    description: 'Find your Drive files and read their metadata.',
    category: 'files',
    auth: 'google',
    color: '#0F9D58',
    homepage: 'https://drive.google.com',
    examples: ['Find the budget spreadsheet in Drive'],
    access: ['Search files and read metadata (not file contents)'],
    cues: {
      match: [
        /\bgoogle\s+drive\b/i,
        /\bg-?drive\b/i,
        /\b(?:my|our|the|this|that)\s+google\s+(?:docs?|sheets?|spreadsheets?|slides?|slide\s+decks?|forms?)\b/i,
        /\bgoogle\s+(?:docs?|sheets?|spreadsheets?|slides?)\s+(?:called|named|titled|about|with|from|for)\b/i,
        // “My Drive”, “the shared Drive”, capital D: lowercase is usually a disk or a
        // commute, and “in Drive” alone may be the film.
        /\b(?:[Mm]y|our|shared|team)\s+Drive\b(?!\s+(?:mode|train|shaft|thru|through|way|Street|St\b|Road|Rd\b|Avenue))/,
      ],
      not: [
        /\b(?:hard|usb|flash|c:|d:|e:|external|disk|thumb|test|network|solid[\s-]state|ssd|hdd|optical|cd|dvd|tape|zip|floppy|sex|long|short|scenic|road|country|boot|system|shared\s+network)\s+drives?\b/gi,
      ],
      links: [/\b(?:drive|docs|sheets|slides)\.google\.com\b/i],
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    tagline: 'Team chat',
    description: 'Search conversations, catch you up and write messages for you to send.',
    category: 'productivity',
    // Conch's own Slack tools, with a token from your own Slack app (ADR 0049).
    auth: 'slack',
    color: '#4A154B',
    homepage: 'https://slack.com',
    featured: true,
    examples: ['Catch me up on #general since yesterday', 'What did Sam say about the launch?'],
    access: [
      'See and read the channels you’re in',
      'Search your messages',
      'Send messages as you (shows you the words and asks every time)',
    ],
    cues: {
      match: [
        named('Slack'),
        /\bslack\s+(?:channels?|messages?|threads?|dms?|workspaces?|huddles?|canvas(?:es)?|notifications?|conversations?|posts?|chats?|history|status|reminders?|mentions?)\b/i,
        /\b(?:on|in|to|into|from|via|through|over)\s+(?:our\s+|my\s+|the\s+team\s+)?slack\b/i,
        /\b(?:my|our)\s+slack\b/i,
      ],
      // Slack in the rope, cutting someone some slack, slacking off.
      not: [
        /\b(?:cut(?:ting|s)?|give|giving|gave|show(?:ing)?)\s+(?:(?:me|him|her|them|us|you)\s+)?(?:some\s+|a\s+little\s+|a\s+bit\s+of\s+|more\s+|less\s+)?slack\b/gi,
        /\b(?:take|takes|took|taking|pick|picks|picked|picking)\s+up\s+(?:the\s+|some\s+)?slack\b/gi,
        /\bslack(?:ing|ed|er|ers|ness|ly|s)\b/gi,
        // Building for Slack is coding.
        /\bslack\s+(?:bots?|apps?|bolt)\b/gi,
        /\bslack\s+(?:off|in\s+the|in\s+(?:my|your|our|their)|jaw(?:ed)?|tide|water|season|variables?|time|line|lines|rope|wire|chain|key|period|adjuster|cable)\b/gi,
        /\b(?:enough|little|much|any|no)\s+slack\b(?!\s+(?:channels?|messages?|threads?|dms?|workspaces?|notifications?))/gi,
      ],
      links: [/\b[\w-]+\.slack\.com\/(?:archives|client|messages)\b/i],
    },
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
    cues: {
      match: [
        /\bgithub\s+(?:issues?|pull\s+requests?|prs?|notifications?|discussions?|inbox|projects?|review\s+requests?|stars?|gists?|milestones?)\b/i,
        /\b(?:issues?|pull\s+requests?|prs?|notifications?|reviews?|review\s+requests?|repos?|repositories|discussions?|stars?|assigned\s+to\s+me|waiting\s+(?:on|for)\s+(?:me|my\s+review))\s+(?:on|in|from)\s+(?:my\s+|our\s+)?github\b/i,
        /\bmy\s+github\s+(?:notifications?|issues?|prs?|pull\s+requests?|repos?|repositories|stars?|inbox|reviews?)\b/i,
      ],
      // Pushing and cloning are the agent's own job, and these are products, not your data.
      not: [
        /\bgithub\s+(?:actions?|pages|copilot|desktop|cli|codespaces?|enterprise|sponsors?|workflows?|marketplace|apps?)\b/gi,
      ],
    },
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
    cues: {
      match: [
        named('Linear'),
        /\blinear\s+(?:issues?|tickets?|cycles?|backlog|triage|inbox|workspace|roadmap|milestones?|initiatives?|sub-?issues?|sprints?)\b/i,
        /\bLinear\s+(?:projects?|tasks?|views?|teams?|boards?|labels?|bugs?|comments?|docs?|account|updates?|notifications?)\b/,
        /\b(?:issues?|tickets?|bugs?|tasks?|cycles?|backlog|projects?|sprints?|stories|epics?|assigned\s+to\s+me|waiting\s+for\s+me|triage)\s+(?:in|on|from|into|to)\s+(?:my\s+|our\s+)?linear\b/i,
        // Lowercase only where nothing mathematical can follow: “move it to linear.”
        /\b(?:in|on|from|into|to)\s+(?:my\s+|our\s+)?linear(?=\s*(?:[?.!;]|$)|\s+(?:this|today|tomorrow|yesterday|right\s+now|now|please|pls|so|since|until|before|after|last|next|for\s+me)\b)/i,
      ],
      // Linear algebra, linear time, non-linear, Linear B…
      not: [
        /\b(?:non-?|bi-?|multi-?|piecewise\s+|log-?)linear\b/gi,
        /\blinear(?:ly)?\s+(?:algebra|regressions?|models?|equations?|functions?|time|scale|search|programming|combinations?|independen(?:ce|t)|maps?|mappings?|transformations?|operators?|systems?|interpolation|progressions?|growth|relationships?|relations?|correlations?|feet|foot|metres?|meters?|inch(?:es)?|yards?|motion|momentum|velocity|acceleration|narratives?|story|storyline|plot|gameplay|layouts?|gradients?|fashion|order|sequences?|b|tv|television|actuators?|guides?|bearings?|amplifiers?|regulators?|circuits?|dependence|approximations?|classifiers?|layers?|probing|congruences?|differential|logic|perspective|thinking|spaces?|subspaces?|terms|form|units|dimensions?|density|expansion|trends?|decay|rate|slope|light|technology|tape|polari[sz]ation|accelerators?|span|least|kernel|filters?|codes?|optimi[sz]ation|elasticity|dependency|increase|decrease|way|manner)\b/gi,
      ],
      links: [
        /\blinear\.app\/[\w-]+\/(?:issue|project|view|team|cycle|initiative|inbox|my-issues|document)\//i,
      ],
    },
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
    cues: {
      match: [
        /\bjira\s+(?:tickets?|issues?|boards?|sprints?|epics?|stories|backlog|projects?|filters?|queues?|dashboards?|tasks?|bugs?|comments?|cards?)\b/i,
        /\b(?:in|on|from|into|to)\s+(?:my\s+|our\s+|the\s+)?jira\b/i,
        /\bmy\s+jira\b/i,
        /\bconfluence\s+(?:pages?|spaces?|wiki|docs?|documentation|articles?|site|search)\b/i,
        /\b(?:in|on|from|into|to)\s+(?:my\s+|our\s+|the\s+)?Confluence\b/,
      ],
      // Where two rivers meet.
      not: [/\bconfluences?\s+of\b/gi],
      links: [/\b[\w-]+\.atlassian\.net\/(?:browse|jira|wiki|secure)\b/i],
    },
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
    // Not Teams or Slack: those are apps in Conch already (ADR 0052).
    examples: ['Add a row to my expenses sheet', 'Make a Trello card for this'],
    access: ['Only the actions you enable in Zapier'],
    blueprint: { type: 'http', url: 'https://mcp.zapier.com/api/mcp/mcp' },
    cues: {
      match: [
        /\b(?:in|on|with|via|using|through|from|to|into)\s+(?:my\s+)?zapier\b/i,
        /\bmy\s+(?:zapier|zaps)\b/i,
        /\bzapier\s+(?:zaps?|actions?|account|automations?|workflows?|tables?|interfaces?|mcp|chatbots?|agents?)\b/i,
        /(?<=\b(?:a|my|the|this|that|new|existing)\s+)Zaps?\b/,
      ],
    },
  },
  {
    id: 'canva',
    name: 'Canva',
    tagline: 'Designs and presentations',
    description: 'Find your designs and create new ones from a description.',
    category: 'design',
    auth: 'oauth',
    color: '#00C4CC',
    homepage: 'https://www.canva.com',
    examples: ['Make an Instagram post announcing our open day'],
    access: ['See your designs', 'Create designs (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.canva.com/mcp' },
    cues: {
      match: [
        /\b(?:in|on|into|to|from|with|using|via)\s+(?:my\s+)?canva\b/i,
        /\b(?:my|a)\s+canva\b/i,
        /\bcanva\s+(?:designs?|templates?|presentations?|posts?|decks?|slides?|docs?|whiteboards?|account|projects?|brand\s+kits?|folders?|graphics?|flyers?|logos?|videos?|banners?|thumbnails?|stories)\b/i,
      ],
      links: [/\bcanva\.com\/design\//i],
    },
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
    // Retired: never suggested.
    cues: { match: [] },
  },
  {
    id: '1password',
    name: '1Password',
    // One app with two halves (ADR 0052): sign-ins in Passwords, and Environments here.
    tagline: 'Sign-ins and Environments',
    description: 'Manage your 1Password Environments by name. Secret values never leave 1Password.',
    category: 'developer',
    auth: 'none',
    local: true,
    color: '#145FE4',
    homepage: 'https://www.1password.dev/environments/mcp-server/',
    command: '1password-mcp',
    needs: ['1password-app', '1password-mcp'],
    program: '1password-mcp',
    switchedOff: 'Turn on the MCP server in 1Password.',
    steps: [
      'In 1Password, open Settings → Labs and turn on “Enable local MCP server”.',
      'In Settings → Developer, turn on “Integrate with MCP clients”.',
      '1Password asks you to approve Conch the first time, and again after it locks.',
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
    cues: {
      // Only Environments: that's what this one manages (not passwords).
      match: [
        /\b1\s?password\s+environments?\b/i,
        /\benvironments?\s+(?:in|from|on|to)\s+(?:my\s+)?1\s?password\b/i,
        /\b1\s?password\b[^.?!\n]{0,40}\benvironments?\b/i,
        /\b(?:env(?:ironment)?\s+variables?|environments?)\b[^.?!\n]{0,40}\b1\s?password\b/i,
      ],
    },
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
    cues: {
      // Title case: “a home assistant” in lowercase is any gadget.
      match: [/\bHome\s+Assistant\b/, /\bhome-?assistant\b(?!\s)/i],
      links: [/\bhomeassistant\.local\b/i],
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
    cues: {
      match: [
        /\bsentry\s+(?:errors?|issues?|events?|alerts?|projects?|dashboard|traces?|releases?|reports?|crash(?:es)?|exceptions?|performance|replays?|logs?)\b/i,
        /\b(?:errors?|issues?|exceptions?|crash(?:es)?|events?|alerts?|traces?|replays?)\s+(?:in|on|from)\s+(?:my\s+|our\s+)?sentry\b/i,
        /\b(?:in|on|from)\s+(?:my\s+|our\s+)?Sentry\b/,
        /\bmy\s+sentry\b/i,
      ],
      // A guard, and a car's camera mode.
      not: [/\bsentry\s+(?:mode|gun|guns|duty|post|posts|box|turret|towers?)\b/gi],
      links: [/\bsentry\.io\/(?:organizations|issues)\//i],
    },
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
    cues: {
      // Deploying is the agent's job; these read what already happened.
      match: [
        /\bvercel\s+(?:deployments?|deploys?|logs?|builds?|projects?|dashboard|domains?|previews?|env(?:ironment)?\s+variables?|analytics)\b/i,
        /\b(?:deployments?|deploys?|builds?|logs?|previews?|domains?|projects?)\s+(?:on|in|from)\s+(?:my\s+|our\s+)?vercel\b/i,
        /\bmy\s+vercel\b/i,
      ],
    },
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
    cues: {
      match: [
        /\bsupabase\s+(?:projects?|database|db|tables?|dashboard|logs?|storage|buckets?|users|edge\s+functions?|migrations?|schema|rows?|data|instance|branch(?:es)?)\b/i,
        /\b(?:tables?|rows?|data(?:base)?|db|users|sign-?ups?|records|buckets?|logs?)\b[^.?!\n]{0,40}\b(?:in|on|from)\s+(?:my\s+|our\s+)?supabase\b/i,
        /\bmy\s+supabase\b/i,
      ],
      // Package names in code talk.
      not: [/@?supabase[-/][\w./-]+/gi],
      links: [/\bsupabase\.com\/dashboard\//i],
    },
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
    cues: {
      match: [
        /\bmy\s+cloudflare\b/i,
        /\bcloudflare\s+(?:dns\s+(?:records?|settings|zones?)|dashboard|account|zones?|analytics|logs?|page\s+rules|waf|firewall\s+rules)\b/i,
        /\b(?:dns|records?|domains?|zones?|rules?|redirects?|ssl|settings|analytics|traffic|cache)\b[^.?!\n]{0,40}\b(?:in|on|from|at)\s+(?:my\s+|our\s+)?cloudflare\b/i,
      ],
      links: [/\bdash\.cloudflare\.com\b/i],
    },
  },
  {
    id: 'stripe',
    name: 'Stripe',
    tagline: 'Payments and customers',
    description: 'Look up payments, customers and subscriptions.',
    category: 'business',
    auth: 'oauth',
    color: '#635BFF',
    homepage: 'https://stripe.com',
    examples: ['How much did we take this month?', 'Refund the last payment from this customer'],
    access: ['Read payments and customers', 'Create refunds and invoices (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.stripe.com' },
    cues: {
      match: [
        /\bstripe\s+(?:payments?|customers?|charges?|subscriptions?|invoices?|refunds?|payouts?|balance|revenue|dashboard|account|disputes?|transactions?|mrr|sales|coupons?)\b/i,
        /\b(?:payments?|customers?|charges?|subscriptions?|invoices?|refunds?|payouts?|revenue|balance|disputes?|transactions?|sales|mrr|subscribers)\b[^.?!\n]{0,40}\b(?:in|on|from)\s+(?:my\s+|our\s+)?stripe\b/i,
        /\bmy\s+stripe\b/i,
      ],
      // Building Stripe into an app is coding, not looking at your account.
      not: [
        /\b(?:integrat\w*|implement\w*|add(?:ing)?|set(?:ting)?\s+up|build(?:ing)?|wir(?:e|ing)\s+up|hook(?:ing)?\s+up|install(?:ing)?)\s+(?:with\s+)?stripe(?:\s+(?:payments?|checkout|billing|subscriptions?|elements|webhooks?|connect|sdk|api))?\b/gi,
      ],
      links: [/\bdashboard\.stripe\.com\b/i],
    },
  },
  // ── Work ───────────────────────────────────────────────────────────────
  {
    id: 'todoist',
    name: 'Todoist',
    tagline: 'Tasks and to-do lists',
    description: 'See what’s due, add tasks and tick them off.',
    category: 'productivity',
    auth: 'oauth',
    color: '#E44332',
    homepage: 'https://www.todoist.com',
    examples: ['What’s due today?', 'Add “book the dentist” for Friday'],
    access: ['Read your tasks and projects', 'Add, change and complete tasks (asks first)'],
    blueprint: { type: 'http', url: 'https://ai.todoist.net/mcp' },
    cues: {
      match: [
        named('Todoist'),
        /\btodoist\s+(?:tasks?|projects?|inbox|labels?|filters?|lists?|reminders?|karma)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+|our\s+)?todoist\b/i,
        /\bmy\s+todoist\b/i,
      ],
      links: [/\btodoist\.com\/(?:app|showTask)\b/i],
    },
  },
  {
    id: 'airtable',
    name: 'Airtable',
    tagline: 'Bases, tables and records',
    description: 'Look things up in your bases, and add or change records.',
    category: 'productivity',
    auth: 'oauth',
    color: '#18BFFF',
    homepage: 'https://www.airtable.com',
    examples: ['Which orders in the Fulfilment base are still open?'],
    access: ['Read the bases you choose', 'Add and change records (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.airtable.com/mcp' },
    cues: {
      match: [
        named('Airtable'),
        /\bairtable\s+(?:bases?|tables?|records?|views?|grids?|rows?|fields?|workspaces?|interfaces?)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+|our\s+)?airtable\b/i,
        /\bmy\s+airtable\b/i,
      ],
      links: [/\bairtable\.com\/app\w+/i],
    },
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    tagline: 'Tasks, docs and projects',
    description: 'Find tasks, see what’s on your plate and update them.',
    category: 'productivity',
    auth: 'oauth',
    color: '#7B68EE',
    homepage: 'https://clickup.com',
    examples: ['What’s assigned to me this sprint?'],
    access: ['Read tasks, lists and docs', 'Create and update tasks (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.clickup.com/mcp' },
    cues: {
      match: [
        named('ClickUp'),
        /\bclickup\s+(?:tasks?|lists?|spaces?|docs?|folders?|sprints?|workspaces?|boards?|goals?)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+|our\s+)?clickup\b/i,
        /\bmy\s+clickup\b/i,
      ],
      links: [/\bapp\.clickup\.com\b/i],
    },
  },
  {
    id: 'monday',
    name: 'monday.com',
    tagline: 'Boards and projects',
    description: 'Read your boards, see where work stands and update items.',
    category: 'productivity',
    auth: 'oauth',
    color: '#FF3D57',
    homepage: 'https://monday.com',
    examples: ['What’s stuck on the Launch board?'],
    access: ['Read your boards and items', 'Create and update items (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.monday.com/mcp' },
    cues: {
      // The day of the week is almost every “monday”: only the board words, said as an app's.
      match: [
        /\b(?:in|on|from|to|into)\s+(?:my\s+|our\s+|the\s+)?monday\s+(?:boards?|workspaces?|account|crm)\b/i,
        /\b(?:my|our)\s+monday\s+(?:boards?|workspaces?|account|crm)\b/i,
      ],
      not: [/\bmonday\s+board\s+meetings?\b/gi],
      links: [/\bmonday\.com\b/i],
    },
  },
  {
    id: 'calendly',
    name: 'Calendly',
    tagline: 'Booking links and meetings',
    description: 'See who booked time with you and share the right link.',
    category: 'productivity',
    auth: 'oauth',
    color: '#006BFF',
    homepage: 'https://calendly.com',
    examples: ['Who booked a call with me this week?'],
    access: ['Read your event types and bookings', 'Create links and cancel bookings (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.calendly.com' },
    cues: {
      match: [
        named('Calendly'),
        /\bcalendly\s+(?:links?|events?|bookings?|meetings?|event\s+types?|availability|invitees?|account)\b/i,
        /\b(?:in|on|from|to|through|via)\s+(?:my\s+|our\s+)?calendly\b/i,
        /\bmy\s+calendly\b/i,
      ],
      links: [/\bcalendly\.com\/[\w-]/i],
    },
  },
  {
    id: 'granola',
    name: 'Granola',
    tagline: 'Meeting notes',
    description: 'Search the notes and transcripts of your meetings.',
    category: 'productivity',
    auth: 'oauth',
    color: '#5F7A3A',
    homepage: 'https://www.granola.ai',
    examples: ['What did we agree in yesterday’s call with Acme?'],
    access: ['Read your meeting notes and transcripts'],
    blueprint: { type: 'http', url: 'https://mcp.granola.ai/mcp' },
    cues: {
      // Breakfast is the other granola: only next to the words for what it keeps.
      match: [
        /\bgranola\s+(?:notes?|meeting\s+notes?|transcripts?|meetings?|summar(?:y|ies)|recordings?)\b/i,
        /\b(?:notes?|meetings?|transcripts?|summar(?:y|ies)|calls?)\b[^.?!\n]{0,40}\b(?:in|from)\s+(?:my\s+|our\s+)?granola\b/i,
      ],
    },
  },
  {
    id: 'evernote',
    name: 'Evernote',
    tagline: 'Notes and notebooks',
    description: 'Search your notes, read them and write new ones.',
    category: 'productivity',
    auth: 'oauth',
    color: '#00A82D',
    homepage: 'https://evernote.com',
    examples: ['Find my note about the boiler warranty'],
    access: ['Search and read your notes', 'Create and edit notes (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.evernote.com/mcp' },
    cues: {
      match: [
        named('Evernote'),
        /\bevernote\s+(?:notes?|notebooks?|tags?|account)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+)?evernote\b/i,
        /\bmy\s+evernote\b/i,
      ],
    },
  },
  // ── Files ──────────────────────────────────────────────────────────────
  {
    id: 'dropbox',
    name: 'Dropbox',
    tagline: 'Files and folders',
    description: 'Find files in your Dropbox and read what’s in them.',
    category: 'files',
    auth: 'oauth',
    color: '#0061FF',
    homepage: 'https://www.dropbox.com',
    examples: ['Find the signed lease in my Dropbox'],
    access: ['Search and read your files'],
    blueprint: { type: 'http', url: 'https://mcp.dropbox.com/mcp' },
    cues: {
      match: [
        named('Dropbox'),
        /\bdropbox\s+(?:files?|folders?|account|paper|links?)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+|our\s+)dropbox\b/i,
        /\bmy\s+dropbox\b/i,
      ],
      links: [/\bdropbox\.com\/(?:s|scl|sh|home)\b/i],
    },
  },
  // ── Design ─────────────────────────────────────────────────────────────
  {
    id: 'miro',
    name: 'Miro',
    tagline: 'Whiteboards and diagrams',
    description: 'Read your boards and add notes, diagrams and frames.',
    category: 'design',
    auth: 'oauth',
    color: '#050038',
    homepage: 'https://miro.com',
    examples: ['Summarise the sticky notes on the Retro board'],
    access: ['Read the boards you choose', 'Add to boards (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.miro.com/' },
    cues: {
      // Joan Miró painted: only next to the words for a board.
      match: [
        /\bmiro\s+(?:boards?|whiteboards?|diagrams?|frames?|stick(?:y|ies)(?:\s+notes?)?|mind\s*maps?)\b/i,
        /\b(?:boards?|whiteboards?|diagrams?|stick(?:y|ies)|frames?|mind\s*maps?)\b[^.?!\n]{0,40}\b(?:in|on|from)\s+(?:my\s+|our\s+)?miro\b/i,
      ],
      links: [/\bmiro\.com\/app\/board\b/i],
    },
  },
  {
    id: 'webflow',
    name: 'Webflow',
    tagline: 'Sites and their content',
    description: 'Look through your sites, and add or edit pages and collection items.',
    category: 'design',
    auth: 'oauth',
    color: '#146EF5',
    homepage: 'https://webflow.com',
    examples: ['Add this article to the Blog collection as a draft'],
    access: ['Read your sites and their content', 'Edit pages and items (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.webflow.com/mcp' },
    cues: {
      match: [
        named('Webflow'),
        /\bwebflow\s+(?:sites?|cms|collections?|pages?|items?|projects?|designer|account)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+|our\s+)?webflow\b/i,
        /\bmy\s+webflow\b/i,
      ],
    },
  },
  {
    id: 'wordpress',
    name: 'WordPress.com',
    tagline: 'Your site and its posts',
    description: 'Read your posts, pages and comments, and write drafts.',
    category: 'design',
    auth: 'oauth',
    color: '#21759B',
    homepage: 'https://wordpress.com',
    examples: ['Draft a post from these notes', 'Which posts got the most views this month?'],
    access: ['Read your sites, posts and stats', 'Write drafts and edit posts (asks first)'],
    blueprint: { type: 'http', url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1' },
    cues: {
      // Building a theme or a plugin is coding: these are about what's on your own site.
      match: [
        /\bmy\s+wordpress(?:\.com)?\s+(?:site|blog|posts?|pages?|drafts?|comments?|stats)\b/i,
        /\b(?:posts?|drafts?|pages?|comments?|stats)\b[^.?!\n]{0,40}\b(?:on|in|from|to)\s+(?:my\s+|our\s+)wordpress\b/i,
      ],
      not: [/\bwordpress\s+(?:plugins?|themes?|hooks?|multisite|install\w*|development)\b/gi],
    },
  },
  // ── Business ───────────────────────────────────────────────────────────
  {
    id: 'intercom',
    name: 'Intercom',
    tagline: 'Customer conversations',
    description: 'Search conversations and contacts, and see what customers are asking.',
    category: 'business',
    auth: 'oauth',
    color: '#286EFA',
    homepage: 'https://www.intercom.com',
    examples: ['What are customers asking about most this week?'],
    access: ['Read conversations and contacts'],
    blueprint: { type: 'http', url: 'https://mcp.intercom.com/mcp' },
    cues: {
      match: [
        /\bintercom\s+(?:conversations?|inbox|tickets?|chats?|customers?|contacts?|articles?|help\s+cent(?:er|re))\b/i,
        /\b(?:conversations?|tickets?|chats?|customers?|contacts?)\b[^.?!\n]{0,40}\b(?:in|from|on)\s+(?:my\s+|our\s+)?intercom\b/i,
        /\b(?:my|our)\s+intercom\b/i,
      ],
      // The one by the door.
      not: [
        /\b(?:door|apartment|building|gate|video|wireless|baby|office|home)\s+intercoms?\b/gi,
        /\bintercoms?\s+(?:system|button|speaker|buzzer|panel)\b/gi,
      ],
    },
  },
  {
    id: 'paypal',
    name: 'PayPal',
    tagline: 'Payments and invoices',
    description: 'Look up transactions, send invoices and check disputes.',
    category: 'business',
    auth: 'oauth',
    color: '#002991',
    homepage: 'https://www.paypal.com',
    examples: ['Which invoices are still unpaid?'],
    access: ['Read transactions and invoices', 'Create invoices and refunds (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.paypal.com/mcp' },
    cues: {
      match: [
        /\bpaypal\s+(?:transactions?|payments?|invoices?|balance|account|disputes?|orders?|payouts?|sales|refunds?)\b/i,
        /\b(?:transactions?|payments?|invoices?|balance|disputes?|refunds?|sales|orders?)\b[^.?!\n]{0,40}\b(?:in|on|from)\s+(?:my\s+|our\s+)?paypal\b/i,
        /\bmy\s+paypal\b/i,
      ],
      // Building PayPal into an app is coding, not looking at your account.
      not: [
        /\b(?:integrat\w*|implement\w*|add(?:ing)?|set(?:ting)?\s+up|build(?:ing)?|install(?:ing)?)\s+(?:with\s+)?paypal(?:\s+(?:payments?|checkout|buttons?|sdk|api))?\b/gi,
      ],
    },
  },
  {
    id: 'square',
    name: 'Square',
    tagline: 'Sales, orders and customers',
    description: 'See what you sold, look up orders and customers, and send invoices.',
    category: 'business',
    auth: 'oauth',
    color: '#3E4348',
    homepage: 'https://squareup.com',
    examples: ['What were yesterday’s sales at the market stall?'],
    access: ['Read sales, orders and customers', 'Create invoices and refunds (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.squareup.com/sse' },
    cues: {
      // A shape, a place and a unit before it's a till: only next to what a shop keeps there.
      match: [
        /\bsquare\s+(?:payments?|invoices?|dashboard|pos|orders?|catalog(?:ue)?|sales|customers?|payouts?|transactions?|account)\b/i,
        /\b(?:payments?|invoices?|orders?|sales|customers?|payouts?|transactions?|refunds?)\b[^.?!\n]{0,40}\b(?:in|on|from)\s+(?:my\s+|our\s+)square\b/i,
      ],
      not: [
        /\bsquare\s+(?:root|feet|foot|met(?:er|re)s?|miles?|inch(?:es)?|brackets?|kilomet\w+|yards?)\b/gi,
        /\b(?:town|times|city|market|public|red|main)\s+square\b/gi,
      ],
    },
  },
  {
    id: 'attio',
    name: 'Attio',
    tagline: 'Customers and deals',
    description: 'Look up people, companies and deals, and keep them up to date.',
    category: 'business',
    auth: 'oauth',
    color: '#1A1D21',
    homepage: 'https://attio.com',
    examples: ['Which deals are waiting on a reply from us?'],
    access: ['Read people, companies and deals', 'Add notes and update records (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.attio.com/mcp' },
    cues: {
      match: [
        named('Attio'),
        /\battio\s+(?:records?|deals?|companies|people|lists?|notes?|crm|workspaces?|pipelines?)\b/i,
        /\b(?:in|into|to|from|on)\s+(?:my\s+|our\s+)?attio\b/i,
      ],
    },
  },
  // ── Developer ──────────────────────────────────────────────────────────
  {
    id: 'datadog',
    name: 'Datadog',
    tagline: 'Monitors, logs and metrics',
    description: 'Check what’s alerting, search logs and read dashboards.',
    category: 'developer',
    auth: 'oauth',
    color: '#632CA6',
    homepage: 'https://www.datadoghq.com',
    examples: ['Which monitors are alerting right now?'],
    access: ['Read monitors, logs, metrics and incidents'],
    blueprint: { type: 'http', url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp' },
    cues: {
      match: [
        /\bdatadog\s+(?:monitors?|dashboards?|logs?|metrics?|alerts?|incidents?|traces?|apm)\b/i,
        /\b(?:monitors?|dashboards?|logs?|metrics?|alerts?|incidents?|traces?|errors?)\b[^.?!\n]{0,40}\b(?:in|on|from)\s+(?:my\s+|our\s+)?datadog\b/i,
        /\b(?:in|on|from)\s+(?:my\s+|our\s+)?Datadog\b/,
      ],
      // Putting its agent on a server is the agent's own job.
      not: [
        /\b(?:integrat\w*|install(?:ing)?|set(?:ting)?\s+up|add(?:ing)?|configur\w*)\s+(?:the\s+)?datadog(?:\s+agent)?\b/gi,
      ],
      links: [/\bapp\.datadoghq\.(?:com|eu)\b/i],
    },
  },
  {
    id: 'posthog',
    name: 'PostHog',
    tagline: 'Product analytics',
    description: 'Ask about your product’s numbers, feature flags and experiments.',
    category: 'developer',
    auth: 'oauth',
    color: '#1D4AFF',
    homepage: 'https://posthog.com',
    examples: ['How did sign-ups change after last week’s release?'],
    access: ['Read insights, events and flags', 'Change flags and dashboards (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.posthog.com/mcp' },
    cues: {
      match: [
        /\bposthog\s+(?:insights?|dashboards?|events?|funnels?|feature\s+flags?|flags?|experiments?|recordings?|cohorts?|surveys?)\b/i,
        /\b(?:in|on|from)\s+(?:my\s+|our\s+)?posthog\b/i,
        /\bmy\s+posthog\b/i,
      ],
      not: [
        /\b(?:integrat\w*|install(?:ing)?|set(?:ting)?\s+up|add(?:ing)?)\s+(?:the\s+)?posthog\b/gi,
      ],
    },
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    tagline: 'Product analytics',
    description: 'Ask about funnels, retention and what people do in your product.',
    category: 'developer',
    auth: 'oauth',
    color: '#7856FF',
    homepage: 'https://mixpanel.com',
    examples: ['Where do people drop off in the checkout funnel?'],
    access: ['Read reports, events and cohorts'],
    blueprint: { type: 'http', url: 'https://mcp.mixpanel.com/mcp' },
    cues: {
      match: [
        /\bmixpanel\s+(?:reports?|dashboards?|events?|funnels?|cohorts?|insights?|boards?|retention)\b/i,
        /\b(?:in|on|from)\s+(?:my\s+|our\s+)?mixpanel\b/i,
        /\bmy\s+mixpanel\b/i,
      ],
      not: [
        /\b(?:integrat\w*|install(?:ing)?|set(?:ting)?\s+up|add(?:ing)?)\s+(?:the\s+)?mixpanel\b/gi,
      ],
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    tagline: 'Postgres databases',
    description: 'Look at your databases and branches, and run queries.',
    category: 'developer',
    auth: 'oauth',
    color: '#34D59A',
    homepage: 'https://neon.com',
    examples: ['Which tables grew the most this month?'],
    access: ['Read your projects and data', 'Run queries and change schemas (asks first)'],
    blueprint: { type: 'http', url: 'https://mcp.neon.tech/mcp' },
    cues: {
      // A gas and a colour first: only next to what a database has.
      match: [
        /\bneon\s+(?:projects?|branch(?:es)?|databases?|db|postgres|console|compute)\b/i,
        /\b(?:databases?|branch(?:es)?|tables?|rows?)\b[^.?!\n]{0,40}\b(?:in|on|from)\s+(?:my\s+|our\s+)neon\b/i,
      ],
      not: [
        /\bneon\s+(?:signs?|lights?|colou?rs?|green|pink|blue|yellow|orange|glow|tetras?|gas|lamps?|genesis)\b/gi,
      ],
      links: [/\bconsole\.neon\.tech\b/i],
    },
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    tagline: 'Models, datasets and Spaces',
    description: 'Search models, datasets and papers, and use Spaces as tools.',
    category: 'developer',
    auth: 'oauth',
    color: '#FF9D00',
    homepage: 'https://huggingface.co',
    examples: ['Find a small model that’s good at summarising legal text'],
    access: ['Search what’s public and what’s in your account', 'Run the Spaces you add'],
    blueprint: { type: 'http', url: 'https://huggingface.co/mcp' },
    cues: {
      match: [
        /\bhugging\s*face\s+(?:models?|datasets?|spaces?|hub|papers?|account|profile)\b/i,
        /\b(?:models?|datasets?|spaces?|papers?)\b[^.?!\n]{0,40}\b(?:on|from|in)\s+(?:the\s+|my\s+)?hugging\s*face\b/i,
      ],
      links: [/\bhuggingface\.co\/[\w-]/i],
    },
  },
  {
    id: 'netlify',
    name: 'Netlify',
    tagline: 'Sites and deploys',
    description: 'Check deploys, read build logs and look through your sites.',
    category: 'developer',
    auth: 'oauth',
    color: '#00C7B7',
    homepage: 'https://www.netlify.com',
    examples: ['Why did the last deploy of the docs site fail?'],
    access: ['Read sites, deploys and logs', 'Change settings and deploy (asks first)'],
    blueprint: { type: 'http', url: 'https://netlify-mcp.netlify.app/mcp' },
    cues: {
      // Deploying is the agent's job; these read what already happened.
      match: [
        /\bnetlify\s+(?:sites?|deploys?|deployments?|builds?|logs?|functions?|forms?|domains?|account|projects?|dashboard)\b/i,
        /\b(?:sites?|deploys?|deployments?|builds?|logs?|domains?|forms?)\s+(?:on|in|from)\s+(?:my\s+|our\s+)?netlify\b/i,
        /\bmy\s+netlify\b/i,
      ],
      links: [/\bapp\.netlify\.com\b/i],
    },
  },
];

/** What stays on the gateway: never part of `publicCatalog()`. */
type ServerOnly =
  'blueprint' | 'tokenField' | 'retired' | 'needs' | 'program' | 'switchedOff' | 'cues';

export type ResolvedCatalogItem = CatalogEntry & Pick<CatalogItem, ServerOnly>;

const items: ResolvedCatalogItem[] = raw.map(
  ({ blueprint, tokenField, retired, needs, program, switchedOff, cues, ...entry }) => ({
    ...CatalogEntry.parse(entry),
    blueprint,
    tokenField,
    retired,
    needs,
    program,
    switchedOff,
    cues,
  }),
);

export const CATALOG: ReadonlyMap<string, ResolvedCatalogItem> = new Map(
  items.map((i) => [i.id, i]),
);

/** The public part of the catalog (no blueprints). */
export function publicCatalog(): CatalogEntry[] {
  return items
    .filter((item) => !item.retired)
    .map(
      ({
        blueprint: _b,
        tokenField: _t,
        retired: _r,
        needs: _n,
        program: _p,
        switchedOff: _s,
        cues: _c,
        ...entry
      }) => entry,
    );
}

/**
 * Apps a provider's plugins often bring that aren't in the catalog: the name
 * people know them by and their colour, so their card isn't a lowercase
 * server name with a plug on it. Each has its mark in Nacre's `brands.ts`.
 */
const WELL_KNOWN: Record<string, { name: string; color: string }> = {
  asana: { name: 'Asana', color: '#F06A6A' },
  pagerduty: { name: 'PagerDuty', color: '#06AC38' },
};

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * What a server a provider named should be called and look like in Conch,
 * when its name is exactly an app we know (`github` is GitHub, `pagerduty` is
 * PagerDuty). Only an exact name: a server that merely mentions an app keeps
 * the name its owner gave it.
 */
export function likeness(
  name: string,
): { name: string; brand: string; color?: string } | undefined {
  const key = plain(name);
  if (!key) return undefined;
  for (const entry of CATALOG.values())
    if (plain(entry.id) === key || plain(entry.name) === key)
      return { name: entry.name, brand: entry.id, ...(entry.color && { color: entry.color }) };
  const known = WELL_KNOWN[key];
  return known ? { name: known.name, brand: key, color: known.color } : undefined;
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
    [/todoist/, 'todoist'],
    [/airtable/, 'airtable'],
    [/clickup/, 'clickup'],
    [/monday\.com|mcp\.monday/, 'monday'],
    [/calendly/, 'calendly'],
    [/granola/, 'granola'],
    [/evernote/, 'evernote'],
    [/dropbox/, 'dropbox'],
    [/\bmiro\b/, 'miro'],
    [/webflow/, 'webflow'],
    [/wordpress/, 'wordpress'],
    [/intercom/, 'intercom'],
    [/paypal/, 'paypal'],
    [/squareup/, 'square'],
    [/attio/, 'attio'],
    [/datadog/, 'datadog'],
    [/posthog/, 'posthog'],
    [/mixpanel/, 'mixpanel'],
    [/neon\.tech|\bneon\b/, 'neon'],
    [/hugging\s*face/, 'huggingface'],
    [/netlify/, 'netlify'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1];
}
