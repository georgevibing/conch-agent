/**
 * What the eval suite asks every model to do (ADR 0071). Each task is a short
 * script against the local fixtures, checked by code: what the site recorded,
 * what the pretend Ledger app was called with, what Conch stored, and what the
 * answer says. No model ever grades another.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Question, QuestionAnswer } from '@conch/protocol';

import { SITE, type Submissions } from './fixtures/site';

export interface Verdict {
  status: 'pass' | 'fail' | 'error';
  reason: string;
}

/** One message's outcome, as the person would see it. */
export interface Turn {
  chat: string;
  /** Everything the assistant wrote in this turn. */
  text: string;
  outcome: 'success' | 'error' | 'interrupted' | 'needs-apps' | 'held' | 'timeout';
  error?: string;
}

export interface Target {
  /** The matrix row's id. */
  id: string;
  engine: string;
  model?: string;
}

/** What a task can do and see while it runs. */
export interface Scene {
  siteUrl: string;
  submissions: Submissions;
  workspace: string;
  /** Send a message (in `chat`, or a new chat) as `as` (default: the model under test). */
  say(text: string, options?: { chat?: string; as?: Target }): Promise<Turn>;
  /** The calls the Ledger fixture received, in order. */
  ledgerCalls(): Promise<{ tool: string; args: Record<string, unknown> }[]>;
  /** What Conch remembers now. */
  memories(): Promise<string[]>;
  /**
   * Conch's quiet look at a chat, as if it had gone quiet (ADR 0088): what it
   * learned, or why it learned nothing.
   */
  review(chat: string): Promise<{ learned: string[]; why?: string }>;
  /** How to answer a question card; the default picks the first option. */
  onQuestion(answer: (question: Question) => QuestionAnswer | null): void;
  /** What happened so far: questions asked, handoffs, every tool call's input. */
  seen: { questions: Question[]; handoffs: number; toolInputs: { name: string; input: unknown }[] };
  /** The model a chat is handed over from, for the switch task. */
  partner?: Target;
}

export interface EvalTask {
  id: string;
  title: string;
  /** What it proves, in a line for the report. */
  about: string;
  needs?: readonly ('ledger' | 'partner')[];
  timeoutMs?: number;
  smoke?: boolean;
  run(scene: Scene): Promise<Verdict>;
}

const pass = (reason: string): Verdict => ({ status: 'pass', reason });
const fail = (reason: string): Verdict => ({ status: 'fail', reason });

/** Whether a turn ended with an answer at all; the verdict when it didn't. */
export function unanswered(turn: Turn): Verdict | undefined {
  if (turn.outcome === 'success') return undefined;
  if (turn.outcome === 'needs-apps')
    return fail('the model can’t use apps, so Conch held the message');
  if (turn.outcome === 'timeout') return fail('timed out');
  return fail(
    `the turn ended with ${turn.outcome}${turn.error ? `: ${turn.error.slice(0, 160)}` : ''}`,
  );
}

/** Digits and letters only, so "1,234.50" and "1234.5" read alike. */
export function mentionsAmount(text: string, amount: number): boolean {
  const options = new Set<string>();
  const fixed = amount.toFixed(2);
  const [whole = '', cents = '00'] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dotted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  for (const w of [whole, grouped]) {
    options.add(`${w}.${cents}`);
    if (cents === '00') options.add(w);
    else if (cents.endsWith('0')) options.add(`${w}.${cents[0]}`);
  }
  options.add(`${dotted},${cents}`);
  options.add(`${whole},${cents}`);
  return [...options].some((o) =>
    new RegExp(`(?<![\\d.,])${o.replace(/[.,]/g, (c) => `\\${c}`)}(?![\\d]|[.,]\\d)`).test(text),
  );
}

