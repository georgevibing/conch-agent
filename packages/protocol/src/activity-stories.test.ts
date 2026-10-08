import { describe, expect, it } from 'vitest';

import type { ActivityEffect, ToolLabel } from './activity';
import {
  groupEffects,
  isNoiseStep,
  phaseOf,
  stepFromTool,
  storyStepCount,
  storyVisibleSteps,
  tellStories,
  turnEffects,
  type Story,
  type StoryStep,
} from './activity-stories';

// ---------------------------------------------------------------- fixtures

let n = 0;
let clock = 1_000_000;

function step(
  name: string,
  input: unknown,
  label: ToolLabel,
  over: Partial<StoryStep> = {},
): StoryStep {
  n += 1;
  clock += 1_000;
  return {
    id: `s${n}`,
    name,
    input,
    status: label.failed ? 'error' : 'success',
    label,
    startedAt: clock,
    durationMs: 500,
    ...over,
  };
}

const base = (path: string) => path.split('/').pop() ?? path;
const hostOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? url;

const read = (path: string) =>
  step(
    'Read',
    { file_path: path },
    {
      family: 'explore',
      doing: `Reading ${base(path)}`,
      done: `Read ${base(path)}`,
      subject: path,
    },
  );
const grep = (q: string) =>
  step(
    'Grep',
    { pattern: q },
    {
      family: 'explore',
      doing: 'Searching the code',
      done: `Searched the code for “${q}”`,
      subject: q,
      outcome: '3 matches',
    },
  );
const list = (dir: string) =>
  step(
    'Glob',
    { path: dir },
    { family: 'explore', doing: `Listing ${dir}`, done: `Listed ${dir}`, subject: dir },
  );
const edit = (path: string, from = 'a', to = `b${n}`) =>
  step(
    'Edit',
    { file_path: path, old_string: from, new_string: to },
    {
      family: 'edit',
      doing: `Editing ${base(path)}`,
      done: `Edited ${base(path)}`,
      subject: path,
      effects: [{ kind: 'file', text: `Changed ${base(path)}`, target: path, undo: 'cs1' }],
      chips: [{ kind: 'file', label: base(path), href: path }],
    },
  );
const create = (path: string) =>
  step(
    'Write',
    { file_path: path, content: 'x' },
    {
      family: 'edit',
      doing: `Creating ${base(path)}`,
      done: `Created ${base(path)}`,
      subject: path,
      effects: [{ kind: 'file', text: `Created ${base(path)}`, target: path }],
    },
  );
const test = (ok = true, outcome = ok ? '241 passed' : '3 failed') =>
  step(
    'Bash',
    { command: 'pnpm test' },
    {
      family: 'verify',
      doing: 'Running the tests',
      done: 'Ran the tests',
      subject: 'pnpm test',
      outcome,
      failed: !ok,
    },
  );
const typecheck = (ok = true) =>
  step(
    'Bash',
    { command: 'pnpm typecheck' },
    {
      family: 'verify',
      doing: 'Running the type check',
      done: 'Ran the type check',
      subject: 'pnpm typecheck',
      outcome: ok ? 'No errors' : '2 errors',
      failed: !ok,
    },
  );
const sh = (command: string, ok = true) =>
  step(
    'Bash',
    { command },
    {
      family: 'run',
      doing: `Running ${command}`,
      done: `Ran ${command}`,
      subject: command,
      outcome: ok ? undefined : 'exit 1',
      failed: !ok,
    },
  );
const commit = () =>
  step(
    'Bash',
    { command: `git commit -m "fix ${n}"` },
    {
      family: 'ship',
      doing: 'Committing',
      done: 'Committed',
      effects: [{ kind: 'commit', text: 'Committed “fix the sidebar”', target: 'main' }],
    },
  );
const push = (branch = 'main', ok = true) =>
  step(
    'Bash',
    { command: `git push origin ${branch}` },
    {
      family: 'ship',
      doing: `Pushing to ${branch}`,
      done: `Pushed to ${branch}`,
      subject: branch,
      outcome: ok ? `1 commit to ${branch}` : 'Rejected',
      failed: !ok,
      effects: ok ? [{ kind: 'push', text: `Pushed to ${branch}`, target: branch }] : [],
    },
  );
const webSearch = (q: string) =>
  step(
    'WebSearch',
    { query: q },
    {
      family: 'research',
      doing: 'Searching the web',
      done: `Searched the web for “${q}”`,
      subject: q,
      outcome: '10 results',
    },
  );
const fetchPage = (url: string) =>
  step(
    'WebFetch',
    { url },
    {
      family: 'research',
      doing: `Reading ${hostOf(url)}`,
      done: `Read ${hostOf(url)}`,
      subject: url,
      chips: [{ kind: 'site', label: hostOf(url), href: url }],
    },
  );
const click = (what: string, url = 'https://www.amazon.de/cart') =>
  step(
    'browser_click',
    { element: what },
    {
      family: 'browse',
      doing: `Clicking ${what}`,
      done: `Clicked ${what}`,
      subject: url,
      chips: [{ kind: 'site', label: hostOf(url), href: `https://${hostOf(url)}` }],
    },
  );
const mail = (doing: string, done: string, effects?: ActivityEffect[]) =>
  step(
    'google_mail_send',
    { to: 'ana@example.com', n },
    { family: 'connect', doing, done, effects },
  );
const slack = (doing: string, done: string) =>
  step('slack_send_message', { channel: '#design', n }, { family: 'connect', doing, done });
const start = (command: string, family: ToolLabel['family'] = 'verify') =>
  step(
    'process_start',
    { command },
    { family, doing: `Starting ${command}`, done: `Started ${command}`, subject: command },
  );
const poll = (id = 'p1', outcome?: string, over: Partial<StoryStep> = {}) =>
  step(
    'process_read',
    { id },
    {
      family: 'run',
      doing: 'Checking on the command',
      done: 'Checked on the command',
      outcome,
    },
    over,
  );
const todo = () =>
  step(
    'TodoWrite',
    { todos: [{ content: 'x', n }] },
    { family: 'plan', doing: 'Updating the plan', done: 'Updated the plan' },
  );
