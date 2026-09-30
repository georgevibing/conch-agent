import { describe, expect, it } from 'vitest';

import { CATALOG } from './catalog';
import { cuedApps, readMessage } from './cues';

const apps = [...CATALOG.values()].filter((item) => !item.retired);
const cued = (text: string) => cuedApps(text, apps).map((item) => item.id);

/**
 * What people really write when they want something from an app. Every entry
 * in the catalog has some here (a test below makes sure a new one does too).
 */
const positives: [text: string, app: string][] = [
  // Linear
  ['what’s assigned to me in Linear this week?', 'linear'],
  ['What’s assigned to me in linear this week?', 'linear'],
  ['Linear tickets for the current cycle, please', 'linear'],
  ['file a bug in linear for what we just found', 'linear'],
  ['Can you move this to Linear?', 'linear'],
  ['summarise my linear backlog', 'linear'],
  ['Which Linear projects are due before Friday?', 'linear'],
  ['close the linear issue about the login page', 'linear'],
  ['put it in linear.', 'linear'],
  ['What did the team ship in Linear last week?', 'linear'],
  ['https://linear.app/acme/issue/ENG-142/login-fails what is this about?', 'linear'],
  ['check the triage queue in Linear', 'linear'],
  ['Anything waiting for me in linear today', 'linear'],
  ['I’d like Linear to show my open issues', 'linear'],
  ['Show me Notion’s pages about hiring, the ones in our workspace', 'notion'],
  // Notion
  ['Turn this chat into a Notion page', 'notion'],
  ['find my notes from last week’s planning meeting in Notion', 'notion'],
  ['save this to notion', 'notion'],
  ['what’s in our notion wiki about onboarding?', 'notion'],
  ['Add a row to my Notion database of books', 'notion'],
  ['Search my Notion for the Q3 roadmap', 'notion'],
  ['summarise https://www.notion.so/acme/Roadmap-8c1f0a2b', 'notion'],
  ['Notion page for the offsite: can you tidy it up?', 'notion'],
  // Gmail
  ['What did I miss in my inbox today?', 'gmail'],
  ['Draft a reply to the latest email from Sam', 'gmail'],
  ['search my gmail for the flight confirmation', 'gmail'],
  ['any unread emails from the bank?', 'gmail'],
  ['Check my email and tell me what’s urgent', 'gmail'],
  ['summarise the emails I got this morning', 'gmail'],
  ['find the invoice in Gmail', 'gmail'],
  ['clean up my inbox', 'gmail'],
  // Google Calendar
  ['What’s on my calendar tomorrow?', 'google-calendar'],
  ['When am I free for an hour this week?', 'google-calendar'],
  ['add the dentist to my Google Calendar on Friday at 3', 'google-calendar'],
  ['send a calendar invite to Priya for Tuesday', 'google-calendar'],
  ['what are my meetings today', 'google-calendar'],
  ['Am I busy on Thursday afternoon?', 'google-calendar'],
  ['block two hours on my calendar for deep work', 'google-calendar'],
  // Google Drive
  ['Find the budget spreadsheet in Google Drive and summarise it', 'google-drive'],
  ['What’s in my Drive about the Henderson account?', 'google-drive'],
  ['summarise the Google Doc called Launch plan', 'google-drive'],
  ['open my google sheet with the expenses', 'google-drive'],
  ['look through the shared Drive for the contract', 'google-drive'],
  ['My Drive is a mess, which folders are biggest?', 'google-drive'],
  ['read https://docs.google.com/document/d/1AbCdEf/edit and give me the gist', 'google-drive'],
  ['search gdrive for the brand guidelines', 'google-drive'],
  // Slack
  ['Catch me up on #general in Slack since yesterday', 'slack'],
  ['what did people say on slack about the outage?', 'slack'],
  ['post the summary to Slack', 'slack'],
  ['Any Slack messages from my manager?', 'slack'],
  ['summarise the slack thread about pricing', 'slack'],
  ['check my Slack DMs', 'slack'],
  ['https://acme.slack.com/archives/C024BE91L/p1690000000 what was decided here?', 'slack'],
  // GitHub
  ['What pull requests are waiting for my review on GitHub?', 'github'],
  ['Summarise the open GitHub issues labelled bug', 'github'],
  ['check my github notifications', 'github'],
  ['list my GitHub repos', 'github'],
  ['which issues are assigned to me on GitHub?', 'github'],
  ['file a GitHub issue for this crash', 'github'],
  // Jira & Confluence
  ['Summarise the Jira tickets in the current sprint', 'atlassian'],
  ['what’s in my jira backlog', 'atlassian'],
  ['move these tasks into Jira', 'atlassian'],
  ['Find the onboarding page in Confluence', 'atlassian'],
  ['search our confluence wiki for the incident runbook', 'atlassian'],
  ['https://acme.atlassian.net/browse/OPS-12 what’s the status?', 'atlassian'],
  // Zapier
  ['Add a row to my expenses sheet with Zapier', 'zapier'],
  ['which of my Zaps failed last night?', 'zapier'],
  ['send the summary to my team in Teams through Zapier', 'zapier'],
  ['turn on the Zapier actions for Outlook', 'zapier'],
  // Canva
  ['Make an Instagram post announcing our open day in Canva', 'canva'],
  ['find my Canva designs for the bake sale', 'canva'],
  ['create a canva presentation from these notes', 'canva'],
  ['use our canva brand kit for the flyer', 'canva'],
  // 1Password
  ['Which 1Password Environments do I have?', '1password'],
  ['add DATABASE_URL to the staging environment in 1Password', '1password'],
  ['list the environments in my 1password', '1password'],
  // Home Assistant
  ['Is the back door locked? Check Home Assistant', 'home-assistant'],
  ['turn the living room lights down to 30% in Home Assistant', 'home-assistant'],
  ['what automations do I have in homeassistant', 'home-assistant'],
  // Sentry
  ['What are the top new errors in Sentry this week?', 'sentry'],
  ['look at the sentry issues for the checkout page', 'sentry'],
  ['any new crashes in my sentry project?', 'sentry'],
  ['resolve that Sentry alert', 'sentry'],
  // Vercel
  ['Why did my last Vercel deployment fail?', 'vercel'],
  ['read the build logs on vercel', 'vercel'],
  ['which domains are on my Vercel account?', 'vercel'],
  // Supabase
  ['How many sign-ups did we get yesterday in Supabase?', 'supabase'],
  ['show me the tables in my supabase project', 'supabase'],
  ['query the users table in supabase', 'supabase'],
  // Cloudflare
  ['Which DNS records point at the old server in Cloudflare?', 'cloudflare'],
  ['check my cloudflare analytics for last week', 'cloudflare'],
  ['add a redirect rule on Cloudflare for /blog', 'cloudflare'],
  // Stripe
  ['How much revenue did we take in Stripe this month?', 'stripe'],
  ['Refund the last Stripe payment from this customer', 'stripe'],
  ['list the stripe customers who churned', 'stripe'],
  ['any failed charges in stripe today?', 'stripe'],
  ['check my Stripe balance', 'stripe'],
];

