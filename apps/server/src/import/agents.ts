/**
 * Another app's agents as Conch's (ADR 0101, Come home): each OpenClaw agent
 * or Hermes profile becomes one of Conch's agents, with a name, a face, a
 * tone and instructions of its own. Everything here is worked out from the
 * files alone, the same way every time: no model reads them, so nothing in
 * them can talk its way into a different result.
 *
 * What came from the other app is untrusted. Its words are read like a
 * skill's (`scanText`) before anyone ticks them, invisible characters are
 * taken out, and anything shaped like a key or a password is taken out of
 * them before they're kept (the other app's own keys first, by value). A
 * picture is read only from inside its own folder (never a link, never from
 * the web), from its bytes, and kept without its metadata (`cleanPicture`).
 */
import {
  AGENT_AVATAR_PRESETS,
  AGENT_LIMITS,
  APP_COLORS,
  type AgentAvatarPreset,
  type AgentImageType,
  type AgentPresetAvatar,
  type AppColor,
  type EffortChoice,
  type Tone,
} from '@conch/protocol';

import { cleanPicture } from '../agents/picture';
import { secretIn } from '../memory/guard';
import { scrubSecrets } from '../search/past';
import { scanText, unsmuggle } from '../skills/scan';
import type { FoundAvatar, FoundIdentity } from './found';
import { readInside, str } from './read';

// ── How hard it thinks ──────────────────────────────────────────────────────

/** OpenClaw's `thinkingDefault` and Hermes's `reasoning_effort`, as Conch's effort. */
export function effortFrom(value: unknown): EffortChoice | undefined {
  const v = str(value)?.toLowerCase();
  switch (v) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return 'xhigh';
    case 'max':
    case 'ultra':
      return 'max';
    case 'adaptive':
    case 'auto':
      return 'auto';
    default:
      // `off`, `none`, or anything Conch doesn't know: the provider's own choice.
      return undefined;
  }
}

// ── Tone ────────────────────────────────────────────────────────────────────

/**
 * The words that say each tone. Counted where they stand on their own; one
 * just after "not" or "never" counts against it ("never formal").
 */
const TONE_WORDS: Record<Tone, RegExp[]> = {
  warm: [
    /\bwarm(?:th|ly)?\b/,
    /\bfriendly\b/,
    /\bkind(?:ly|ness)?\b/,
    /\bcaring\b/,
    /\bencourag\w*/,
    /\bempath\w*/,
    /\bcheerful\b/,
    /\bsupportive\b/,
    /\bgentle\b/,
  ],
  concise: [
    /\bconcise(?:ly)?\b/,
    /\bbrief(?:ly)?\b/,
    /\bterse\b/,
    /\bsuccinct\b/,
    /\bto the point\b/,
    /\bshort answers?\b/,
    /\bno fluff\b/,
    /\blead with the answer\b/,
    /\bfew(?:est)? words\b/,
    /\bcrisp\b/,
  ],
  playful: [
    /\bplayful\b/,
    /\bfun(?:ny)?\b/,
    /\bhumou?r\w*/,
    /\bwit(?:ty)?\b/,
    /\bcheeky\b/,
    /\bjok\w+/,
    /\bwhimsical\b/,
    /\bsilly\b/,
    /\bchaotic\b/,
    /\bpuns?\b/,
  ],
  precise: [
    /\bprecise(?:ly)?\b/,
    /\bprecision\b/,
    /\bexact(?:ly)?\b/,
    /\baccura\w+/,
    /\brigou?r\w*/,
    /\bmeticulous\b/,
    /\bthorough\b/,
    /\bcareful(?:ly)?\b/,
    /\bdetail(?:ed|s)?\b/,
    /\bdry\b/,
  ],
  calm: [
    /\bcalm(?:ly)?\b/,
    /\bpatien(?:t|ce)\b/,
    /\bsooth\w*/,
    /\bunhurried\b/,
    /\breassur\w+/,
    /\brelaxed\b/,
    /\bserene\b/,
    /\bnever in a hurry\b/,
    /\bsteady\b/,
  ],
  formal: [
    /\bformal(?:ly)?\b/,
    /\bprofessional(?:ly)?\b/,
    /\bpolite(?:ly)?\b/,
    /\bcourteous\b/,
    /\bpolished\b/,
    /\brespectful\b/,
  ],
  candid: [
    /\bcandid\b/,
    /\bblunt\b/,
    /\bhonest(?:y|ly)?\b/,
    /\bdirect\b/,
    /\bstraightforward\b/,
    /\bhave opinions\b/,
    /\bdisagree\b/,
    /\bpush back\b/,
    /\bnever flatter\b/,
    /\bnot a sycophant\b/,
    /\bno sycophan\w*/,
  ],
};
/** Ties go to the first here: Conch's own default first. */
const TONE_ORDER: Tone[] = ['warm', 'concise', 'precise', 'calm', 'candid', 'playful', 'formal'];