const bashOutput = () =>
  step(
    'BashOutput',
    { bash_id: 'b1' },
    { family: 'run', doing: 'Reading the output', done: 'Read the output' },
  );
const kill = () =>
  step(
    'KillShell',
    { shell_id: 'b1' },
    { family: 'run', doing: 'Stopping the command', done: 'Stopped the command' },
  );

const running = (s: StoryStep): StoryStep => ({ ...s, status: 'running', durationMs: undefined });
const again = (s: StoryStep): StoryStep => {
  n += 1;
  clock += 1_000;
  return { ...s, id: `s${n}`, startedAt: clock };
};

const ids = (stories: Story[]) => stories.map((s) => s.steps.map((x) => x.id));
const headlines = (stories: Story[]) => stories.map((s) => s.headline);

// --------------------------------------------------------------- the cuts

describe('tellStories: cutting a run', () => {
  it('tells nothing for no steps', () => {
    expect(tellStories([])).toEqual([]);
  });

  it('keeps looking and changing code as one story', () => {
    const steps = [
      grep('Transcript'),
      read('a/Transcript.tsx'),
      read('a/b.ts'),
      edit('a/Transcript.tsx'),
    ];
    const stories = tellStories(steps);
    expect(stories).toHaveLength(1);
    expect(stories[0]?.family).toBe('edit');
    expect(stories[0]?.id).toBe(steps[0]?.id);
  });

  it('cuts a typical change into working, checking and shipping', () => {
    const steps = [
      grep('Sidebar'),
      read('ui/Sidebar.tsx'),
      read('ui/Nav.tsx'),
      edit('ui/Sidebar.tsx'),
      edit('ui/Nav.tsx'),
      test(),
      commit(),
      push('main'),
    ];
    const stories = tellStories(steps);
    expect(stories.map((s) => s.family)).toEqual(['edit', 'verify', 'ship']);
    expect(ids(stories)).toEqual([
      steps.slice(0, 5).map((s) => s.id),
      [steps[5]?.id],
      steps.slice(6).map((s) => s.id),
    ]);
    expect(headlines(stories)).toEqual([
      'Edited Sidebar.tsx and another file',
      'Ran the tests',
      'Committed and pushed to main',
    ]);
  });

  it('never splits a run of two', () => {
    for (const pair of [
      () => [test(), commit()],
      () => [webSearch('x'), edit('a.ts')],
      () => [read('a.ts'), push()],
      () => [mail('Sending an email', 'Sent an email'), slack('Posting', 'Posted in #design')],
    ]) {
      expect(tellStories(pair())).toHaveLength(1);
    }
  });

  it('keeps a failing check and its fixes together', () => {
    const steps = [
      read('a.ts'),
      read('b.ts'),
      read('c.ts'),
      edit('a.ts'),
      test(false),
      edit('a.ts'),
      test(true),
    ];
    const stories = tellStories(steps);
    expect(stories).toHaveLength(2);
    expect(stories[1]?.steps.map((s) => s.id)).toEqual(steps.slice(4).map((s) => s.id));
    expect(stories[1]?.family).toBe('verify');
    expect(stories[1]?.status).toBe('done');
    expect(stories[1]?.note).toBe('Worked after a fix');
    expect(stories[1]?.outcome).toBe('241 passed');
  });

  it('starts a new story when looking begins again after a check, failed or not', () => {
    for (const ok of [true, false]) {
      const steps = [
        read('a.ts'),
        read('b.ts'),
        edit('a.ts'),
        test(ok),
        read('a.ts'),
        edit('a.ts'),
        test(),
      ];
      expect(ids(tellStories(steps))).toEqual([
        steps.slice(0, 3).map((s) => s.id),
        [steps[3]?.id],
        steps.slice(4).map((s) => s.id),
      ]);
    }
  });

  it('keeps change, check, change, check as one story', () => {
    const steps = [edit('a.ts'), typecheck(), edit('b.ts'), typecheck(), edit('c.ts'), typecheck()];
    const stories = tellStories(steps);
    expect(stories).toHaveLength(1);
    expect(stories[0]?.headline).toBe('Edited 3 files and ran the type check');
    expect(stories[0]?.outcome).toBe('No errors');
  });

  it('starts new work after a check that passed', () => {
    const steps = [read('a.ts'), read('b.ts'), edit('a.ts'), test(), read('c.ts'), read('d.ts')];
    expect(tellStories(steps)).toHaveLength(3);
  });

  it('tells each app its own story', () => {
    const steps = [
      mail('Searching your mail', 'Searched your mail'),
      mail('Reading an email', 'Read an email'),
      slack('Reading #design', 'Read #design'),
      slack('Posting in #design', 'Posted in #design'),
    ];
    const stories = tellStories(steps);
    expect(stories.map((s) => s.steps.length)).toEqual([2, 2]);
    expect(stories.map((s) => s.family)).toEqual(['connect', 'connect']);
  });

  it('keeps the web its own story', () => {
    const steps = [
      read('a.ts'),
      read('b.ts'),
      webSearch('vitest fake timers'),
      fetchPage('https://vitest.dev/guide/mocking'),
      edit('a.ts'),
    ];
    const stories = tellStories(steps);
    expect(stories.map((s) => s.family)).toEqual(['explore', 'research', 'edit']);
  });

  it('cuts a long story of work where a new round of looking begins', () => {
    const steps: StoryStep[] = [];
    for (let i = 0; i < 8; i += 1) steps.push(read(`f${i}.ts`));
    for (let i = 0; i < 8; i += 1) steps.push(edit(`f${i}.ts`));
    steps.push(read('g.ts'), read('h.ts'), edit('g.ts'));
    const stories = tellStories(steps);
    expect(stories).toHaveLength(2);
    expect(stories[0]?.steps).toHaveLength(16);
  });

  it('never lets a story pass thirty steps', () => {
    const steps: StoryStep[] = [];
    for (let i = 0; i < 70; i += 1) steps.push(read(`f${i}.ts`));
    expect(tellStories(steps).map((s) => s.steps.length)).toEqual([30, 30, 10]);
  });

  it('lets unknown steps join the story they are in', () => {
    const other = () =>
      step('mystery', { n }, { family: 'other', doing: 'Using mystery', done: 'Used mystery' });
    const steps = [test(), commit(), other(), push()];
    expect(tellStories(steps)).toHaveLength(1);
    const lead = [other(), other(), read('a.ts'), read('b.ts')];
    expect(tellStories(lead)).toHaveLength(1);
  });
});

