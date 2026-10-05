/**
 * The words a wait shows: chosen from what was asked, and after a tool, from
 * what that tool was. Hundreds of them, shuffled afresh for every wait, so a
 * long job never says the same thing twice in a row.
 */

export type ThinkingPhase = 'starting' | 'thinking' | 'after-tool';

/** What just ran, as far as the words go. */
export type ToolFamily =
  'shell' | 'browser' | 'read' | 'edit' | 'search' | 'memory' | 'apps' | 'other';

const THEMES: [RegExp, string[]][] = [
  [
    /\b(bug|error|fix|broken|crash|fail|failing|issue|wrong|debug|stuck|exception|regression)\w*/i,
    [
      'Tracing the problem',
      'Following the clues',
      'Narrowing it down',
      'Testing a theory',
      'Reading the stack',
      'Ruling things out',
      'Retracing the steps',
      'Looking under the hood',
      'Finding where it breaks',
      'Checking the usual suspects',
      'Sorting cause from symptom',
      'Pulling on a thread',
      'Isolating the fault',
      'Reproducing it in my head',
      'Turning over every stone',
      'Hunting it down',
      'Lining up the evidence',
      'Getting to the root',
    ],
  ],
  [
    /\b(write|draft|email|letter|reply|post|story|poem|essay|message|rewrite|caption|bio|speech|toast)\w*/i,
    [
      'Finding the words',
      'Sketching a draft',
      'Choosing the tone',
      'Polishing phrases',
      'Weighing each word',
      'Setting the rhythm',
      'Trying an opening',
      'Trimming the excess',
      'Reading it aloud, quietly',
      'Warming up the sentences',
      'Finding your voice in it',
      'Smoothing the edges',
      'Picking the right verb',
      'Shaping the ending',
      'Letting it breathe',
      'Making it sound like you',
    ],
  ],
  [
    /\b(summar|tl;?dr|recap|digest|overview|brief|highlights?|key points)\w*/i,
    [
      'Reading closely',
      'Finding what matters',
      'Distilling it',
      'Boiling it down',
      'Keeping the essentials',
      'Skimming for the gist',
      'Marking the highlights',
      'Folding it to a page',
      'Sorting signal from noise',
      'Gathering the threads',
      'Weighing what to keep',
      'Pressing it into a few lines',
    ],
  ],
  [
    /\btranslat\w*|\bin (french|spanish|german|greek|italian|japanese|chinese|portuguese|arabic)\b/i,
    [
      'Finding the words',
      'Carrying the meaning across',
      'Listening for the idiom',
      'Minding the nuance',
      'Matching the register',
      'Keeping the tone intact',
      'Choosing between near-synonyms',
      'Crossing the language bridge',
    ],
  ],
  [
    /\b(plan|design|architect|idea|brainstorm|strategy|should i|options?|roadmap|approach|decide)\b/i,
    [
      'Sketching options',
      'Weighing trade-offs',
      'Mapping it out',
      'Looking for the elegant path',
      'Laying out the pieces',
      'Thinking a few moves ahead',
      'Testing each option',
      'Drawing the big picture',
      'Finding the first step',
      'Stress-testing the plan',
      'Counting the costs',
      'Picturing how it plays out',
      'Ordering the steps',
      'Looking for the catch',
      'Balancing the scales',
      'Choosing a direction',
    ],
  ],
  [
    /\b(code|function|refactor|repo|build|implement|component|test|api|script|class|deploy|commit|merge|type|lint)\w*/i,
    [
      'Reading the code',
      'Mapping the pieces',
      'Planning the change',
      'Checking the edges',
      'Following the call path',
      'Tracing the types',
      'Lining up the tests',
      'Minding the imports',
      'Weighing a refactor',
      'Reading between the lines',
      'Untangling the dependencies',
      'Keeping it tidy',
      'Thinking about edge cases',
      'Matching the house style',
      'Wiring it together',
      'Checking what calls what',
      'Picturing the diff',
      'Counting the moving parts',
    ],
  ],
  [
    /\b(research|find out|look up|compare|best|review|which|recommend|sources?|evidence)\b/i,
    [
      'Digging in',
      'Comparing notes',
      'Checking the sources',
      'Following the references',
      'Cross-checking facts',
      'Weighing the evidence',
      'Reading the fine print',
      'Gathering perspectives',
      'Separating fact from fluff',
      'Building the picture',
      'Looking for consensus',
      'Noting the outliers',
    ],
  ],
  [
    /\b(data|numbers?|spreadsheet|csv|chart|stats?|average|total|budget|cost|price|calculate|math)\b/i,
    [
      'Crunching the numbers',
      'Lining up the columns',
      'Running the sums',
      'Looking for patterns',
      'Checking the arithmetic',
      'Spotting the trend',
      'Double-checking totals',
      'Sorting the figures',
      'Reading the shape of it',
      'Rounding with care',
    ],
  ],
  [
    /\b(trip|travel|flight|hotel|book|booking|itinerary|holiday|vacation|restaurant|reservation)\w*/i,
    [
      'Planning the route',
      'Checking the dates',
      'Comparing the options',
      'Packing the details',
      'Lining up the bookings',
      'Minding the time zones',
      'Looking for the good spots',
      'Sketching the itinerary',
      'Checking what’s open',
      'Weighing price and comfort',
    ],
  ],
  [
    /\b(explain|why|how|what|understand|mean|difference|teach|learn)\b/i,
    [
      'Untangling it',
      'Connecting the dots',
      'Finding the clearest way',
      'Shaping an explanation',
      'Starting from the basics',
      'Finding a good example',
      'Building it up step by step',
      'Looking for the analogy',
      'Making it click',
      'Clearing away the jargon',
      'Finding the heart of it',
      'Drawing it out',
      'Choosing what to leave out',
      'Laying the groundwork',
    ],
  ],
];

