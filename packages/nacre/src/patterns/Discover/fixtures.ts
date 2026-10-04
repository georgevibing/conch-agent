import type { MarketIdeaView, MarketListingView, MarketPreviewView } from './types';

export const notes: MarketListingView = {
  id: 'clawhub:ada/meeting-notes',
  sourceLabel: 'ClawHub',
  name: 'meeting-notes',
  title: 'Meeting notes',
  description: 'Turns rough meeting notes into decisions, actions and open questions.',
  publisher: { name: 'Ada Lovelace', handle: 'ada', url: 'https://clawhub.ai/u/ada' },
  trust: 'verified',
  trustNote: 'ClawHub marks this publisher as official.',
  installs: 18_400,
  category: 'productivity',
  url: 'https://clawhub.ai/ada/skills/meeting-notes',
};

export const listings: MarketListingView[] = [
  {
    id: 'anthropic:canvas-design',
    sourceLabel: 'Anthropic',
    name: 'canvas-design',
    title: 'Canvas design',
    description: 'Creates posters and visual art as PNG and PDF from a design philosophy.',
    publisher: { name: 'Anthropic', handle: 'anthropics', url: 'https://github.com/anthropics' },
    trust: 'official',
    category: 'design',
    url: 'https://github.com/anthropics/skills/tree/main/skills/canvas-design',
  },
  notes,
  {
    id: 'skills-sh:vercel-labs/agent-skills/web-design-guidelines',
    sourceLabel: 'skills.sh',
    name: 'web-design-guidelines',
    title: 'Web design guidelines',
    description: 'Reviews a web page against accessibility and interface guidelines.',
    publisher: {
      name: 'vercel-labs',
      handle: 'vercel-labs',
      url: 'https://github.com/vercel-labs',
    },
    trust: 'community',
    trustNote: 'skills.sh’s safety checks found nothing.',
    installs: 212_000,
    category: 'coding',
    url: 'https://skills.sh/vercel-labs/agent-skills/web-design-guidelines',
    installed: { skillId: 'market-skills-sh_web-design-guidelines' },
  },
  {
    id: 'clawhub:sam/trip-planner',
    sourceLabel: 'ClawHub',
    name: 'trip-planner',
    title: 'Trip planner',
    description: 'Plans a trip day by day, with trains, places to stay and what to see.',
    publisher: { name: 'Sam' },
    trust: 'flagged',
    trustNote: 'One of ClawHub’s safety checks says not to install it.',
    installs: 2_100,
    category: 'productivity',
    url: 'https://clawhub.ai/sam/skills/trip-planner',
  },
  {
    id: 'clawhub:kim/brand-voice',
    sourceLabel: 'ClawHub',
    name: 'brand-voice',
    title: 'Brand voice',
    description: '',
    publisher: { name: 'Kim' },
    trust: 'community',
    category: 'writing',
    url: 'https://clawhub.ai/kim/skills/brand-voice',
    installed: { skillId: 'market-clawhub_brand-voice', update: true },
  },
];

export const ideas: MarketIdeaView[] = [
  {
    id: 'slides',
    label: 'Turn notes into slides',
    query: 'presentation slides',
    category: 'documents',
  },
  { id: 'emails', label: 'Write clearer emails', query: 'email writing', category: 'writing' },
  {
    id: 'meeting',
    label: 'Tidy up meeting notes',
    query: 'meeting notes',
    category: 'productivity',
  },
  { id: 'poster', label: 'Design a poster', query: 'poster design', category: 'design' },
];

export const categories = [
  { id: 'writing', label: 'Writing' },
  { id: 'documents', label: 'Documents' },
  { id: 'design', label: 'Design' },
  { id: 'productivity', label: 'Everyday' },
];

export const clean: MarketPreviewView = {
  listing: notes,
  pin: { kind: 'version', version: '1.4.0', sha256: 'a'.repeat(64) },
  review: { verdict: 'clean', findings: [], hash: 'h1' },
  permissions: { declared: true, capabilities: [], words: [] },
  instructions:
    '1. Read the notes.\n2. List what was decided, who does what by when, and what is still open.\n3. Keep their words; invent nothing.',
  files: ['references/template.md'],
  license: { kind: 'open', name: 'MIT-0' },
};

export const worrying: MarketPreviewView = {
  ...clean,
  listing: {
    ...notes,
    title: 'Wallet helper',
    name: 'wallet-helper',
    trust: 'community',
    trustNote: undefined,
  },
  pin: {
    kind: 'commit',
    owner: 'mallory',
    repo: 'skills',
    path: 'wallet-helper',
    commit: 'c0ffee1234567890'.padEnd(40, '0'),
  },
  review: {
    verdict: 'danger',
    hash: 'h2',
    findings: [
      {
        severity: 'danger',
        message: 'Downloads something from the internet and runs it straight away.',
        file: 'SKILL.md',
        line: 6,
      },
      {
        severity: 'warning',
        message: 'Says something must be downloaded and installed first, from a link in the skill.',
        file: 'SKILL.md',
        line: 5,
      },
    ],
  },
  permissions: {
    declared: false,
    capabilities: ['files', 'web'],
    words: ['change files in your work folder', 'read the web'],
  },
  license: { kind: 'unknown' },
};

export const blocked: MarketPreviewView = {
  ...clean,
  listing: {
    ...notes,
    title: 'Word documents',
    name: 'word-documents',
    trust: 'community',
    trustNote: undefined,
  },
  license: { kind: 'restricted', name: 'Proprietary' },
  blocked:
    'Its licence only allows using it inside its maker’s own apps, so Conch won’t copy it here.',
};

export const update: MarketPreviewView = {
  ...clean,
  pin: { kind: 'version', version: '1.5.0', sha256: 'b'.repeat(64) },
  permissions: { declared: true, capabilities: ['web'], words: ['read the web'] },
  changes: {
    wider: true,
    permissions: {
      before: { declared: true, capabilities: [], words: [] },
      after: { declared: true, capabilities: ['web'], words: ['read the web'] },
    },
    files: [
      {
        path: 'SKILL.md',
        change: 'changed',
        diff: '--- a/SKILL.md\n+++ b/SKILL.md\n@@ -3,3 +3,4 @@\n 1. Read the notes.\n 2. List what was decided.\n 3. Keep their words.\n+4. Offer to draft a follow-up email.',
      },
      {
        path: 'references/template.md',
        change: 'added',
        diff: '--- a/references/template.md\n+++ b/references/template.md\n@@ -0,0 +1,2 @@\n+# Minutes\n+## Decided',
      },
      { path: 'assets/logo.png', change: 'removed' },
    ],
  },
};
