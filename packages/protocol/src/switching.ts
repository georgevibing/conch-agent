/**
 * Switching models when asked (ADR 0132). The person says "use Opus 5.5",
 * "switch to the cheaper model", "try this with GPT", "use my Claude plan",
 * "go back to Codex"; this reads those words against what's connected and
 * says which model they mean, a few that could be meant, or that nothing
 * connected fits (and which provider would). Pure, so the gateway's tool, the
 * web's `/model` and the chat apps' `/model` all read words the same way.
 */
import { z } from 'zod';

import { EngineId } from './common';
import type { ModelCatalog } from './engine';
import type { Billing } from './routines';
import { foldText } from './search';

/** How strong a model is, read from its name: 3 the strongest, 1 the quick ones. */
export type ModelTier = 1 | 2 | 3;

/** One model that's connected now, as switching sees it. */
export interface SwitchCandidate {
  engine: EngineId;
  /** Its provider's name: "Claude Code". */
  provider: string;
  /** The id the provider takes. */
  model: string;
  /** Its name, as the picker shows it: "Opus 5.5". */
  label: string;
  /** How it's paid for: a plan, per use (`metered`), or nothing (this computer). */
  billing?: Billing;
  /** The plan or account in words: "Claude Max". */
  account?: string;
  /** Runs on this computer. */
  local?: boolean;
  /** Can only chat: no apps, files or browser (ADR 0050). */
  chatOnly?: boolean;
  /** About what a typical reply costs, when it's paid per use and Conch knows its price. */
  perReplyUsd?: number;
  tier: ModelTier;
  /** The provider's own default: what a chat that names none answers with. */
  lead?: boolean;
}

/** Which model a chat answers with: a provider, and one of its models (none: its default). */
export interface ModelRef {
  engine: EngineId;
  model?: string | undefined;
}

/** Families of models, and who would serve one that isn't connected. */
interface Family {
  id: string;
  /** Matches a model's id or name. */
  test: RegExp;
  /** Words people use for the family: added to every model in it. */
  words: readonly string[];
  /** The provider to offer: on a plan, with a key, or on this computer. */
  connect: { plan?: EngineId; key?: EngineId; local?: EngineId };
}

const FAMILIES: readonly Family[] = [
  {
    id: 'claude',
    test: /claude|opus|sonnet|haiku|fable|mythos|anthropic/,
    words: ['claude', 'anthropic'],
    connect: { plan: 'claude-code', key: 'anthropic-api' },
  },
  {
    id: 'gpt',
    test: /\bgpt|chatgpt|codex|openai|\bo[134](?:\b|-)/,
    words: ['gpt', 'openai', 'chatgpt'],
    connect: { plan: 'codex-agent', key: 'openai' },
  },
  {
    id: 'gemini',
    test: /gemini|gemma/,
    words: ['gemini', 'google'],
    connect: { plan: 'gemini-cli', key: 'gemini' },
  },
  { id: 'grok', test: /grok|xai/, words: ['grok', 'xai'], connect: { plan: 'grok', key: 'xai' } },
  { id: 'deepseek', test: /deepseek/, words: ['deepseek'], connect: { key: 'deepseek' } },
  {
    id: 'mistral',
    test: /mistral|codestral|devstral|magistral|ministral/,
    words: ['mistral'],
    connect: { key: 'mistral' },
  },
  { id: 'qwen', test: /qwen|qwq/, words: ['qwen'], connect: { key: 'qwen', local: 'ollama' } },
  { id: 'kimi', test: /kimi|moonshot/, words: ['kimi', 'moonshot'], connect: { key: 'moonshot' } },
  { id: 'glm', test: /\bglm|zhipu/, words: ['glm', 'zhipu'], connect: { key: 'zai' } },
  { id: 'minimax', test: /minimax/, words: ['minimax'], connect: { key: 'minimax' } },
  { id: 'llama', test: /llama/, words: ['llama', 'meta'], connect: { local: 'ollama' } },
];