describe('tellStories: noise', () => {
  it('lets polls, plans and stops join the story they are in, never start one', () => {
    const steps = [
      read('a.ts'),
      read('b.ts'),
      edit('a.ts'),
      start('pnpm test'),
      poll(),
      poll(),
      todo(),
      bashOutput(),
      kill(),
      commit(),
      todo(),
      push(),
    ];
    const stories = tellStories(steps);
    expect(stories).toHaveLength(3);
    expect(stories[1]?.steps.map((s) => s.name)).toEqual([
      'process_start',
      'process_read',
      'process_read',
      'TodoWrite',
      'BashOutput',
      'KillShell',
    ]);
    expect(storyStepCount(stories[1] as Story)).toBe(1);
    expect(stories[2]?.headline).toBe('Committed and pushed to main');
    expect(storyStepCount(stories[2] as Story)).toBe(2);
  });

  it('starts with noise when that is all there is, and lets the next step take it', () => {
    const steps = [todo(), read('a.ts'), read('b.ts')];
    const stories = tellStories(steps);
    expect(stories).toHaveLength(1);
    expect(stories[0]?.family).toBe('explore');
    expect(stories[0]?.headline).toBe('Read 2 files');
  });

  it('says a story of only noise in that noise’s words', () => {
    const stories = tellStories([poll('p1', 'still running')]);
    expect(stories[0]?.headline).toBe('Checked on the command');
  });

  it('knows noise by name and by the plan family', () => {
    expect(isNoiseStep(poll())).toBe(true);
    expect(isNoiseStep({ name: 'mcp__conch__process_read', label: read('x').label })).toBe(true);
    expect(isNoiseStep(todo())).toBe(true);
    expect(isNoiseStep(read('a'))).toBe(false);
  });
});

// ------------------------------------------------------- prefix stability

