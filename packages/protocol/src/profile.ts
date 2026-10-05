/**
 * About you, as a portrait: who you are in a few cards (work, home, people,
 * interests, how you like things), and in your own words. Every chat starts
 * with it; `describeProfile` writes exactly what the assistant reads, so the
 * page that edits it can show it word for word.
 */
import { z } from 'zod';

export const ProfileFactKind = z.enum([
  /** What you do: "SDM at Amazon, AWS Security". */
  'work',
  /** Where you live and come from: "Lives in Berlin since 2016". */
  'home',
  /** The people in your life: "Lina", with "daughter · born 8 June 2025". */
  'person',
  /** What you're into: "Graphics programming". */
  'interest',
  /** How you like things done: "Short answers first", "Metric units". */
  'way',
]);
export type ProfileFactKind = z.infer<typeof ProfileFactKind>;

export const ProfileFact = z.object({
  id: z.string().min(1).max(40),
  kind: ProfileFactKind,
  /** The fact itself: "SDM at Amazon", "Lina". */
  text: z.string().trim().min(1).max(160),
  /** Beside it, quieter: for a person, who they are to you and a date. */
  detail: z.string().trim().max(160).optional(),
});
export type ProfileFact = z.infer<typeof ProfileFact>;

export const MAX_PROFILE_FACTS = 80;

/** The kinds of picture a photo may be: never SVG, which can carry script. */
export const AvatarType = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export type AvatarType = z.infer<typeof AvatarType>;

/** That you have a photo, and when it changed (so the browser shows the new one). */
export const ProfileAvatar = z.object({ type: AvatarType, updatedAt: z.number() });
export type ProfileAvatar = z.infer<typeof ProfileAvatar>;

/** A photo, framed and shrunk by the browser: PNG, JPEG or WebP, base64. */
export const AvatarBody = z.object({ data: z.string().min(1).max(1_000_000) });
export type AvatarBody = z.infer<typeof AvatarBody>;

/** Where a photo is shown from; `undefined` when there's none (your initial, then). */
export function avatarUrl(profile: { avatar?: ProfileAvatar }): string | undefined {
  return profile.avatar ? `/api/profile/avatar?v=${profile.avatar.updatedAt}` : undefined;
}

/** Your own words, to be read into cards (`POST /api/profile/understand`). */
export const UnderstandProfileBody = z.object({ about: z.string().trim().min(1).max(4000) });
export type UnderstandProfileBody = z.infer<typeof UnderstandProfileBody>;

/** What a model read in them: suggestions, kept only when you keep them. */
export const UnderstoodProfile = z.object({
  facts: z.array(ProfileFact).max(MAX_PROFILE_FACTS),
});
export type UnderstoodProfile = z.infer<typeof UnderstoodProfile>;

/** Each card's name, as the assistant reads it and the page shows it. */
export const PROFILE_KIND_WORDS: Record<ProfileFactKind, { title: string; prompt: string }> = {
  work: { title: 'Work', prompt: 'Work' },
  home: { title: 'Home', prompt: 'Home' },
  person: { title: 'People', prompt: 'People in their life' },
  interest: { title: 'Interests', prompt: 'Interests' },
  way: { title: 'How you like things', prompt: 'How they like things done' },
};

/**
 * What every chat starts with about you: your name, each card in a line, then
 * your own words. The assistant reads this; Settings shows it as it is.
 */
export function describeProfile(profile: {
  name: string;
  about: string;
  facts?: readonly ProfileFact[];
}): string[] {
  const lines: string[] = [];
  const name = profile.name.trim();
  if (name) lines.push(`Their name is ${name}.`);
  for (const kind of ProfileFactKind.options) {
    const facts = (profile.facts ?? []).filter((f) => f.kind === kind);
    if (!facts.length) continue;
    const items = facts.map((f) => (f.detail ? `${f.text} (${f.detail})` : f.text));
    lines.push(`${PROFILE_KIND_WORDS[kind].prompt}: ${items.join('; ')}.`);
  }
  const about = profile.about.trim();
  if (about) lines.push(lines.length ? `In their own words: ${about}` : about);
  return lines;
}