/** Every word a family adds: such a word names a family, never one model. */
const FAMILY_WORDS = new Set(FAMILIES.flatMap((f) => f.words));

/** More names for a provider than its label has. */
const PROVIDER_WORDS: Partial<Record<string, readonly string[]>> = {
  'claude-code': ['claude', 'anthropic'],
  'codex-agent': ['codex', 'chatgpt', 'openai'],
  'codex-cli': ['codex', 'chatgpt', 'openai'],
  copilot: ['github', 'copilot'],
  'gemini-cli': ['gemini', 'google'],
  grok: ['grok', 'xai'],
  'anthropic-api': ['anthropic', 'claude'],
  openai: ['openai', 'gpt'],
  gemini: ['google', 'gemini'],
  xai: ['grok', 'xai'],
  ollama: ['ollama', 'local'],
  'lm-studio': ['lmstudio', 'local'],
};

/** Words that say what to do, not which model. */
const FILLER = new Set(
  `use using switch switching change changing move swap try trying go let lets please can could would will you your
  u i id im want wanna like to the a an this that these it its with on in for from model models one llm instead now
  rest of chat conversation me my mine our answer answering run running do redo again same thing over
  and or but just some something any put make get give be is are as at by via thru through ok okay so then
  pick choose select set rather prefer`.split(/\s+/),
);

const BACK = new Set(['back', 'previous', 'before', 'earlier', 'original', 'revert', 'undo']);
const STRONGER = new Set([
  'stronger',
  'strongest',
  'smarter',
  'smartest',
  'better',
  'best',
  'bigger',
  'biggest',
  'powerful',
  'capable',
  'top',
  'frontier',
  'flagship',
  'heavier',
  'premium',
  'harder',
  'cleverer',
  'cleverest',
]);
const CHEAPER = new Set([
  'cheaper',
  'cheapest',
  'cheap',
  'budget',
  'inexpensive',
  'economical',
  'less',
  'lower',
  'costs',
]);
const FASTER = new Set([
  'faster',
  'fastest',
  'quicker',
  'quickest',
  'quick',
  'fast',
  'lighter',
  'lightest',
  'smaller',
  'smallest',
  'speedy',
  'snappier',
]);
const LOCAL = new Set(['local', 'locally', 'offline', 'computer', 'machine', 'device', 'laptop']);
const PLAN = new Set(['plan', 'subscription', 'sub', 'included', 'membership']);
const KEY = new Set(['key', 'api', 'metered', 'payg']);

/** Words, the way both sides are read: lower case, accents off, versions kept whole ("5.5"). */
export function switchWords(text: string): string[] {
  return (
    foldText(text)
      // "claude-opus-5-5" is version 5.5; "claude-opus-4-20250514" stays a date.
      .replace(/(\d)-(?=\d(?!\d))/g, '$1.')
      // "opus5.5", "gpt5": the name and the version apart.
      .replace(/([a-z])(\d)/g, '$1 $2')
      .replace(/(\d)\.(?!\d)/g, '$1 ')
      .replace(/(?<!\d)\./g, ' ')
      .split(/[^a-z0-9.]+/)
      .filter(Boolean)
  );
}

/** How strong a model is, read from its id and name. Rough on purpose: only ranks connected ones. */
export function modelTier(model: { id: string; label: string; description?: string }): ModelTier {
  const name = foldText(`${model.id} ${model.label}`);
  if (
    /haiku|nano|\bmini\b|-mini|lite|\btiny|\bsmall|flash-lite|\b[1-9](?:\.\d)?b\b|-fast|\bfast\b/.test(
      name,
    )
  )
    return 1;
  if (
    /opus|fable|mythos|\bpro\b|-pro|ultra|\bo3\b|grok-4(?![.-]?fast)|reasoner|\bmax\b|large|405b|235b|kimi-k2/.test(
      name,
    )
  )
    return 3;
  if (/sonnet|flash|medium|\bgpt-?5/.test(name)) return name.includes('gpt') ? 3 : 2;
  const about = foldText(model.description ?? '');
  if (/most capable|smartest|strongest|frontier|flagship|hardest/.test(about)) return 3;
  if (/quickest|fastest|cheapest|lightweight|simple questions/.test(about)) return 1;
  return 2;
}