/** A tiny seeded random, so a failing case can be found again. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const MAKERS: ((r: () => number) => StoryStep)[] = [
  (r) => read(`src/f${Math.floor(r() * 6)}.ts`),
  (r) => grep(`q${Math.floor(r() * 3)}`),
  (r) => list(`dir${Math.floor(r() * 2)}`),
  (r) => edit(`src/f${Math.floor(r() * 6)}.ts`),
  (r) => create(`src/new${Math.floor(r() * 3)}.ts`),
  (r) => test(r() > 0.4),
  (r) => typecheck(r() > 0.3),
  (r) => sh(`ls ${Math.floor(r() * 2)}`, r() > 0.2),
  () => commit(),
  (r) => push(r() > 0.5 ? 'main' : 'dev', r() > 0.2),
  (r) => webSearch(`q${Math.floor(r() * 3)}`),
  (r) => fetchPage(`https://example${Math.floor(r() * 2)}.com/p${Math.floor(r() * 3)}`),
  (r) => click(`button ${Math.floor(r() * 3)}`),
  () => mail('Reading an email', 'Read an email'),
  () => slack('Posting in #design', 'Posted in #design'),
  () => start('pnpm test'),
  (r) => poll(`p${Math.floor(r() * 2)}`, r() > 0.5 ? 'still running' : undefined),
  () => todo(),
  () => bashOutput(),
  () => kill(),
];

function fixture(seed: number, length: number): StoryStep[] {
  const r = random(seed);
  // Runs have habits: the same kind of step tends to come again.
  const steps: StoryStep[] = [];
  let maker = MAKERS[0] as (r: () => number) => StoryStep;
  for (let i = 0; i < length; i += 1) {
    if (r() > 0.55) maker = MAKERS[Math.floor(r() * MAKERS.length)] as typeof maker;
    steps.push(maker(r));
  }
  return steps;
}

function expectStable(steps: StoryStep[], liveLast = false) {
  const full = tellStories(steps);
  // Every step is in exactly one story, in order.
  expect(full.flatMap((s) => s.steps.map((x) => x.id))).toEqual(steps.map((s) => s.id));
  for (const story of full) expect(story.id).toBe(story.steps[0]?.id);
  for (let k = 1; k <= steps.length; k += 1) {
    const prefix = steps.slice(0, k);
    if (liveLast) prefix[k - 1] = running(prefix[k - 1] as StoryStep);
    const part = tellStories(prefix);
    const lastOfPart = part[part.length - 1] as Story;
    for (let i = 0; i < part.length - 1; i += 1) {
      expect(ids([part[i] as Story])).toEqual(ids([full[i] as Story]));
      expect(part[i]?.id).toBe(full[i]?.id);
    }
    // The last story of the prefix only grows into its story in the full run.
    const grown = full[part.length - 1] as Story;
    expect(grown.id).toBe(lastOfPart.id);
    expect(grown.steps.slice(0, lastOfPart.steps.length).map((s) => s.id)).toEqual(
      lastOfPart.steps.map((s) => s.id),
    );
  }
  return full;
}

describe('tellStories: prefix stability', () => {
  it('never re-cuts a closed story, over many random runs', () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const steps = fixture(seed, 4 + (seed % 37));
      expectStable(steps);
    }
  });

  it('never re-cuts a closed story while the latest step still runs', () => {
    for (let seed = 1000; seed <= 1150; seed += 1) {
      expectStable(fixture(seed, 3 + (seed % 25)), true);
    }
  });

  it('cuts the same whatever the steps’ status, as parallel calls finish out of order', () => {
    const statuses = ['running', 'pending', 'success', 'error'] as const;
    for (let seed = 3000; seed <= 3200; seed += 1) {
      const steps = fixture(seed, 4 + (seed % 33));
      const settled = ids(tellStories(steps));
      const r = random(seed * 7);
      for (let k = 1; k <= steps.length; k += 1) {
        // A prefix where any step may still be running, or may have ended either way.
        const prefix = steps.slice(0, k).map((s) => {
          const status = statuses[Math.floor(r() * statuses.length)] as (typeof statuses)[number];
          const failed = status === 'error' ? true : r() > 0.5 ? s.label.failed : !s.label.failed;
          return { ...s, status, label: { ...s.label, failed } };
        });
        const part = ids(tellStories(prefix));
        expect(part.slice(0, -1)).toEqual(settled.slice(0, part.length - 1));
        expect(settled[part.length - 1]?.slice(0, part[part.length - 1]?.length)).toEqual(
          part[part.length - 1],
        );
      }
      // Every status flipped at once: the same cuts.
      const flipped = steps.map((s) => ({
        ...s,
        status: s.status === 'error' ? ('success' as const) : ('error' as const),
        label: { ...s.label, failed: !s.label.failed },
      }));
      expect(ids(tellStories(flipped))).toEqual(settled);
    }
  });

  it('keeps every headline sentence case, short and free of em dashes', () => {
    for (let seed = 2000; seed <= 2200; seed += 1) {
      for (const story of tellStories(fixture(seed, 5 + (seed % 40)))) {
        expect(story.headline.length).toBeLessThanOrEqual(60);
        expect(story.headline).not.toMatch(/—/);
        expect(story.headline[0]).toBe(story.headline[0]?.toUpperCase());
        expect(story.headline).not.toMatch(/ and .* and /);
        expect((story.outcome ?? '').length).toBeLessThanOrEqual(60);
      }
    }
  });

  it('cuts a typical run into one to three stories', () => {
    const typical = [
      [grep('x'), read('a.ts'), read('b.ts'), edit('a.ts'), test(), commit(), push()],
      [
        webSearch('t-shirts'),
        fetchPage('https://www.amazon.de/a'),
        fetchPage('https://www.amazon.de/b'),
      ],
      [read('a.ts'), edit('a.ts'), typecheck(false), edit('a.ts'), typecheck()],
      [todo(), grep('y'), read('c.ts'), todo(), edit('c.ts'), start('pnpm test'), poll(), poll()],
      [
        mail('Searching your mail', 'Searched your mail'),
        mail('Reading an email', 'Read an email'),
      ],
    ];
    for (const run of typical) {
      const count = expectStable(run).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(3);
    }
  });
});

// ------------------------------------------------------------- headlines

describe('tellStories: headlines', () => {
  const one = (steps: StoryStep[]) => {
    const stories = tellStories(steps);
    expect(stories).toHaveLength(1);
    return stories[0] as Story;
  };

  it('says a single step in its own words, past and present', () => {
    expect(one([test()]).headline).toBe('Ran the tests');
    expect(one([running(test())]).headline).toBe('Running the tests');
  });

  it('counts files read', () => {
    const steps = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => read(`src/${x}.ts`));
    expect(one(steps).headline).toBe('Read 6 files');
    expect(one([...steps.slice(0, 3), running(read('src/g.ts'))]).headline).toBe('Reading 4 files');
  });

  it('joins searching and reading', () => {
    expect(
      one([grep('a'), grep('b'), read('x.ts'), read('y.ts'), read('z.ts'), read('w.ts')]).headline,
    ).toBe('Searched the code and read 4 files');
  });

  it('says one search in full', () => {
    expect(one([grep('sidebar')]).headline).toBe('Searched the code for “sidebar”');
  });

  it('names the first file changed and counts the rest, once each', () => {
    const steps = [
      edit('ui/Transcript.tsx'),
      edit('ui/Transcript.tsx'),
      edit('ui/a.ts'),
      edit('ui/b.ts'),
    ];
    expect(one(steps).headline).toBe('Edited Transcript.tsx and 2 other files');
    expect(one([edit('ui/Transcript.tsx'), edit('ui/Transcript.tsx')]).headline).toBe(
      'Edited Transcript.tsx',
    );
  });

  it('says changed when files were created and edited', () => {
    expect(one([create('a.ts'), edit('b.ts')]).headline).toBe('Changed a.ts and another file');
  });

  it('puts the change first when looking and changing don’t both fit', () => {
    const steps = [
      grep('a'),
      read('src/components/a.ts'),
      read('src/b.ts'),
      edit('src/components/ConversationTranscriptPanel.tsx'),
      edit('src/c.ts'),
    ];
    const s = one(steps);
    expect(s.headline.length).toBeLessThanOrEqual(60);
    expect(s.headline).toBe('Edited ConversationTranscriptPanel.tsx and another file');
  });

  it('says committing and pushing in one breath', () => {
    expect(one([commit(), push('main')]).headline).toBe('Committed and pushed to main');
    expect(one([commit(), running(push('main'))]).headline).toBe('Pushing to main');
  });

  it('counts pages on one site', () => {
    const steps = [
      fetchPage('https://www.amazon.de/a'),
      fetchPage('https://www.amazon.de/b'),
      fetchPage('https://www.amazon.de/c'),
    ];
    expect(one(steps).headline).toBe('Read 3 pages on amazon.de');
  });

  it('says a web search with its words', () => {
    expect(one([webSearch('comfortable t-shirts')]).headline).toBe(
      'Searched the web for “comfortable t-shirts”',
    );
    expect(one([webSearch('a'), webSearch('b'), webSearch('c')]).headline).toBe(
      'Searched the web 3 times',
    );
  });

  it('says the browser was used on a site', () => {
    expect(one([click('Size M'), click('Add to cart'), click('Basket')]).headline).toBe(
      'Used the browser on amazon.de',
    );
  });

  it('joins two checks that share a verb', () => {
    expect(one([test(), typecheck()]).headline).toBe('Ran the tests and the type check');
  });

  it('counts commands', () => {
    expect(one([sh('ls'), sh('pwd'), sh('git status')]).headline).toBe('Ran 3 commands');
  });

  it('counts app steps of a kind', () => {
    const s = one([
      mail('Reading an email', 'Read an email'),
      mail('Reading an email', 'Read an email'),
    ]);
    expect(s.headline).toBe('Read an email');
    const sent = one([
      mail('Sending an email', 'Sent an email to Ana'),
      mail('Sending an email', 'Sent an email to Bo'),
    ]);
    expect(sent.headline).toBe('Sent an email to Ana and 1 more');
  });

  it('cuts words that would run long, at a word', () => {
    const long = 'x'.repeat(10) + ' word'.repeat(30);
    const s = one([step('Bash', { c: 1 }, { family: 'verify', doing: long, done: long })]);
    expect(s.headline.length).toBeLessThanOrEqual(60);
    expect(s.headline.endsWith('…')).toBe(true);
    expect(s.headline).not.toMatch(/ …$/);
  });

  it('keeps names capitalised after “and”', () => {
    const gh = step(
      'gh',
      { b: 1 },
      {
        family: 'ship',
        doing: 'x',
        done: 'GitHub took the release',
        effects: [{ kind: 'publish', text: 'Published v1' }],
      },
    );
    expect(one([commit(), gh]).headline).toBe('Committed and GitHub took the release');
  });
});

// ------------------------------------------- what leads a headline

/** A step from a real call, worded by the rules themselves (`describeTool`). */
function real(
  name: string,
  input: unknown,
  output = '',
  over: { status?: 'success' | 'error'; viewKind?: string; approval?: 'declined' } = {},
): StoryStep {
  n += 1;
  clock += 1_000;
  return stepFromTool({
    id: `r${n}`,
    name,
    input,
    status: over.status ?? 'success',
    output,
    startedAt: clock,
    durationMs: 500,
    ...(over.viewKind && { viewKind: over.viewKind }),
    ...(over.approval && { approval: over.approval }),
  });
}