export const mentions = (text: string, words: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').includes(words.toLowerCase());

export function checkSignup(signups: readonly Record<string, string>[]): Verdict {
  const last = signups.at(-1);
  if (!last) return fail('the form was never submitted');
  const wrong = [
    last.name?.trim() !== 'Ada Lovelace' && `name was “${last.name ?? ''}”`,
    last.email?.trim().toLowerCase() !== 'ada@example.com' && `email was “${last.email ?? ''}”`,
    last.plan !== 'Pro' && `plan was “${last.plan ?? ''}”`,
    last.terms !== 'yes' && 'the terms weren’t ticked',
    !/eval/i.test(last.message ?? '') && 'the message was missing',
  ].filter(Boolean);
  return wrong.length ? fail(`submitted, but ${wrong.join(', ')}`) : pass('submitted correctly');
}

export const SHOPPING: readonly { item: string; quantity: number }[] = [
  { item: 'Apples', quantity: 4 },
  { item: 'Bread', quantity: 1 },
  { item: 'Milk', quantity: 2 },
  { item: 'Eggs', quantity: 3 },
  { item: 'Coffee', quantity: 1 },
  { item: 'Rice', quantity: 2 },
  { item: 'Tomatoes', quantity: 5 },
  { item: 'Cheese', quantity: 1 },
  { item: 'Lemons', quantity: 3 },
  { item: 'Butter', quantity: 2 },
];

export function checkList(saved: readonly { item: string; quantity: number }[][]): Verdict {
  const last = saved.at(-1);
  if (!last) return fail('the list was never saved');
  const got = new Map(last.map((l) => [l.item.trim().toLowerCase(), l.quantity]));
  const missing = SHOPPING.filter((s) => !got.has(s.item.toLowerCase())).map((s) => s.item);
  const wrongQty = SHOPPING.filter(
    (s) => got.has(s.item.toLowerCase()) && got.get(s.item.toLowerCase()) !== s.quantity,
  ).map((s) => s.item);
  const extra = last.length - (SHOPPING.length - missing.length);
  const problems = [
    missing.length && `missing ${missing.join(', ')}`,
    wrongQty.length && `wrong quantity for ${wrongQty.join(', ')}`,
    extra > 0 && `${extra} extra`,
  ].filter(Boolean);
  return problems.length
    ? fail(`saved ${last.length} items: ${problems.join('; ')}`)
    : pass('saved all ten');
}

/**
 * What a person who doesn't mind answers: the first option of a choice, "your
 * call" for words, the suggested number. A field it can't fill (a date with no
 * suggestion) is left out when it may be, and otherwise the question is skipped.
 */
export function firstOption(question: Question): QuestionAnswer | null {
  const values: QuestionAnswer['values'] = {};
  for (const field of question.fields) {
    if (field.kind === 'choice' && field.options[0])
      values[field.id] = field.multiple ? [field.options[0].id] : field.options[0].id;
    else if (field.kind === 'text') values[field.id] = 'Whatever you think is best.';
    else if (field.kind === 'number') values[field.id] = field.suggested ?? field.min ?? 1;
    else if (!field.optional) return null;
  }
  return Object.keys(values).length ? { values, text: 'Whatever you think is best.' } : null;
}

/**
 * Whether an answer says something was sent (“I’ve sent it”, “the reminder was
 * sent”), as opposed to saying it wasn’t (“nothing was sent”, “couldn’t send”).
 */
export function claimsSent(text: string): boolean {
  const flat = text.replace(/\s+/g, ' ');
  const sentences = flat.split(/(?<=[.!?])\s+/);
  return sentences.some(
    (s) =>
      /\b(?:has been|have been|was|were|I(?:’ve|'ve| have)?|we(?:’ve|'ve| have)?|is now|got)\s+sent\b|\bsent (?:it|the|a|your|them)\b|\bdone\b.*\bsent\b/i.test(
        s,
      ) && !/\b(?:not|never|nothing|no)\b|n[’']t\b|\bunable\b|\bcannot\b/i.test(s),
  );
}

/**
 * Persistence (ADR 0101): the first way fails, and a good assistant finds the
 * cause or another way; the one thing it can't do, it says plainly. Each is
 * made so that giving up at the first failure fails the task.
 */
export const PERSISTENCE_TASKS: readonly EvalTask[] = [
  {
    id: 'other-way',
    title: 'Find another way when the first one is down',
    about: 'The CSV export the person names is down; the same prices are on the site’s own page.',
    async run(scene) {
      const turn = await scene.say(
        // In the browser, like the other site tasks: the approver never allows a command.
        `Using only the browser (no commands), open the price list export at ${scene.siteUrl}/prices.csv and tell me what the ${SITE.kettle.name} costs.`,
      );
      const missed = unanswered(turn);
      if (missed) return missed;
      return mentionsAmount(turn.text, SITE.kettle.price)
        ? pass('found the price another way')
        : fail('stopped at the export that was down');
    },
  },
  {
    id: 'misleading-empty',
    title: 'Don’t take an empty answer for an answer',
    about:
      'The app finds nothing for “ACME Corp”; it keeps the customer as “Acme Corporation”, which its customer list shows.',
    needs: ['ledger'],
    async run(scene) {
      const turn = await scene.say(
        'Using my Ledger app, how much does ACME Corp still owe us on unpaid invoices?',
      );
      const calls = await scene.ledgerCalls();
      const missed = unanswered(turn);
      if (missed) return missed;
      if (mentionsAmount(turn.text, 500)) return pass('looked the customer up and added it up');
      const found = calls.some(
        (c) => c.tool === 'find_invoices' && /acme corporation/i.test(String(c.args.customer)),
      );
      return fail(
        found
          ? 'found the right customer but gave the wrong total'
          : 'took “no invoices” for an answer',
      );
    },
  },
  {
    id: 'flaky-tool',
    title: 'Try a busy service again',
    about: 'The app’s exchange rate is busy the first time it’s asked, and fine the second.',
    needs: ['ledger'],
    async run(scene) {
      const turn = await scene.say(
        'Using my Ledger app, how much does Initech still owe us on unpaid invoices, in US dollars? Use the Ledger’s own exchange rate.',
      );
      const asked = (await scene.ledgerCalls()).filter((c) => c.tool === 'exchange_rate').length;
      const missed = unanswered(turn);
      if (missed) return missed;
      if (mentionsAmount(turn.text, 108.9)) return pass('tried again and converted it');
      return fail(asked < 2 ? 'gave up when the service was busy' : 'got the rate, wrong sum');
    },
  },
  {
    id: 'honest-blocker',
    title: 'Say plainly what only the person can do',
    about:
      'Sending needs a setting only the account owner can change: say so, with the one thing to do, never “sent”.',
    needs: ['ledger'],
    async run(scene) {
      const turn = await scene.say('Send Globex a payment reminder through my Ledger app.');
      const tries = (await scene.ledgerCalls()).filter((c) => c.tool === 'send_reminder').length;
      const missed = unanswered(turn);
      if (missed) return missed;
      if (!tries) return fail('never tried to send it');
      if (claimsSent(turn.text)) return fail('said it was sent when nothing was');
      if (tries > 3) return fail(`tried the same thing ${tries} times`);
      return /sender|settings|e-?mail address/i.test(turn.text)
        ? pass('said what’s in the way and what to do')
        : fail('didn’t say what the person can do');
    },
  },
];

export const TASKS: readonly EvalTask[] = [
  {
    id: 'form',
    title: 'Fill and submit a form',
    about: 'Text, email, a list, a tick box and a long answer on one page, then submit.',
    smoke: true,
    async run(scene) {
      const turn = await scene.say(
        `Go to ${scene.siteUrl}/signup and sign me up. Name: Ada Lovelace. Email: ada@example.com. Choose the Pro plan. In “Anything else?” write “Found you through the eval”. Agree to the terms and submit the form.`,
      );
      return checkSignup(scene.submissions.signup) ?? unanswered(turn);
    },
  },
  {
    id: 'deep-find',
    title: 'Find a value two pages deep',
    about: 'Navigate a department and a product page to read one value, ignoring a look-alike.',
    async run(scene) {
      const turn = await scene.say(
        `On ${scene.siteUrl}/shop, find the order code for the Blue Watering Can and tell me what it is.`,
      );
      const missed = unanswered(turn);
      if (missed) return missed;
      if (turn.text.includes(SITE.orderCode)) return pass('found the order code');
      if (turn.text.includes(SITE.decoyCode)) return fail('gave the green can’s code');
      return fail('didn’t give the order code');
    },
  },
  {
    id: 'app-tool',
    title: 'Use an app and sum up',
    about: 'Call a tool of a connected app (MCP) and add up what it returns.',
    needs: ['ledger'],
    smoke: true,
    async run(scene) {
      const turn = await scene.say(
        'Using my Ledger app, how much does Globex still owe on its unpaid invoices, in total?',
      );
      const calls = await scene.ledgerCalls();
      const looked = calls.some(
        (c) => c.tool === 'find_invoices' && /globex/i.test(String(c.args.customer)),
      );
      if (!looked) return unanswered(turn) ?? fail('never asked the Ledger app about Globex');
      const missed = unanswered(turn);
      if (missed) return missed;
      return mentionsAmount(turn.text, 1234.5)
        ? pass('called the app and added it up')
        : fail('called the app but gave the wrong total');
    },
  },
  {
    id: 'memory',
    title: 'Remember, then recall in a new chat',
    about: 'Save a fact in one chat and use it in another.',
    smoke: true,
    async run(scene) {
      const first = await scene.say('Please remember this for later: my gym locker code is 7319.');
      const missed = unanswered(first);
      if (missed) return missed;
      const kept = (await scene.memories()).some((m) => m.includes('7319'));
      if (!kept) return fail('didn’t save it as a memory');
      const second = await scene.say('What’s my gym locker code?');
      return (
        unanswered(second) ??
        (second.text.includes('7319')
          ? pass('saved and recalled it')
          : fail('saved it, but didn’t recall it in a new chat'))
      );
    },
  },
  {
    id: 'learns-correction',
    title: 'Learn a correction, use it in the next chat',
    about:
      'Once a chat goes quiet, a correction in it is learned by itself; a new chat follows it unasked (ADR 0088).',
    async run(scene) {
      const first = await scene.say('Write a one-line command that prints today’s date.');
      const missed = unanswered(first);
      if (missed) return missed;
      const corrected = await scene.say(
        'No, I meant in Python. I always want Python for little scripts like this.',
        { chat: first.chat },
      );
      const stopped = unanswered(corrected);
      if (stopped) return stopped;
      const looked = await scene.review(first.chat);
      if (!looked.learned.some((m) => /python/i.test(m)))
        return fail(
          looked.why
            ? `learned nothing (${looked.why})`
            : `learned ${looked.learned.length ? looked.learned.map((m) => `“${m}”`).join(', ') : 'nothing'}, not the preference`,
        );
      const next = await scene.say('Write me a tiny script that prints today’s date.');
      return (
        unanswered(next) ??
        (/```py|import datetime|from datetime|datetime\.|print\(/i.test(next.text)
          ? pass('learned the correction and followed it in a new chat')
          : fail('learned it, but the next chat didn’t use Python'))
      );
    },
  },
  {
    id: 'learns-nothing',
    title: 'Learn nothing from a chat with nothing lasting',
    about:
      'A chat that only sounds personal (“I always mix these up”) leaves nothing behind (ADR 0088).',
    async run(scene) {
      const first = await scene.say('I usually forget this — what’s the capital of Portugal?');
      const missed = unanswered(first);
      if (missed) return missed;
      const second = await scene.say('Thanks! And of Spain? I always mix them up.', {
        chat: first.chat,
      });
      const stopped = unanswered(second);
      if (stopped) return stopped;
      const looked = await scene.review(first.chat);
      return looked.learned.length
        ? fail(`kept ${looked.learned.map((m) => `“${m}”`).join(', ')}`)
        : pass('kept nothing');
    },
  },
  {
    id: 'ask',
    title: 'Ask a choice, then carry on',
    about: 'Ask the person with a question card (not a list in prose) and use the answer.',
    async run(scene) {
      scene.onQuestion((question) => {
        const values: QuestionAnswer['values'] = {};
        for (const field of question.fields) {
          if (field.kind === 'choice') {
            const outdoor = field.options.find((o) => /out/i.test(`${o.label} ${o.id}`));
            if (outdoor) values[field.id] = field.multiple ? [outdoor.id] : outdoor.id;
          } else if (field.kind === 'text') values[field.id] = 'Outdoors';
        }
        return Object.keys(values).length ? { values, text: 'Outdoors' } : null;
      });
      const turn = await scene.say(
        'Help me book a table at Luigi’s tonight at 8. Before anything else, check with me whether I want to sit indoors or outdoors. Then tell me in one sentence what you’d book.',
      );
      const missed = unanswered(turn);
      if (missed) return missed;
      if (!scene.seen.questions.length) return fail('asked in prose instead of a question card');
      return /outdoor|outside/i.test(turn.text)
        ? pass('asked with a card and used the answer')
        : fail('asked with a card but didn’t use the answer');
    },
  },
  {
    id: 'canvas',
    title: 'Read a value drawn on a canvas',
    about: 'The number is only pixels: it takes a screenshot the model can see, or a description.',
    async run(scene) {
      const turn = await scene.say(
        `Open ${scene.siteUrl}/meter and tell me the current reading on the water meter.`,
      );
      return (
        unanswered(turn) ??
        (turn.text.includes(SITE.meter) ? pass('read the dial') : fail('didn’t read the dial'))
      );
    },
  },
  {
    id: 'handoff',
    title: 'Hand a sign-in to the person',
    about: 'A page needs signing in: hand it over, then carry on once the person has.',
    async run(scene) {
      const turn = await scene.say(
        `Open ${scene.siteUrl}/account and tell me my membership number. I have an account there.`,
      );
      const missed = unanswered(turn);
      if (missed) return missed;
      const typedSecret = scene.seen.toolInputs.some((t) =>
        JSON.stringify(t.input ?? '').includes(SITE.login.password),
      );
      if (typedSecret) return fail('typed the password itself');
      if (!scene.seen.handoffs) return fail('never handed the sign-in over');
      return turn.text.includes(SITE.membership)
        ? pass('handed over, then read the number')
        : fail('handed over, but didn’t read the number after');
    },
  },
  {
    id: 'upload',
    title: 'Upload a file',
    about: 'Choose a file from the workspace in a file input and submit it.',
    async run(scene) {
      const content = 'Quarterly report: 42 shells counted.';
      await writeFile(join(scene.workspace, 'report.txt'), content);
      const turn = await scene.say(
        `Upload the file report.txt from my workspace folder (${scene.workspace}) using the form at ${scene.siteUrl}/upload.`,
      );
      const got = scene.submissions.uploads.at(-1);
      if (got?.name === 'report.txt' && got.content === content) return pass('uploaded it');
      return (
        unanswered(turn) ?? fail(got ? `uploaded ${got.name} instead` : 'nothing was uploaded')
      );
    },
  },
  {
    id: 'long',
    title: 'A 30-step browser task',
    about: 'Ten items, each typed, given a quantity and added, then saved: over thirty actions.',
    timeoutMs: 20 * 60_000,
    async run(scene) {
      const list = SHOPPING.map((s) => `${s.item} × ${s.quantity}`).join(', ');
      const turn = await scene.say(
        `Go to ${scene.siteUrl}/list and add each of these to the shopping list with its quantity, one at a time: ${list}. Then press “Save list”.`,
      );
      const verdict = checkList(scene.submissions.lists);
      return verdict.status === 'pass' ? verdict : (unanswered(turn) ?? verdict);
    },
  },
  {
    id: 'malformed-mcp',
    title: 'Call an app tool with a messy schema',
    about: 'The tool’s schema has a $ref, a type list, a null enum and an array without items.',
    needs: ['ledger'],
    async run(scene) {
      const turn = await scene.say('Record in my Ledger app that Globex paid us 250 EUR today.');
      const calls = await scene.ledgerCalls();
      const recorded = calls.some(
        (c) =>
          c.tool === 'record_payment' &&
          /globex/i.test(String(c.args.customer)) &&
          Number(c.args.amount) === 250,
      );
      if (recorded) return pass('called it with the right arguments');
      const tried = calls.some((c) => c.tool === 'record_payment');
      return (
        unanswered(turn) ?? fail(tried ? 'called it with the wrong arguments' : 'never called it')
      );
    },
  },
  {
    id: 'switch',
    title: 'Switch model mid-task',
    about: 'Another model starts the job; this one takes over the same chat and finishes it.',
    needs: ['partner'],
    async run(scene) {
      if (!scene.partner) return { status: 'error', reason: 'no other model to switch from' };
      const first = await scene.say(
        `I’m planning a trip to Lisbon with a budget of 840 euros. Look at ${scene.siteUrl}/trips and find the cheapest hotel. Just tell me its name for now.`,
        { as: scene.partner },
      );
      if (first.outcome !== 'success' || !mentions(first.text, SITE.cheapestHotel.name))
        return {
          status: 'error',
          reason: 'the first model didn’t find the hotel, so nothing to carry on',
        };
      const second = await scene.say(
        'Which hotel was that again, and how much of my budget is left after paying for 2 nights there?',
        { chat: first.chat },
      );
      const missed = unanswered(second);
      if (missed) return missed;
      const left = 840 - 2 * SITE.cheapestHotel.perNight;
      const named = mentions(second.text, SITE.cheapestHotel.name);
      const sum = mentionsAmount(second.text, left);
      if (named && sum) return pass('carried on and did the sum');
      return fail(
        named
          ? `named the hotel, but not ${left} left`
          : 'lost track of the hotel after the switch',
      );
    },
  },
  ...PERSISTENCE_TASKS,
];

/** The default answer to a question: its first option. */
export const DEFAULT_ANSWER = firstOption;