/** Strip the picker's "(recommended)" from a name. */
const nameOf = (label: string) => label.replace(/\s*\(recommended\)\s*$/i, '').trim();

/**
 * Every model a chat could switch to now, from the model catalog (ADR 0012).
 * A provider's "Default" entry isn't a model of its own: the one it stands
 * for is marked `lead` instead. `price` says what a reply costs, by model id.
 */
export function switchCandidates(
  catalog: Pick<ModelCatalog, 'providers'>,
  price?: (model: string) => number | undefined,
): SwitchCandidate[] {
  const out: SwitchCandidate[] = [];
  for (const provider of catalog.providers) {
    if (provider.message || !provider.models.length) continue;
    const named = provider.models.filter((m) => m.id !== 'default');
    const models = named.length ? named : provider.models;
    const fallback = provider.models.find((m) => m.id === 'default');
    // "Use the default model (currently Opus 5.5)": that one leads.
    const lead =
      (fallback &&
        models.find((m) => foldText(fallback.description).includes(foldText(nameOf(m.label))))) ??
      models[0];
    const billing = provider.local ? 'free' : provider.billing;
    for (const m of models) {
      const usd = billing === 'metered' ? price?.(m.id) : undefined;
      out.push({
        engine: provider.engine,
        provider: provider.label,
        model: m.id,
        label: nameOf(m.label),
        ...(billing && { billing }),
        ...(provider.account && { account: provider.account }),
        ...(provider.local && { local: true }),
        ...((provider.tools?.host === false || m.tools === false) && { chatOnly: true }),
        ...(usd !== undefined && { perReplyUsd: usd }),
        tier: modelTier(m),
        ...(m === lead && { lead: true }),
      });
    }
  }
  return out;
}

/** The candidate a chat answers with now: its model, or its provider's default. */
export function candidateOf(
  candidates: readonly SwitchCandidate[],
  ref: ModelRef | undefined,
): SwitchCandidate | undefined {
  if (!ref) return undefined;
  const own = candidates.filter((c) => c.engine === ref.engine);
  if (!ref.model || ref.model === 'default') return own.find((c) => c.lead) ?? own[0];
  return own.find((c) => c.model === ref.model);
}

/** What the words asked for, besides a name. */
interface Wish {
  names: string[];
  back: boolean;
  direction?: 'stronger' | 'cheaper' | 'faster';
  local: boolean;
  billing?: 'plan' | 'metered' | 'free';
}

function wishOf(request: string): Wish {
  const words = switchWords(request);
  const wish: Wish = { names: [], back: false, local: false };
  const text = ` ${words.join(' ')} `;
  if (/ (?:pay per use|pay as you go|my own key|api key|per token) /.test(text))
    wish.billing = 'metered';
  if (/ (?:this computer|this machine|on device|on my mac|on my pc) /.test(text)) wish.local = true;
  if (/ (?:more|most) (?:powerful|capable|intelligent|advanced) /.test(text))
    wish.direction = 'stronger';
  if (/ (?:less expensive|costs? less|save money|lower cost) /.test(text))
    wish.direction = 'cheaper';
  for (const word of words) {
    if (BACK.has(word)) wish.back = true;
    else if (STRONGER.has(word)) wish.direction ??= 'stronger';
    else if (CHEAPER.has(word)) wish.direction ??= 'cheaper';
    else if (FASTER.has(word)) wish.direction ??= 'faster';
    else if (LOCAL.has(word)) wish.local = true;
    else if (PLAN.has(word)) wish.billing ??= 'plan';
    else if (KEY.has(word)) wish.billing ??= 'metered';
    else if (word === 'free') wish.billing ??= 'free';
    else if (
      word === 'pay' ||
      word === 'per' ||
      word === 'own' ||
      word === 'more' ||
      word === 'most'
    )
      continue;
    else if (!FILLER.has(word)) wish.names.push(word);
  }
  return wish;
}