/**
 * The tone its words describe best, worked out the same way every time:
 * each tone's words counted (its own words about its manner count double),
 * a negated one counted against it. Nothing that says a tone: warm.
 */
export function toneOf(text: string, manner = ''): Tone {
  const score = (body: string, weight: number, into: Map<Tone, number>) => {
    const lower = body.toLowerCase();
    for (const tone of TONE_ORDER)
      for (const word of TONE_WORDS[tone]) {
        const flags = word.flags.includes('g') ? word.flags : `${word.flags}g`;
        for (const m of lower.matchAll(new RegExp(word.source, flags))) {
          const before = lower.slice(Math.max(0, m.index - 16), m.index);
          const negated = /\b(?:not|never|no|don['’]?t|avoid|without)\s+(?:\w+\s+)?$/.test(before);
          // "not a sycophant" is the candid tone's own words, not a negation of them.
          const own = /^(?:not|no)\b/.test(m[0]);
          into.set(tone, (into.get(tone) ?? 0) + (negated && !own ? -weight : weight));
        }
      }
  };
  const scores = new Map<Tone, number>();
  score(text, 1, scores);
  score(manner, 2, scores);
  let best: Tone = 'warm';
  let top = 0;
  for (const tone of TONE_ORDER) {
    const s = scores.get(tone) ?? 0;
    if (s > top) {
      best = tone;
      top = s;
    }
  }
  return best;
}

// ── The face ────────────────────────────────────────────────────────────────

/** An emoji, or the words about it, as one of Conch's pictures, in a colour that suits it. */
const FACES: { preset: AgentAvatarPreset; color: AppColor; emoji: string[]; words: RegExp }[] = [
  { preset: 'shell', color: 'pink', emoji: ['🐚'], words: /\b(?:shell|conch|snail)\b/ },
  {
    preset: 'pearl',
    color: 'slate',
    emoji: ['🦪', '⚪', '🫧', '💎'],
    words: /\b(?:pearl|oyster|gem)\b/,
  },
  {
    preset: 'wave',
    color: 'blue',
    emoji: ['🌊', '💧', '🐬', '🐳', '🐋', '🐟', '🐠'],
    words: /\b(?:wave|sea|ocean|water|dolphin|whale|fish)\b/,
  },
  {
    preset: 'coral',
    color: 'red',
    emoji: ['🪸', '🦞', '🦀', '🦐', '🐙'],
    words: /\b(?:coral|lobster|claw|crab|octopus|reef)\b/,
  },
  {
    preset: 'spark',
    color: 'amber',
    emoji: ['✨', '⚡', '💡', '🎇', '🎆'],
    words: /\b(?:spark|lightning|electric|idea)\b/,
  },
  {
    preset: 'leaf',
    color: 'green',
    emoji: ['🍃', '🌿', '🌱', '🍀', '🌳', '🌲', '🪴', '🦥'],
    words: /\b(?:leaf|plant|tree|garden|forest|sloth)\b/,
  },
  {
    preset: 'moon',
    color: 'indigo',
    emoji: ['🌙', '🌛', '🌜', '🌚', '🌝', '🌕', '🌑'],
    words: /\b(?:moon|night|lunar)\b/,
  },
  {
    preset: 'sun',
    color: 'yellow',
    emoji: ['☀️', '☀', '🌞', '🌅', '🌻'],
    words: /\b(?:sun|sunny|solar|dawn)\b/,
  },
  {
    preset: 'star',
    color: 'yellow',
    emoji: ['⭐', '🌟', '💫', '🌠'],
    words: /\b(?:star|stellar)\b/,
  },
  {
    preset: 'cloud',
    color: 'cyan',
    emoji: ['☁️', '☁', '⛅', '🌤️', '🌧️'],
    words: /\b(?:cloud|sky|weather)\b/,
  },
  {
    preset: 'flame',
    color: 'orange',
    emoji: ['🔥', '🐉', '🌶️'],
    words: /\b(?:flame|fire|dragon|phoenix)\b/,
  },
  {
    preset: 'feather',
    color: 'violet',
    emoji: ['🪶', '🕊️', '🐦', '🪽', '✍️', '📝', '🖋️'],
    words: /\b(?:feather|bird|quill|writer|poet)\b/,
  },
  {
    preset: 'compass',
    color: 'teal',
    emoji: ['🧭', '🗺️', '📊', '📈', '🧳', '✈️'],
    words: /\b(?:compass|map|guide|explorer|travel|navigator)\b/,
  },
  {
    preset: 'orbit',
    color: 'violet',
    emoji: ['🪐', '🚀', '🛰️', '🌌', '🔭', '⚛️'],
    words: /\b(?:orbit|planet|space|rocket|astronaut|cosmic)\b/,
  },
  {
    preset: 'owl',
    color: 'amber',
    emoji: ['🦉', '📚', '🎓', '🧠'],
    words: /\b(?:owl|wise|scholar|librarian|professor)\b/,
  },
  { preset: 'fox', color: 'orange', emoji: ['🦊'], words: /\b(?:fox|clever|sly)\b/ },
  {
    preset: 'cat',
    color: 'slate',
    emoji: ['🐱', '🐈', '😺', '😸', '🐈‍⬛', '🐯', '🦁'],
    words: /\b(?:cat|kitten|feline|tiger|lion)\b/,
  },
  {
    preset: 'bot',
    color: 'blue',
    emoji: ['🤖', '👾', '💻', '⚙️', '🛠️', '🦾'],
    words: /\b(?:bot|robot|android|machine|ai|computer)\b/,
  },
];

/** The first emoji in some words, if they start with one. */
export function firstEmoji(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const first = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text.trim())][0]
    ?.segment;
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : undefined;
}