const root = '/Users/ada/garden';
const proc = (status: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: 'p1', status, command: 'pnpm test --filter auth', ...extra });

describe('tellStories: what leads a headline (consequence, then count, then order)', () => {
  const one = (steps: StoryStep[]) => {
    const stories = tellStories(steps);
    expect(stories).toHaveLength(1);
    return stories[0] as Story;
  };

  it('leads a ship story with its weightiest act: push, then commit, then staging', () => {
    const s = one([
      real('Bash', { command: `git -C ${root} add -A` }),
      real(
        'Bash',
        { command: `git -C ${root} commit -m "fix(auth): compare session expiry in milliseconds"` },
        '[main 4e1c2a9] fix(auth): compare session expiry in milliseconds\n 3 files changed, 5 insertions(+), 2 deletions(-)',
      ),
      real(
        'Bash',
        { command: `git -C ${root} push origin main` },
        'To github.com:ada/garden.git\n   9b0d1f2..4e1c2a9  main -> main',
      ),
    ]);
    expect(s.family).toBe('ship');
    expect(s.headline).toBe('Committed and pushed to main');
    expect(s.outcome).toBe('“fix(auth): compare session expiry in milliseconds”');
  });

  it('says staging only when it’s all there is', () => {
    expect(one([real('Bash', { command: 'git add -A' })]).headline).toBe('Staged the changes');
    expect(
      one([real('Bash', { command: 'git add -A' }), real('Bash', { command: 'git tag v1.2.0' })])
        .headline,
    ).not.toMatch(/^Staged/);
  });

  it('tells a test run started and checked on until it ended as the run, with what it found', () => {
    const s = one([
      real(
        'mcp__conch__process_start',
        { command: 'pnpm test --filter auth', cwd: root },
        proc('running'),
      ),
      real('mcp__conch__process_read', { id: 'p1' }, proc('running')),
      real('mcp__conch__process_read', { id: 'p1' }, proc('running')),
      real(
        'mcp__conch__process_read',
        { id: 'p1' },
        proc('exited', {
          exitCode: 0,
          output: ' Test Files  38 passed (38)\n      Tests  241 passed (241)',
        }),
      ),
    ]);
    expect(s.headline).toBe('Ran the tests');
    expect(s.outcome).toBe('241 passed');
    const [run] = storyVisibleSteps(s);
    expect(run?.label).toMatchObject({ done: 'Ran the tests', outcome: '241 passed' });
    // The run lasts until the check that saw it end.
    const end = s.steps[s.steps.length - 1] as StoryStep;
    expect(run?.durationMs).toBe(end.startedAt + 500 - (run?.startedAt ?? 0));
  });

  it('says a run that ended badly failed, and one still going as started', () => {
    const failed = one([
      real('mcp__conch__process_start', { command: 'pnpm test --filter auth' }, proc('running')),
      real(
        'mcp__conch__process_read',
        { id: 'p1' },
        proc('exited', { exitCode: 1, output: ' Tests  2 failed | 239 passed (241)' }),
      ),
    ]);
    expect(failed.status).toBe('failed');
    expect(failed.outcome).toBe('2 failed');
    const going = one([
      real('mcp__conch__process_start', { command: 'pnpm test --filter auth' }, proc('running')),
      real('mcp__conch__process_read', { id: 'p1' }, proc('running')),
    ]);
    expect(storyVisibleSteps(going)[0]?.label.done).toBe('Started the tests');
  });

  it('tells a check with its fixes as the check: the tests lead, edits never do', () => {
    const s = one([
      real(
        'mcp__conch__process_start',
        { command: 'pnpm test --filter auth', cwd: root },
        proc('running'),
      ),
      real('mcp__conch__process_read', { id: 'p1' }, proc('running')),
      real(
        'mcp__conch__process_read',
        { id: 'p1' },
        proc('exited', { exitCode: 0, output: '      Tests  241 passed (241)' }),
      ),
      real('Bash', { command: `pnpm -C ${root} typecheck` }, 'Tasks: 6 successful, 6 total'),
      real(
        'Bash',
        { command: `pnpm -C ${root} lint` },
        '/x/clock.ts\n  1:1  error  Missing return type  rule\n\n✖ 2 problems (2 errors, 0 warnings)',
        { status: 'error' },
      ),
      real(
        'Edit',
        { file_path: `${root}/apps/server/src/auth/clock.ts`, old_string: 'a', new_string: 'b' },
        'ok',
      ),
      real('Bash', { command: `pnpm -C ${root} lint` }, 'Tasks: 6 successful, 6 total'),
    ]);
    expect(s.family).toBe('verify');
    expect(s.status).toBe('done');
    expect(s.headline).toBe('Ran the tests and 2 other checks');
    expect(s.outcome).toBe('241 passed');
    expect(s.note).toBe('Worked after a fix');
  });

  it('leads with what most steps did: three pages read over one search', () => {
    const page = (asin: string) =>
      real('mcp__conch__web_fetch', { url: `https://www.amazon.de/dp/${asin}` }, 'Title: x', {
        viewKind: 'sources',
      });
    const s = one([
      real(
        'mcp__conch__web_search',
        { query: 'amazon.de herren oxford hemd weiß slim fit' },
        '1. x\n2. y',
      ),
      page('B07QXV6N4R'),
      page('B08Z4KQ1LM'),
      page('B09MZ2XR7T'),
      page('B07QXV6N4R'),
    ]);
    expect(s.repeats).toBe(1);
    expect(s.headline).toBe('Searched the web and read 3 pages on amazon.de');
  });

  it('keeps the leading phrase’s fullest words that fit, and drops to it alone when none do', () => {
    const host = 'docs.a-very-long-documentation-site.example.com';
    const page = (i: number) => real('WebFetch', { url: `https://${host}/p${i}` });
    // "Read 3 pages on docs.…" won't fit beside anything: the search keeps its words.
    expect(one([webSearch('x'.repeat(10)), page(1), page(2), page(3)]).headline).toBe(
      'Searched the web for “xxxxxxxxxx” and read 3 pages',
    );
    const long = (i: number) =>
      step(
        'mail_send',
        { i },
        {
          family: 'connect',
          doing: 'x',
          done: `Sent ${'a long word '.repeat(5)}${i}`,
          effects: [{ kind: 'send', text: 'Sent' }],
        },
      );
    const s = one([
      long(1),
      long(2),
      step(
        'mail_x',
        {},
        {
          family: 'connect',
          doing: 'x',
          done: `Moved ${'another long word '.repeat(3)}`,
          effects: [{ kind: 'other', text: 'Moved' }],
        },
      ),
    ]);
    expect(s.headline).toMatch(/^Sent a long word/);
    expect(s.headline).not.toMatch(/ and moved/);
  });

  it('counts looks against looks, and the most-done one leads', () => {
    const s = one([
      real('Bash', { command: `git -C ${root} status --short` }, ' M a.ts'),
      real('Read', { file_path: `${root}/apps/web/src/login.test.ts` }, 'x'),
      real('Read', { file_path: `${root}/apps/server/src/auth/session.ts` }, 'x'),
      real('Grep', { pattern: 'expiresAt', path: `${root}/apps` }, 'apps/a.ts\napps/b.ts'),
      real('Glob', { pattern: '**/*.test.ts' }, 'a.test.ts\nb.test.ts'),
      real('Bash', { command: "python3 - <<'PY'\nprint(1)\nPY" }, '1'),
      real('Read', { file_path: `${root}/package.json` }, '{}'),
    ]);
    expect(s.headline).toBe('Read 3 files and searched the code');
    expect(s.family).toBe('explore');
    // What a listing found isn't what reading three files came to.
    expect(s.outcome).toBeUndefined();
  });

  it('never lets a look join a change, but lets a check', () => {
    expect(one([read('a.ts'), read('b.ts'), read('c.ts'), edit('a.ts')]).headline).toBe(
      'Edited a.ts',
    );
    expect(one([edit('a.ts'), test()]).headline).toBe('Edited a.ts and ran the tests');
  });

  it('says changes to several files in their lines together', () => {
    const s = one([
      real('Edit', { file_path: '/x/session.ts', old_string: 'a', new_string: 'b' }, 'ok'),
      real('Write', { file_path: '/x/clock.ts', content: 'x\n' }, 'ok'),
      real('Edit', { file_path: '/x/login.test.ts', old_string: 'a', new_string: 'b\nc' }, 'ok'),
    ]);
    expect(s.headline).toBe('Changed session.ts and 2 other files');
    expect(s.outcome).toBe('+4 −2');
  });

  it('puts what never ran last, and says it plainly when that’s all', () => {
    const no = (name: string, input: unknown) => real(name, input, '', { approval: 'declined' });
    const all = one([no('Bash', { command: 'pnpm test' })]);
    expect(all.headline).toBe('Didn’t run the tests');
    expect(all.status).toBe('done');
    expect(all.effects).toEqual([]);
    const two = one([
      no('Edit', { file_path: '/x/a.md', old_string: 'a', new_string: 'b' }),
      no('Bash', { command: 'pnpm test' }),
    ]);
    expect(two.headline).toBe('Didn’t edit a.md and run the tests');
    const mixed = one([
      read('a.ts'),
      read('b.ts'),
      no('Edit', { file_path: '/x/notes.md', old_string: 'a', new_string: 'b' }),
    ]);
    expect(mixed.headline).toBe('Read 2 files');
    expect(mixed.status).toBe('done');
  });
});