interface Scored {
  candidate: SwitchCandidate;
  score: number;
  /** A word matched the model itself, not only its provider or family. */
  specific: boolean;
}

/** Each word a candidate is known by, and where it came from. */
function haystack(c: SwitchCandidate) {
  const model = new Set([...switchWords(c.label), ...switchWords(c.model)]);
  const provider = new Set([...switchWords(c.provider), ...(PROVIDER_WORDS[c.engine] ?? [])]);
  const text = foldText(`${c.model} ${c.label}`);
  const family = new Set(FAMILIES.filter((f) => f.test.test(text)).flatMap((f) => f.words));
  return { model, provider, family };
}

function wordMatch(word: string, have: Set<string>): number {
  if (have.has(word)) return 3;
  for (const w of have) {
    // "5" means 5.5 too, less surely; "son" doesn't mean anything yet.
    if (/^\d/.test(word) ? w.startsWith(`${word}.`) : word.length >= 3 && w.startsWith(word))
      return 2;
  }
  return 0;
}

function score(c: SwitchCandidate, names: readonly string[]): Scored | undefined {
  const { model, provider, family } = haystack(c);
  let total = 0;
  let specific = false;
  let byProvider = false;
  for (const word of names) {
    const familyWord = FAMILY_WORDS.has(word);
    // A family's own word in a model's id ("claude-opus") names the family, not the model.
    const inModel = familyWord ? 0 : wordMatch(word, model);
    const inProvider = wordMatch(word, provider);
    const inFamily = family.has(word) || (familyWord && wordMatch(word, model)) ? 1.5 : 0;
    const best = Math.max(inModel, inProvider, inFamily);
    if (!best) return undefined;
    if (inModel && inModel >= inProvider) specific = true;
    if (inProvider === best) byProvider = true;
    total += best;
  }
  const used = (w: string) => names.some((u) => w === u || w.startsWith(u));
  // "GPT 5" is GPT-5.5 sooner than GPT-5.5 mini: words in its name nobody asked for count against it.
  const extra = [...model].filter((w) => !used(w) && !FAMILY_WORDS.has(w)).length;
  // "Codex" is Codex sooner than Codex CLI, once a provider was named at all.
  const providerExtra = byProvider ? switchWords(c.provider).filter((w) => !used(w)).length : 0;
  return { candidate: c, score: total - extra * 0.3 - providerExtra * 0.1, specific };
}

/** A model's own name, without its family or company: "Claude Opus 5.5" and "Opus 5.5" are one. */
function core(c: SwitchCandidate): string {
  return switchWords(c.label.replace(/^[^:]*:\s*/, ''))
    .filter((w) => !FAMILY_WORDS.has(w))
    .join(' ');
}

const sameRef = (a: ModelRef | undefined, c: SwitchCandidate | undefined) =>
  Boolean(a && c && a.engine === c.engine && (a.model ?? c.model) === c.model);

/** What a reply costs, for "cheaper": a plan and this computer cost nothing more. */
const costOf = (c: SwitchCandidate) => (c.billing === 'metered' ? (c.perReplyUsd ?? 0.05) : 0);

/** Plans first, then this computer, then per use: never spend when there's no need. */
const billingRank = (c: SwitchCandidate) =>
  c.billing === 'plan'
    ? 0
    : c.billing === 'free' || c.local
      ? 1
      : c.billing === 'metered'
        ? 2
        : 1.5;