const GENERAL = [
  'Thinking it through',
  'Gathering thoughts',
  'Diving deeper',
  'Turning it over',
  'Mulling it over',
  'Considering the angles',
  'Weighing it up',
  'Getting my bearings',
  'Joining the dots',
  'Sorting it out',
  'Finding the thread',
  'Taking a closer look',
  'Piecing it together',
  'Working it out',
  'Reflecting',
  'Pondering',
  'Collecting ideas',
  'Lining things up',
  'Finding a way in',
  'Sketching a path',
  'Putting it in order',
  'Feeling it out',
  'Following a hunch',
  'Thinking out loud, quietly',
  'Filling in the gaps',
  'Getting the full picture',
  'Making sense of it',
  'Looking at it sideways',
  'Shuffling the pieces',
  'Finding the shape of it',
  'Keeping it simple',
  'Testing the idea',
  'Checking my thinking',
  'Laying it out',
  'Weighing the details',
  'Bringing it into focus',
  'Spinning up',
  'On it',
  'Rolling up my sleeves',
  'Clearing a space to think',
  'Finding the right answer',
  'Going step by step',
  'Tuning in',
  'Working through it',
  'Considering carefully',
  'Brewing an answer',
  'Gathering the pieces',
  'Following the logic',
  'Charting a course',
  'Reading the room',
];

const LONG = [
  'Diving deeper still',
  'Worth getting right',
  'Still with you',
  'Taking the careful route',
  'Nearly there, properly',
  'Going the extra mile',
  'Checking it twice',
  'No corners cut',
  'Being thorough',
  'This one deserves time',
  'Still at it',
  'Making it solid',
  'Getting the details right',
  'In it for the long haul',
  'Thinking harder',
  'Quietly persisting',
];

const AFTER: Record<ToolFamily, string[]> = {
  shell: [
    'Reading the output',
    'Checking what it printed',
    'Parsing the logs',
    'Scanning the results',
    'Seeing how it ran',
    'Looking at the exit code',
    'Combing through the output',
    'Checking for warnings',
    'Reading the run',
    'Taking in the numbers',
    'Seeing what passed',
    'Sifting through lines',
    'Spotting the important bit',
    'Following the trace',
    'Checking it worked',
    'Reading between the logs',
    'Noting what changed',
    'Lining up the next command',
    'Weighing what it said',
    'Making sense of the output',
    'Checking the tail end',
    'Picking out the errors',
    'Reading the verdict',
    'Counting what’s left',
  ],
  browser: [
    'Looking at the page',
    'Reading the page',
    'Finding the right button',
    'Scanning the layout',
    'Checking what loaded',
    'Taking in the screen',
    'Finding my way around',
    'Following the links',
    'Reading the fine print',
    'Spotting the next step',
    'Looking for the form',
    'Checking it went through',
    'Getting my bearings on the site',
    'Scanning down the page',
    'Reading the menu',
    'Noting what moved',
    'Picking the next click',
    'Checking the details',
    'Looking past the banners',
    'Reading the results page',
    'Finding the important part',
    'Comparing what’s shown',
  ],
  read: [
    'Reading it through',
    'Taking it in',
    'Skimming the file',
    'Reading closely',
    'Finding the relevant part',
    'Getting familiar with it',
    'Noting the structure',
    'Following along',
    'Studying the details',
    'Reading the lay of the land',
    'Marking what matters',
    'Picking out the key lines',
    'Understanding how it fits',
    'Learning the shape of it',
    'Turning the pages',
    'Reading the context',
    'Holding it in mind',
    'Seeing how it’s built',
  ],
  edit: [
    'Checking the change',
    'Looking over the edit',
    'Making sure it fits',
    'Reviewing what I wrote',
    'Double-checking the diff',
    'Tidying up',
    'Seeing it in place',
    'Minding the neighbours',
    'Checking nothing broke',
    'Settling the change',
    'Reading it back',
    'Smoothing the seams',
    'Lining it up with the rest',
    'Looking for loose ends',
    'Making it consistent',
    'Moving to the next piece',
    'Admiring the tidiness, briefly',
    'Keeping track of changes',
  ],
  search: [
    'Sorting the results',
    'Picking the best matches',
    'Reading the hits',
    'Following the leads',
    'Sifting what came back',
    'Weighing the sources',
    'Narrowing the search',
    'Cross-checking what I found',
    'Finding the useful ones',
    'Skimming the findings',
    'Separating gold from gravel',
    'Noting what’s relevant',
    'Checking the dates',
    'Following a promising lead',
    'Ranking what I found',
    'Looking for agreement',
    'Reading the snippets',
    'Digging into a result',
  ],
  memory: [
    'Remembering',
    'Recalling what you said',
    'Checking what I know',
    'Looking back',
    'Joining it to what I know',
    'Keeping that in mind',
    'Noting it down',
    'Bringing it to mind',
    'Matching it with earlier',
    'Filing it away',
    'Thinking back',
    'Connecting the memories',
  ],
  apps: [
    'Reading what came back',
    'Checking the reply',
    'Taking in the details',
    'Seeing what it says',
    'Sorting the response',
    'Picking out what matters',
    'Lining up the next step',
    'Checking it went through',
    'Making sense of the reply',
    'Reading the update',
    'Matching it to the plan',
    'Noting the details',
    'Folding it into the answer',
    'Following up',
  ],
  other: [
    'Taking that in',
    'Reading the results',
    'Piecing it together',
    'Weighing what came back',
    'Making sense of it',
    'Fitting it into place',
    'Seeing where that leaves us',
    'Moving to the next step',
    'Checking the result',
    'Thinking about what’s next',
    'Absorbing it',
    'Folding that in',
    'Updating the picture',
    'Taking stock',
    'Considering the result',
    'Lining up what’s next',
    'Adding it to the pile',
    'Building on that',
    'Keeping the thread',
    'Noting that',
    'Turning it over',
    'Connecting it up',
    'Going on from there',
    'Seeing how it fits',
  ],
};