// ------------------------------------------------- status, outcome, retries

describe('tellStories: status and outcome', () => {
  it('is running while any step runs or waits', () => {
    expect(tellStories([read('a'), running(read('b'))])[0]?.status).toBe('running');
    expect(tellStories([read('a'), { ...read('b'), status: 'pending' }])[0]?.status).toBe(
      'running',
    );
    expect(tellStories([running(read('a'))])[0]?.durationMs).toBeUndefined();
  });

  it('fails when the last check failed, and says what it found', () => {
    const s = tellStories([test(false)])[0] as Story;
    expect(s.status).toBe('failed');
    expect(s.outcome).toBe('3 failed');
    expect(s.headline).toBe('Ran the tests');
  });

  it('is done when a failed check passes on a retry, and says so', () => {
    const s = tellStories([test(false), test(true)])[0] as Story;
    expect(s.status).toBe('done');
    expect(s.note).toBe('Worked on the second try');
    expect(s.outcome).toBe('241 passed');
  });

  it('counts tries', () => {
    const s = tellStories([
      sh('pnpm i', false),
      sh('pnpm i', false),
      sh('pnpm i', true),
    ])[0] as Story;
    expect(s.status).toBe('done');
    expect(s.note).toBe('Worked on the third try');
  });

  it('fails when every step failed', () => {
    const s = tellStories([sh('a', false), sh('b', false)])[0] as Story;
    expect(s.status).toBe('failed');
    expect(s.outcome).toBe('exit 1');
    expect(s.note).toBeUndefined();
  });

  it('is done when one of several reads failed', () => {
    const bad = { ...read('missing.ts'), status: 'error' as const };
    expect(tellStories([read('a'), bad, read('b')])[0]?.status).toBe('done');
  });

  it('fails when a push went wrong and nothing put it right', () => {
    expect(tellStories([commit(), push('main', false)])[0]?.status).toBe('failed');
    expect(tellStories([commit(), push('main', false), push('main')])[0]?.status).toBe('done');
  });

  it('takes the outcome of the last check, then of a push', () => {
    expect(tellStories([test(true, '12 passed')])[0]?.outcome).toBe('12 passed');
    expect(tellStories([commit(), push('main')])[0]?.outcome).toBe('1 commit to main');
    expect(tellStories([grep('x')])[0]?.outcome).toBe('3 matches');
  });

  it('times a story from its first start to its last end', () => {
    const a = read('a');
    const b = read('b');
    const s = tellStories([a, b])[0] as Story;
    expect(s.startedAt).toBe(a.startedAt);
    expect(s.durationMs).toBe(b.startedAt + 500 - a.startedAt);
  });
});