export type SwitchResolution =
  /** That one. `named`: the person named it (so paying for it is their choice). */
  | { kind: 'one'; choice: SwitchCandidate; named: boolean; also?: SwitchCandidate[] }
  /** It's the one answering already. */
  | { kind: 'already'; choice: SwitchCandidate }
  /**
   * A few could be meant: offer them (ADR 0060's chips). `near`: the one asked
   * for isn't connected, these are the closest; `pays`: the best fit is paid
   * per use, which only the person chooses.
   */
  | { kind: 'some'; choices: SwitchCandidate[]; why: 'ambiguous' | 'near' | 'pays' }
  /** Nothing connected fits. `connect`: the provider that would, when Conch can tell. */
  | {
      kind: 'none';
      why: 'nothing' | 'no-stronger' | 'no-cheaper' | 'no-faster' | 'no-previous';
      connect?: EngineId;
    };

/** Up to three, best first. */
const MAX_CHOICES = 3;

/** Who would serve a family nothing connected serves: on a plan unless a key was asked for. */
function connectFor(request: string, wish: Wish): EngineId | undefined {
  const text = foldText(request);
  const family = FAMILIES.find((f) => f.test.test(text));
  if (!family) return wish.local ? 'ollama' : undefined;
  const { plan, key, local } = family.connect;
  if (wish.local) return local ?? 'ollama';
  if (wish.billing === 'metered') return key ?? plan;
  return plan ?? key ?? local;
}

/**
 * Which connected model the person's words mean. `current` is what answers
 * now; `previous` what answered before the last switch ("go back").
 */
export function resolveSwitch(
  candidates: readonly SwitchCandidate[],
  request: string,
  context: { current?: ModelRef | undefined; previous?: ModelRef | undefined } = {},
): SwitchResolution {
  const wish = wishOf(request);
  const current = candidateOf(candidates, context.current);
  const previous = candidateOf(candidates, context.previous);
  const apps = current ? !current.chatOnly : true;
  const none = (): SwitchResolution => {
    const connect = connectFor(request, wish);
    return { kind: 'none', why: 'nothing', ...(connect && { connect }) };
  };

  // Read the names first: every word must fit.
  let scored: Scored[];
  if (wish.names.length) {
    scored = candidates.flatMap((c) => score(c, wish.names) ?? []);
    if (!scored.length) {
      // "Opus 4.1" with only Opus 5.5 here: the closest, offered, never switched to.
      const loose = wish.names.filter((n) => !/^\d/.test(n));
      const near =
        loose.length && loose.length < wish.names.length
          ? candidates.flatMap((c) => score(c, loose) ?? [])
          : [];
      if (!near.length) return none();
      return {
        kind: 'some',
        why: 'near',
        choices: leadsOf(near, current, apps, false).slice(0, MAX_CHOICES),
      };
    }
  } else scored = candidates.map((candidate) => ({ candidate, score: 0, specific: false }));

  // What it's paid with, and where it runs.
  if (wish.local) scored = scored.filter((s) => s.candidate.local);
  if (wish.billing === 'free')
    scored = scored.filter(
      (s) => s.candidate.billing === 'free' || s.candidate.local || /free/.test(s.candidate.model),
    );
  else if (wish.billing) scored = scored.filter((s) => s.candidate.billing === wish.billing);
  if (!scored.length) return none();

  // "Go back": the one before, when it fits the rest of what was said.
  if (wish.back && !wish.direction) {
    if (previous && scored.some((s) => s.candidate === previous))
      return sameRef(context.current, previous)
        ? { kind: 'already', choice: previous }
        : { kind: 'one', choice: previous, named: true };
    if (!wish.names.length) return { kind: 'none', why: 'no-previous' };
  }

  if (wish.direction)
    return relative(scored, wish.direction, current, apps, Boolean(wish.names.length));

  // Names: the best fits, and among them what the person most likely meant.
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score >= top - 0.25);
  if (current && wish.names.length && best.some((s) => s.candidate === current))
    return { kind: 'already', choice: current };
  const specific = best.some((s) => s.specific);
  const leads = leadsOf(specific ? best.filter((s) => s.specific) : best, current, apps, !specific);
  const [first, second] = leads;
  if (!first) return none();
  if (sameRef(context.current, first)) return { kind: 'already', choice: first };
  if (!second) return { kind: 'one', choice: first, named: true };
  const also = { also: leads.slice(1, MAX_CHOICES) };
  // The same model several ways (a plan and a key): the chat's own provider, else the plan.
  const sameModel = !specific || leads.every((c) => core(c) === core(first));
  if (sameModel && (first.engine === current?.engine || billingRank(first) < billingRank(second)))
    return { kind: 'one', choice: first, named: true, ...also };
  // Two that fit a family ("Claude") as well: the one whose provider's whole name was said.
  if (!specific) {
    const said = (c: SwitchCandidate) =>
      switchWords(c.provider).every((w) => wish.names.includes(w)) ? 1 : 0;
    if (said(first) > said(second)) return { kind: 'one', choice: first, named: true, ...also };
  }
  return { kind: 'some', why: 'ambiguous', choices: leads.slice(0, MAX_CHOICES) };
}