/**
 * The same words, meaning something else — and messages about the apps that
 * don't need them connected. None of these may suggest anything.
 */
const negatives: string[] = [
  // linear, the adjective
  'Can you explain linear algebra like I’m five?',
  'Linear algebra is so hard, help me with eigenvectors',
  'Is this relationship linear or exponential?',
  'fit a linear regression to this data',
  'Linear regression vs logistic regression — when do I use which?',
  'sort the list in linear time',
  'the growth is roughly linear.',
  'why is the story so linear?',
  'we need about 40 linear feet of shelving',
  'Explain Linear B, the Mycenaean script',
  'a non-linear narrative structure for my novel',
  'Nonlinear dynamics reading list please',
  'It grows in linear fashion until it plateaus',
  'Solve these linear equations: 2x + 3 = 7',
  'Is a linear model good enough here?',
  'LINEAR PROGRAMMING HOMEWORK HELP',
  'this can be done in linear time, right?',
  'plot a linear function and a quadratic one',
  // notion, the word
  'I like the notion of a four-day week',
  'Where does the notion that we only use 10% of our brain come from?',
  'I have a vague notion of how this works',
  'The Notion of Time is a great book',
  'preconceived notions about remote work',
  'That’s a strange notion in physics.',
  // slack, the word
  'there’s slack in the rope',
  'cut me some slack, it’s Monday',
  'who is going to pick up the slack when she leaves?',
  'he keeps slacking off at work',
  'wear slacks or jeans to the interview?',
  'how much slack time is there in the project schedule?',
  'add a slack variable to turn the inequality into an equation',
  'Tighten the slack in the chain on my bike',
  // stripe, the word
  'paint a stripe of blue along the wall',
  'a shirt with a red stripe',
  'He earned his stripes as a nurse',
  'stripe the data across four disks with RAID 0',
  'Zebras have stripes for a reason',
  // canvas and co.
  'draw on a canvas element in JavaScript',
  'I bought a blank canvas for painting',
  'Canvas LMS keeps logging me out',
  'use the HTML canvas API to draw a chart',
  // calendar and drive
  'build a calendar component in React',
  'my calendar component doesn’t re-render when the month changes',
  'how does the Gregorian calendar handle leap years?',
  'Which calendar year does the tax cover?',
  'Make me an advent calendar for my kids',
  'plan a content calendar for my bakery’s Instagram',
  'my hard drive is full, what can I delete?',
  'my drive to work takes an hour',
  'Is a USB drive or an external drive better for backups?',
  'take the car for a test drive',
  'the data is on the D: drive',
  // email that doesn't need the inbox
  'my email is ada@gmail.com, put it in the signature',
  'Check my email for typos before I send it',
  'write a polite email to my landlord',
  'is ada.lovelace@gmail.com a valid address?',
  'draft a new email to the team about Friday',
  // sentry, confluence, home assistant
  'Tesla sentry mode drains the battery',
  'a sentry stood at the gate',
  'at the confluence of two rivers',
  'a confluence of factors led to the crash',
  'Is a home assistant like Alexa worth it for my mum?',
  // apps named, but not asked for
  'Linear vs Jira for a startup of five?',
  'should we switch from Notion to Obsidian?',
  'Is Notion better than Evernote?',
  'pros and cons of Slack and Teams',
  'what are some alternatives to Zapier',
  'We don’t use Linear, we use a spreadsheet',
  // developers talking about code, not accounts
  'push this branch to GitHub',
  'clone https://github.com/acme/app and run the tests',
  'why is my GitHub Actions workflow failing on node 24?',
  'set up GitHub Pages for the docs',
  'deploy this to Vercel',
  'what goes in vercel.json for rewrites?',
  'install @supabase/supabase-js and set up auth',
  'write a Cloudflare Worker that proxies requests',
  'integrate Stripe payments into my Next.js checkout',
  'add Stripe Elements to the payment form',
  'fix the bug in `linearScale(domain)`',
  '```ts\nconst notion = new Client({ auth: process.env.NOTION_TOKEN });\n```\nwhy is this undefined?',
  'the file is src/integrations/linear.ts',
  'rename slack.ts to chat.ts',
  'Explain the Notion API authentication flow',
  'my Linear API key isn’t working in the script',
  'I’m building a Slack bot in Python',
  'store the Slack webhook URL in an env var',
  'design the sidebar like Linear',
  'build a Notion clone with Next.js',
  'a Stripe-like checkout page',
  'a Linear-style command menu',
  'What is Stripe’s pricing for international cards?',
  'How much did Notion raise in its last round?',
  'I have an interview at Linear next week, help me prepare',
  'Have you seen Drive with Ryan Gosling?',
  'the shared drive at work is slow',
  // general chat
  'Help me plan my week. Ask me a couple of questions first.',
  'Explain how the internet routes a message',
  'Remember that I prefer short, direct answers.',
  'What should I cook tonight?',
  'List the files in the working folder',
  'Write a haiku about autumn',
  'Summarise this article for me',
  'what time is it in Tokyo?',
  'translate "good morning" into Greek',
  'help me write a cover letter',
  'Why is the sky blue?',
  'Can you give me some slack on the deadline?',
];