// --------------------------------------------------- repeats and chips

describe('tellStories: repeats and chips', () => {
  it('folds the same page fetched twice', () => {
    const a = fetchPage('https://www.amazon.de/a');
    const s = tellStories([a, again(a), fetchPage('https://www.amazon.de/b')])[0] as Story;
    expect(s.repeats).toBe(1);
    expect(storyStepCount(s)).toBe(2);
    expect(storyVisibleSteps(s).map((x) => x.id)).not.toContain(s.steps[1]?.id);
    expect(s.headline).toBe('Read 2 pages on amazon.de');
    expect(s.chips.map((c) => c.href)).toEqual([
      'https://www.amazon.de/a',
      'https://www.amazon.de/b',
    ]);
  });

  it('doesn’t fold a file read again after it was changed', () => {
    const r = read('a.ts');
    const s = tellStories([r, edit('a.ts'), again(r)])[0] as Story;
    expect(s.repeats).toBe(0);
  });

  it('doesn’t fold a retry that worked', () => {
    const s = tellStories([test(false), test(true)])[0] as Story;
    expect(s.repeats).toBe(0);
  });

  it('dedupes chips by link or label and keeps at most twelve', () => {
    const steps = Array.from({ length: 20 }, (_, i) => read(`f${i % 15}.ts`)).map((s, i) => ({
      ...s,
      label: { ...s.label, chips: [{ kind: 'file' as const, label: `f${i % 15}.ts` }] },
    }));
    const stories = tellStories(steps);
    expect(stories[0]?.chips).toHaveLength(12);
    expect(new Set(stories[0]?.chips.map((c) => c.label)).size).toBe(12);
  });
});

// --------------------------------------------------------------- stuck

describe('tellStories: stuck', () => {
  it('says when the same command failed three times', () => {
    const steps = [sh('pnpm build', false), sh('pnpm build', false), sh('pnpm build', false)];
    expect(tellStories(steps)[0]?.stuck).toBe('The same command failed 3 times');
    expect(tellStories(steps)[0]?.repeats).toBe(0);
  });

  it('says nothing when it worked in the end', () => {
    const steps = [
      sh('pnpm build', false),
      sh('pnpm build', false),
      sh('pnpm build', false),
      sh('pnpm build'),
    ];
    expect(tellStories(steps)[0]?.stuck).toBeUndefined();
  });

  it('says it while the story still runs', () => {
    const steps = [test(false), test(false), test(false), running(test())];
    const s = tellStories(steps)[0] as Story;
    expect(s.status).toBe('running');
    expect(s.stuck).toBe('The same command failed 3 times');
  });

  it('says when checks on a command find nothing new for a long time', () => {
    clock += 0;
    const steps = [start('pnpm dev', 'run')];
    for (let i = 0; i < 5; i += 1)
      steps.push(poll('p1', 'Waiting', { startedAt: clock + i * 60_000 }));
    const s = tellStories(steps)[0] as Story;
    expect(s.stuck).toBe('Checked on it 5 times in 4 minutes and nothing changed');
  });

  it('says nothing for a few quick polls, or polls that see progress', () => {
    const quick = [
      start('pnpm test'),
      poll('p1', 'x'),
      poll('p1', 'x'),
      poll('p1', 'x'),
      poll('p1', 'x'),
    ];
    expect(tellStories(quick)[0]?.stuck).toBeUndefined();
    const moving = [start('pnpm test')];
    for (let i = 0; i < 6; i += 1)
      moving.push(poll('p1', `${i * 10}%`, { startedAt: clock + i * 60_000 }));
    expect(tellStories(moving)[0]?.stuck).toBeUndefined();
  });

  it('says when the same change is made and undone', () => {
    const steps = [edit('a.ts', 'x', 'y'), edit('a.ts', 'y', 'x'), edit('a.ts', 'x', 'y')];
    expect(tellStories(steps)[0]?.stuck).toBe('It keeps making the same change and undoing it');
    expect(tellStories(steps.slice(0, 2))[0]?.stuck).toBeUndefined();
  });
});

// --------------------------------------------------------------- effects