/**
 * The fits in the order to offer them: models that can use apps first when
 * the chat's can, the chat's own provider, plans before keys, the provider's
 * default. `perProvider`: only a provider or a family was named, so each
 * provider stands for itself with its default.
 */
function leadsOf(
  scored: readonly Scored[],
  current: SwitchCandidate | undefined,
  apps: boolean,
  perProvider: boolean,
): SwitchCandidate[] {
  const order = (a: SwitchCandidate, b: SwitchCandidate) =>
    Number(Boolean(apps && a.chatOnly)) - Number(Boolean(apps && b.chatOnly)) ||
    Number(b.engine === current?.engine) - Number(a.engine === current?.engine) ||
    billingRank(a) - billingRank(b) ||
    Number(Boolean(b.lead)) - Number(Boolean(a.lead));
  const ordered = scored.map((s) => s.candidate).sort(order);
  if (!perProvider) return ordered;
  const seen = new Set<string>();
  return ordered.filter((c) => !seen.has(c.engine) && Boolean(seen.add(c.engine)));
}

/** "Stronger", "cheaper", "faster": the best of the connected ones that are, without spending on a guess. */
function relative(
  scored: readonly Scored[],
  direction: 'stronger' | 'cheaper' | 'faster',
  current: SwitchCandidate | undefined,
  apps: boolean,
  named: boolean,
): SwitchResolution {
  const here = current ?? scored[0]?.candidate;
  if (!here) return { kind: 'none', why: 'nothing' };
  const fits = scored
    .map((s) => s.candidate)
    .filter((c) => c !== here && !(c.engine === here.engine && c.model === here.model))
    .filter((c) =>
      direction === 'stronger'
        ? c.tier > here.tier
        : direction === 'faster'
          ? c.tier < here.tier
          : costOf(c) < costOf(here) || (costOf(c) === costOf(here) && c.tier < here.tier),
    );
  if (!fits.length)
    return {
      kind: 'none',
      why:
        direction === 'stronger'
          ? 'no-stronger'
          : direction === 'cheaper'
            ? 'no-cheaper'
            : 'no-faster',
    };
  const paying = (c: SwitchCandidate) => c.billing === 'metered' && here.billing !== 'metered';
  const ranked = [...fits].sort(
    (a, b) =>
      Number(Boolean(apps && a.chatOnly)) - Number(Boolean(apps && b.chatOnly)) ||
      Number(paying(a)) - Number(paying(b)) ||
      // The best of those that fit: the strongest of the cheaper or quicker ones.
      b.tier - a.tier ||
      Number(b.engine === here.engine) - Number(a.engine === here.engine) ||
      costOf(a) - costOf(b) ||
      Number(Boolean(b.lead)) - Number(Boolean(a.lead)),
  );
  const first = ranked[0];
  if (!first) return { kind: 'none', why: 'nothing' };
  // Starting to pay is the person's choice, never a guess at "stronger".
  if (paying(first) && !named)
    return { kind: 'some', why: 'pays', choices: ranked.slice(0, MAX_CHOICES) };
  return { kind: 'one', choice: first, named };
}

