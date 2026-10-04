/**
 * What a skill's licence lets you do (ADR 0070), read from the skill itself:
 * its `license:` front matter and a LICENSE file next to it. A registry's own
 * label is only a hint — ClawHub stamps everything MIT-0, including copies
 * of skills whose own words say "Proprietary" — so the skill's words win when
 * they're stricter.
 */
import type { MarketLicense } from '@conch/protocol';

import { readKey, splitSkill } from '../frontmatter';

const OPEN: [RegExp, string][] = [
  [/\bMIT-0\b|MIT No Attribution/i, 'MIT-0'],
  [/\bApache(?:[-\s]License)?[-,\s]*(?:Version\s*)?2(?:\.0)?\b|\bApache-2\.0\b/i, 'Apache-2.0'],
  [/\bMIT\b(?! No)|Permission is hereby granted, free of charge/i, 'MIT'],
  [/\bBSD[-\s]?(?:[234][-\s]Clause)?\b|Redistribution and use in source and binary forms/i, 'BSD'],
  [/\bISC\b/, 'ISC'],
  [/\bMPL[-\s]?2(?:\.0)?\b|Mozilla Public License/i, 'MPL-2.0'],
  [
    /\bCC0\b|CC-?BY(?:-SA)?(?:[-\s]\d(?:\.\d)?)?\b|Creative Commons Attribution/i,
    'Creative Commons',
  ],
  [/\bUnlicense\b|This is free and unencumbered software/i, 'Unlicense'],
  [/\b(?:L?GPL|AGPL)[-\s]?v?\d/i, 'GPL'],
];

const RESTRICTED =
  /\bproprietary\b|all rights reserved|source[-\s]available|not open[-\s]source|may not[^.]{0,120}\b(?:reproduce|copy|distribute|extract|sublicense)/i;

/** "Complete terms in LICENSE.txt": a pointer, not a name. */
const POINTER =
  /\b(?:license|licence)\.(?:txt|md)\b|complete terms|see (?:the )?(?:license|licence)/i;

const LICENSE_FILES = /^(?:LICEN[CS]E|COPYING)(?:\.(?:txt|md))?$/i;

function named(text: string): string | undefined {
  for (const [pattern, name] of OPEN) if (pattern.test(text)) return name;
  return undefined;
}

/**
 * The licence of the skill in `files` (paths relative to its folder).
 * `hint` is what the registry says, used only when the skill says nothing.
 */
export function licenseOf(files: ReadonlyMap<string, Buffer>, hint?: string): MarketLicense {
  const skill = files.get('SKILL.md')?.toString('utf8') ?? '';
  const declared = readKey(splitSkill(skill).front, 'license')?.replace(/\s+/g, ' ').trim() ?? '';
  const file = [...files.keys()].find((path) => LICENSE_FILES.test(path));
  const text = file ? (files.get(file)?.toString('utf8').slice(0, 6000) ?? '') : '';

  if (
    RESTRICTED.test(declared) ||
    (text && RESTRICTED.test(text.slice(0, 2000)) && !named(text.slice(0, 600)))
  )
    return { kind: 'restricted', name: 'Proprietary' };
  const fromDeclared = declared && !POINTER.test(declared) ? named(declared) : undefined;
  if (fromDeclared) return { kind: 'open', name: fromDeclared };
  const fromFile = text ? named(text.slice(0, 1200)) : undefined;
  if (fromFile) return { kind: 'open', name: fromFile };
  if (declared && !POINTER.test(declared)) return { kind: 'unknown', name: declared.slice(0, 80) };
  const fromHint = hint ? named(hint) : undefined;
  if (fromHint) return { kind: 'open', name: fromHint };
  return { kind: 'unknown' };
}

/** The sentence that stops a skill being added, when its licence doesn't allow copying it. */
export const RESTRICTED_WORDS =
  'Its licence only allows using it inside its maker’s own apps, so Conch won’t copy it here.';