describe('connect-from-chat cues', () => {
  it.each(positives)('%s → %s', (text, app) => {
    expect(cued(text)).toContain(app);
  });

  it.each(negatives)('never: %s', (text) => {
    expect(cued(text)).toEqual([]);
  });

  it('has more realistic negatives than positives', () => {
    expect(negatives.length).toBeGreaterThanOrEqual(positives.length);
  });

  it('knows how people ask for every app in the catalog', () => {
    for (const app of apps) {
      expect(app.cues.match.length, `${app.id} declares no cues`).toBeGreaterThan(0);
      expect(
        positives.filter(([, id]) => id === app.id).length,
        `${app.id} needs examples in this table`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('never suggests a retired entry, whatever is said', () => {
    const retired = [...CATALOG.values()].filter((item) => item.retired);
    expect(retired.length).toBeGreaterThan(0);
    for (const item of retired) {
      expect(cuedApps(`open ${item.name} and ${item.name.toLowerCase()} please`, retired)).toEqual(
        [],
      );
    }
  });

  it('orders apps as the message mentions them', () => {
    expect(cued('copy the Jira tickets for this sprint into Linear')).toEqual([
      'atlassian',
      'linear',
    ]);
  });

  it('reads only what the person wrote, not code, addresses or file names', () => {
    const read = readMessage(
      'see `notion page` and ada@gmail.com in slack.ts — https://linear.app/acme/issue/ENG-1/x',
    );
    expect(read.words).not.toMatch(/notion|gmail|slack\.ts|linear/);
    expect(read.links).toEqual(['https://linear.app/acme/issue/ENG-1/x']);
  });

  it('ignores the rest of a very long message', () => {
    expect(cued(`${'word '.repeat(1000)} what’s in my Linear inbox?`)).toEqual([]);
  });
});