/** A small, steady number from words (FNV-1a), to choose the same picture every time. */
function steady(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Its face as one of Conch's pictures: its emoji's, else the one its words
 * suggest (an owl, a robot), else one chosen from its name, the same every time.
 */
export function presetFor(
  emoji: string | undefined,
  words: string,
  seed: string,
): AgentPresetAvatar {
  const bare = emoji?.replace(/️/g, '');
  const byEmoji = bare
    ? FACES.find((f) => f.emoji.some((e) => e.replace(/️/g, '') === bare))
    : undefined;
  const lower = words.toLowerCase();
  const face = byEmoji ?? FACES.find((f) => f.words.test(lower));
  if (face) return { kind: 'preset', id: face.preset, color: face.color };
  const n = steady(seed);
  return {
    kind: 'preset',
    id: AGENT_AVATAR_PRESETS[n % AGENT_AVATAR_PRESETS.length] as AgentAvatarPreset,
    color: APP_COLORS[Math.floor(n / AGENT_AVATAR_PRESETS.length) % APP_COLORS.length] as AppColor,
  };
}

// ── Secrets ─────────────────────────────────────────────────────────────────

/**
 * Text with every secret taken out: the other app's own keys by value (it
 * knows them), then anything shaped like a key or a password. A secret never
 * becomes part of an agent's instructions, which reach every turn's prompt.
 */
export function withoutSecrets(
  text: string,
  known: readonly string[] = [],
): { text: string; removed: boolean } {
  let out = text;
  for (const value of known)
    if (value.length >= 8 && out.includes(value)) out = out.split(value).join('•••');
  out = scrubSecrets(out);
  for (let i = 0; i < 50; i++) {
    const secret = secretIn(out);
    if (!secret || secret === '•••') break;
    const next = out.split(secret).join('•••');
    if (next === out) break;
    out = next;
  }
  return { text: out, removed: out !== text };
}

// ── Instructions ────────────────────────────────────────────────────────────

/**
 * At most `max` characters, cut where a paragraph (else a sentence, else a
 * word) ends, so what's kept still reads whole.
 */
export function fitted(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max);
  const cut =
    [head.lastIndexOf('\n\n'), head.lastIndexOf('. '), head.lastIndexOf(' ')].find(
      (at) => at > max * 0.6,
    ) ?? max;
  return { text: head.slice(0, cut + (head[cut] === '.' ? 1 : 0)).trimEnd(), truncated: true };
}

// ── Pictures ────────────────────────────────────────────────────────────────

/** OpenClaw keeps workspace pictures up to 2 MB: read that much, then Conch's own limit applies. */
const PICTURE_READ = 2 * 1024 * 1024;

export type FoundPicture =
  { ok: true; type: AgentImageType; bytes: Buffer } | { ok: false; note: string };