/** What a tool's name says it does, as far as the words go. */
export function familyOf(name: string): ToolFamily {
  const n = name.toLowerCase();
  if (/remember|recall|memor|forget/.test(n)) return 'memory';
  if (/browser|navigate|click|screenshot|playwright/.test(n)) return 'browser';
  if (/edit|write|patch|apply|create_file|str_replace|replace|save/.test(n)) return 'edit';
  if (/grep|search|find|glob|fetch|web|research|look_?up|query/.test(n)) return 'search';
  if (/bash|shell|exec|command|terminal|run|process|powershell/.test(n)) return 'shell';
  if (/read|view|open|cat|list|ls\b|show/.test(n)) return 'read';
  if (n.startsWith('mcp__')) return 'apps';
  return 'other';
}

/** A small, steady hash, so the same wait keeps its words while it lasts. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The list in an order of its own for this seed (Fisher–Yates on a tiny PRNG). */
function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = hash(seed) || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** How many words one wait cycles through before the long-think ones. */
const SHOWN = 8;

/**
 * The words the wait shows, chosen from what was asked: a bug gets "Tracing
 * the problem", an email gets "Finding the words"; after a command, "Reading
 * the output", after a page, "Looking at the page". It opens by listening,
 * admits to a long think instead of pretending it's nearly done, and each
 * wait (`seed`) gets its own order, so no two read alike.
 */
export function verbsFor(
  prompt: string,
  phase: ThinkingPhase,
  { seed = prompt, tool }: { seed?: string; tool?: ToolFamily } = {},
): string[] {
  if (phase === 'after-tool') {
    const family = tool ?? 'other';
    const pool = family === 'other' ? AFTER.other : [...AFTER[family], ...AFTER.other.slice(0, 6)];
    return shuffled(pool, `${seed}:${family}`).slice(0, SHOWN);
  }
  const themed = THEMES.find(([pattern]) => pattern.test(prompt))?.[1];
  // Mostly the request's own words, with a few general ones for colour.
  const pool = themed ? [...themed, ...shuffled(GENERAL, seed).slice(0, 4)] : GENERAL;
  // The theme's own first word leads, so the wait opens on the request.
  const lead = themed?.[0];
  const rest = shuffled(
    pool.filter((word) => word !== lead),
    seed,
  ).slice(0, lead ? SHOWN - 1 : SHOWN);
  const verbs = lead ? [lead, ...rest] : rest;
  // The long-think words come last, so they only show once the wait has gone on a while.
  const long = shuffled(LONG, seed).slice(0, 3);
  const all = [...verbs, ...long];
  return phase === 'starting' ? ['Listening', ...all] : all;
}

/** Every word there is, for a test that counts them. */
export const ALL_VERBS = new Set([
  ...THEMES.flatMap(([, words]) => words),
  ...GENERAL,
  ...LONG,
  ...Object.values(AFTER).flat(),
]);