describe('effects', () => {
  it('merges a story’s changed files, once each', () => {
    const s = tellStories([edit('a.ts'), edit('a.ts'), edit('b.ts'), edit('c.ts')])[0] as Story;
    expect(s.effects).toEqual([{ kind: 'file', text: 'Changed 3 files', undo: 'cs1' }]);
  });

  it('keeps one file in its own words', () => {
    const s = tellStories([edit('a.ts'), edit('a.ts')])[0] as Story;
    expect(s.effects).toEqual([
      { kind: 'file', text: 'Changed a.ts', target: 'a.ts', undo: 'cs1' },
    ]);
  });

  it('orders a turn’s changes by consequence and keeps what others see one by one', () => {
    const steps = [
      edit('a.ts'),
      create('b.ts'),
      edit('b.ts'),
      commit(),
      commit(),
      push('main'),
      push('main'),
      mail('Sending an email', 'Sent an email', [
        { kind: 'send', text: 'Sent an email to Ana', target: 'ana@example.com' },
      ]),
      mail('Sending an email', 'Sent an email', [
        { kind: 'send', text: 'Sent an email to Bo', target: 'bo@example.com' },
      ]),
      step(
        'npm',
        { i: 1 },
        {
          family: 'run',
          doing: 'Installing',
          done: 'Installed',
          effects: [
            { kind: 'install', text: 'Installed zod', target: 'zod' },
            { kind: 'install', text: 'Installed vitest', target: 'vitest' },
          ],
        },
      ),
    ];
    expect(turnEffects(steps)).toEqual([
      { kind: 'send', text: 'Sent an email to Ana', target: 'ana@example.com' },
      { kind: 'send', text: 'Sent an email to Bo', target: 'bo@example.com' },
      { kind: 'push', text: 'Pushed to main', target: 'main' },
      { kind: 'commit', text: 'Committed “fix the sidebar”', target: 'main' },
      { kind: 'file', text: 'Changed 2 files', undo: 'cs1' },
      { kind: 'install', text: 'Installed 2 packages' },
    ]);
    const groups = groupEffects(steps.flatMap((s) => s.label.effects ?? []));
    expect(groups.map((g) => [g.kind, g.text, g.items.length])).toEqual([
      ['send', 'Sent 2 messages', 2],
      ['push', 'Pushed to main', 1],
      ['commit', 'Committed “fix the sidebar”', 1],
      ['file', 'Changed 2 files', 2],
      ['install', 'Installed 2 packages', 2],
    ]);
    // Created, then changed: still created.
    expect(groups[3]?.items.find((e) => e.target === 'b.ts')?.text).toBe('Created b.ts');
  });

  it('says deleted when a changed file was deleted', () => {
    const groups = groupEffects([
      { kind: 'file', text: 'Changed a.ts', target: 'a.ts' },
      { kind: 'file', text: 'Deleted a.ts', target: 'a.ts' },
      { kind: 'file', text: 'Deleted b.ts', target: 'b.ts' },
    ]);
    expect(groups).toEqual([
      {
        kind: 'file',
        text: 'Deleted 2 files',
        items: [
          { kind: 'file', text: 'Deleted a.ts', target: 'a.ts' },
          { kind: 'file', text: 'Deleted b.ts', target: 'b.ts' },
        ],
      },
    ]);
  });

  it('has nothing to say for a turn that changed nothing', () => {
    expect(turnEffects([read('a'), grep('b')])).toEqual([]);
    expect(groupEffects([])).toEqual([]);
  });
});

// ---------------------------------------------------- phases and steps

describe('phaseOf', () => {
  it('puts each family in its phase of the work', () => {
    expect(phaseOf({ family: 'explore' })).toBe('work');
    expect(phaseOf({ family: 'edit' })).toBe('work');
    expect(phaseOf({ family: 'verify' })).toBe('verify');
    expect(phaseOf({ family: 'browse' })).toBe('research');
    expect(phaseOf({ family: 'connect' })).toBe('connect');
  });
});

describe('stepFromTool', () => {
  it('keeps the words a call already carries', () => {
    const label: ToolLabel = {
      family: 'verify',
      doing: 'Running the tests',
      done: 'Ran the tests',
    };
    const s = stepFromTool({
      id: 't1',
      name: 'Bash',
      input: { command: 'pnpm test' },
      status: 'success',
      output: 'ok',
      durationMs: 20,
      startedAt: 5,
      label,
    });
    expect(s).toEqual({
      id: 't1',
      name: 'Bash',
      input: { command: 'pnpm test' },
      status: 'success',
      label,
      startedAt: 5,
      durationMs: 20,
    });
  });

  it('works the words out when a call has none', () => {
    const s = stepFromTool({
      id: 't2',
      name: 'Read',
      input: { file_path: 'a.ts' },
      status: 'running',
      startedAt: 1,
    });
    expect(s.label.doing.length).toBeGreaterThan(0);
    expect(s.label.done.length).toBeGreaterThan(0);
    expect(s.durationMs).toBeUndefined();
  });

  it('tells stories from bare tool calls with any reasonable words', () => {
    const calls = [
      { name: 'Grep', input: { pattern: 'Sidebar' } },
      { name: 'Read', input: { file_path: 'src/Sidebar.tsx' } },
      { name: 'Edit', input: { file_path: 'src/Sidebar.tsx', old_string: 'a', new_string: 'b' } },
      { name: 'Bash', input: { command: 'pnpm test' } },
      { name: 'Bash', input: { command: 'git commit -m "fix"' } },
      { name: 'Bash', input: { command: 'git push origin main' } },
    ];
    const steps = calls.map((c, i) =>
      stepFromTool({
        id: `c${i}`,
        ...c,
        status: 'success',
        output: '',
        startedAt: i * 1000,
        durationMs: 10,
      }),
    );
    const stories = expectStable(steps);
    expect(stories.length).toBeGreaterThanOrEqual(1);
    expect(stories.length).toBeLessThanOrEqual(4);
    for (const s of stories) {
      expect(s.status).toBe('done');
      expect(s.headline.length).toBeGreaterThan(0);
      expect(s.headline.length).toBeLessThanOrEqual(60);
    }
    const live = stepFromTool({
      id: 'c9',
      name: 'Bash',
      input: { command: 'pnpm test' },
      status: 'running',
      startedAt: 9_000,
    });
    const withLive = tellStories([...steps, live]);
    expect(withLive[withLive.length - 1]?.status).toBe('running');
  });
});
