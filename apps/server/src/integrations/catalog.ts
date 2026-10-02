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
 * checked against its vendor's live server (Sept 2026): `oauth` entries
 * support dynamic client registration, so "Connect" is one click with no app
 * to register. Google connects through your own Google OAuth client, Slack
 * through your own Slack app; GitHub takes a token.
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
    examples: ['Add a row to my expenses sheet', 'Send the summary to my team in Teams'],
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
    category: 'productivity',
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
    tagline: 'Environments and variables',
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
    category: 'developer',
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