/** Where a model answers from, in the chat's words: "your Claude Max plan", "OpenRouter, pay per use". */
export function whereWords(
  c: Pick<SwitchCandidate, 'billing' | 'account' | 'provider' | 'local' | 'perReplyUsd'>,
): string {
  if (c.local) return 'this computer';
  if (c.billing === 'plan') {
    const plan = c.account?.trim() || c.provider;
    return /\bplan$/i.test(plan) ? `your ${plan}` : `your ${plan} plan`;
  }
  if (c.billing === 'metered')
    return c.perReplyUsd !== undefined
      ? `${c.provider}, about ${usd(c.perReplyUsd)} a reply`
      : `${c.provider}, pay per use`;
  return c.provider;
}

function usd(value: number): string {
  if (value < 0.01) return 'under $0.01';
  return `$${value.toFixed(2)}`;
}

/** The line the chat shows: "Switched to Opus 5.5 on your Claude Max plan". */
export function switchedLine(c: SwitchCandidate, back = false): string {
  const where = whereWords(c);
  return `${back ? 'Back to' : 'Switched to'} ${c.label} on ${where}`;
}

/** What a chip says, and sends: words that mean exactly that one model. */
export function choiceText(c: SwitchCandidate): string {
  return `Switch to ${c.label} on ${c.provider}`.slice(0, 120);
}

/** Its strength in a word, for the assistant's list. */
const TIER_WORDS: Record<ModelTier, string> = { 3: 'strongest', 2: 'everyday', 1: 'quick' };

/**
 * The few lines that tell the assistant what it can switch to (ADR 0132),
 * one per provider, within `budget` characters. Always in the catalog's own
 * order, so the text stays the same while nothing changes (ADR 0085).
 */
export function switchList(
  candidates: readonly SwitchCandidate[],
  current: ModelRef | undefined,
  budget = 1400,
): string[] {
  const here = candidateOf(candidates, current);
  const engines = [...new Set(candidates.map((c) => c.engine))];
  const lines: string[] = [];
  let used = 0;
  let left = 0;
  for (const engine of engines) {
    const own = candidates.filter((c) => c.engine === engine);
    const first = own[0];
    if (!first) continue;
    const head = `- ${first.provider} (${whereWords({ ...first, perReplyUsd: undefined })})`;
    const shown =
      own.length > 8
        ? `${own.length} models, ask by name; e.g. ${own
            .slice(0, 3)
            .map((c) => c.label)
            .join(', ')}`
        : own
            .map((c) => {
              const tags = [
                TIER_WORDS[c.tier],
                c.chatOnly && 'chat only',
                c === here && 'answering now',
              ].filter(Boolean);
              return `${c.label} [${tags.join(', ')}]`;
            })
            .join(', ');
    const line = `${head}: ${shown}`;
    if (used + line.length > budget) {
      left++;
      continue;
    }
    used += line.length + 1;
    lines.push(line);
  }
  if (left) lines.push(`- and ${left} more provider${left === 1 ? '' : 's'}: ask by name`);
  return lines;
}

/**
 * The 2–3 models a request could mean, offered as chips (ADR 0132): what each
 * chip sends, and the request to carry on with once one is chosen.
 */
export const SwitchChoice = z.object({
  engine: EngineId,
  model: z.string().min(1).max(200),
  /** The chip's words, exactly what it sends. */
  text: z.string().min(1).max(120),
});
export type SwitchChoice = z.infer<typeof SwitchChoice>;

/** Switch this chat's model, by the person (**Switch back** on the line). */
export const SwitchModelBody = z
  .object({ engine: EngineId, model: z.string().min(1).max(200).optional() })
  .strict();
export type SwitchModelBody = z.infer<typeof SwitchModelBody>;
