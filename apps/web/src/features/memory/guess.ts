import type { ProfileFactKind } from '@conch/protocol';

/**
 * Where something you tell Conch about yourself belongs, read from its words
 * as you type them — instantly, with no model, so the place it'll go shows
 * before you press Enter (and you can pick another). A sentence that names
 * nothing it knows is something you're into.
 */
const RULES: [ProfileFactKind, RegExp][] = [
  [
    'way',
    /\b(prefer|prefers|rather|answers?|replies|reply|explain|tone|formal|casual|brief|short|concise|detailed|bullet|units?|metric|imperial|celsius|fahrenheit|spelling|british|american|emoji|always|never|don[’']?t|please|call me)\b/i,
  ],
  [
    'person',
    /\b(wife|husband|partner|spouse|girlfriend|boyfriend|son|daughter|kids?|children|child|baby|mother|mom|mum|father|dad|parents?|brother|sister|siblings?|grand(?:ma|pa|mother|father)|aunt|uncle|cousin|friend|boss|manager|colleague|cat|dog)\b/i,
  ],
  [
    'home',
    /\b(live|lives|living|moved|move|grew up|born in|from|hometown|city|country|based in|time ?zone)\b/i,
  ],
  [
    'work',
    /\b(work|works|working|job|career|role|engineer|developer|designer|manager|founder|student|studying|company|startup|team|project|projects|building|client|clients|office)\b/i,
  ],
];

export function guessFactKind(text: string): ProfileFactKind {
  return RULES.find(([, words]) => words.test(text))?.[0] ?? 'interest';
}