/** Its picture, ready to keep, or a sentence saying why it has one of Conch's instead. */
export async function pictureOf(
  avatar: FoundAvatar | undefined,
): Promise<FoundPicture | undefined> {
  if (!avatar) return undefined;
  let bytes: Buffer | undefined;
  if (avatar.kind === 'web')
    return { ok: false, note: 'Its picture is on the web, and Conch doesn’t fetch it.' };
  if (avatar.kind === 'outside')
    return { ok: false, note: 'Its picture is outside its folder, so Conch didn’t read it.' };
  if (avatar.kind === 'data') {
    const m = /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(avatar.data);
    if (!m?.[1]) return { ok: false, note: 'Its picture isn’t one Conch can keep.' };
    bytes = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  } else {
    bytes = await readInside(avatar.root, avatar.path, PICTURE_READ);
    if (!bytes) return { ok: false, note: 'Its picture couldn’t be read from its folder.' };
  }
  if (bytes.length > AGENT_LIMITS.avatarBytes)
    return {
      ok: false,
      note: 'Its picture is bigger than Conch keeps. Choose a smaller one in Agents.',
    };
  const clean = cleanPicture(bytes);
  if (!clean.ok) return { ok: false, note: 'Its picture isn’t one Conch can keep.' };
  return { ok: true, type: clean.type, bytes: clean.bytes };
}

// ── The agent ───────────────────────────────────────────────────────────────

/** One agent from the other app, shaped as Conch's, before it has a name of its own here. */
export interface AgentDraft {
  /** The app's own id. */
  id: string;
  name: string;
  role: string;
  persona: { tone: Tone; personality: string };
  instructions: string;
  avatar: AgentPresetAvatar;
  emoji?: string;
  picture?: FoundPicture;
  /** What a person should know: cut short, a secret taken out, a picture that stayed. */
  notes: string[];
  /** What Conch saw reading its words (anything but clean starts unticked). */
  review?: ReturnType<typeof scanText>;
}

const clean = (text: string, known: readonly string[]) =>
  withoutSecrets(unsmuggle(text).trim(), known);

export async function draftAgent(
  who: FoundIdentity,
  app: string,
  known: readonly string[],
): Promise<AgentDraft> {
  const notes: string[] = [];
  let secret = false;
  const take = (text: string) => {
    const out = clean(text, known);
    secret ||= out.removed;
    return out.text;
  };

  // Its words: its personality, then the standing orders the person gave it.
  const parts = [who.soul, who.conventions].filter((p): p is { text: string; from: string } =>
    Boolean(p?.text.trim()),
  );
  const raw = parts.map((p) => p.text.trim()).join('\n\n');
  // Everything of it that reaches the prompt is read first: its words, name, role and manner.
  const said = [
    ...parts,
    { text: [who.name, who.role, who.vibe].filter(Boolean).join('\n'), from: 'its identity' },
  ];
  const findings = said.flatMap((p) => scanText(p.text, p.from).findings);
  const review: AgentDraft['review'] = findings.length
    ? {
        verdict: findings.some((f) => f.severity === 'danger') ? 'danger' : 'caution',
        findings,
      }
    : undefined;
  const fit = fitted(take(raw), AGENT_LIMITS.instructions);
  if (fit.truncated)
    notes.push(
      `Its instructions are longer than the ${AGENT_LIMITS.instructions.toLocaleString('en')} characters Conch keeps, so the end stays in ${app}.`,
    );

  const name = take(who.name).replace(/\s+/g, ' ').slice(0, AGENT_LIMITS.name).trim() || 'Agent';
  const role = take(who.role ?? '').replace(/\s+/g, ' ');
  const roleLine = role.length > AGENT_LIMITS.role ? fitted(role, AGENT_LIMITS.role).text : role;
  const manner = take(who.vibe ?? '');
  const personality = fitted(manner, AGENT_LIMITS.personality).text;
  if (secret) notes.push('Something in its words looked like a key or a password: it’s left out.');

  const emoji = firstEmoji(who.emoji);
  const picture = await pictureOf(who.avatar);
  if (picture && !picture.ok) notes.push(`${picture.note} It has one of Conch’s faces for now.`);
  return {
    id: who.id,
    name,
    role: roleLine,
    persona: { tone: toneOf(raw, manner), personality },
    instructions: fit.text,
    avatar: presetFor(emoji, `${who.vibe ?? ''} ${who.name}`, `${app}:${who.id}`),
    ...(emoji && { emoji }),
    ...(picture && { picture }),
    notes,
    ...(review && review.verdict !== 'clean' && { review }),
  };
}
