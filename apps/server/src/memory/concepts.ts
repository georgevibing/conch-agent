/**
 * A little meaning before any model is here (ADR 0041): words that are about
 * the same thing share a concept, so "anniversary" finds "got married" and
 * "car" finds "vehicle" with nothing downloaded.
 *
 * Small on purpose. Each group is a handful of everyday words a person would
 * say to an assistant about their own life, and only words that mean one
 * thing: "flat", "account", "call" or "run" mean too many things to be here,
 * and a wrong match is worse than none. English only: other languages get
 * meaning from the model (`ondevice.ts`), which knows many.
 */
import { stem } from './embed';

const GROUPS: Record<string, string> = {
  marriage:
    'anniversary anniversaries wedding weddings married marry marriage spouse husband wife honeymoon fiance fiancee',
  partner: 'partner girlfriend boyfriend spouse husband wife',
  birthday: 'birthday birthdays bday born',
  child: 'kid kids child children son daughter toddler baby babies',
  parent: 'mom mum mother dad father parent parents',
  sibling: 'brother sister sibling siblings',
  vehicle: 'car cars vehicle vehicles automobile suv sedan truck motorbike motorcycle',
  bicycle: 'bicycle bike bikes cycling',
  home: 'home house apartment residence',
  job: 'job jobs employer career workplace colleague colleagues coworker coworkers',
  money: 'money budget salary income finances expenses spending savings',
  invoice: 'invoice invoices bill bills billing receipt receipts',
  doctor: 'doctor physician clinic hospital',
  dentist: 'dentist orthodontist',
  medicine: 'medicine medication medications pill pills prescription meds',
  allergy: 'allergy allergies allergic intolerance intolerant',
  vegetarian: 'vegetarian vegan',
  meal: 'meal meals dinner lunch breakfast brunch',
  recipe: 'recipe recipes cook cooking',
  restaurant: 'restaurant restaurants cafe bistro diner',
  coffee: 'coffee espresso latte cappuccino americano',
  tea: 'tea matcha chai',
  travel: 'travel trip trips vacation holiday holidays journey',
  flight: 'flight flights plane airline airport',
  hotel: 'hotel hotels accommodation airbnb hostel',
  pet: 'pet pets dog dogs puppy',
  cat: 'cat cats kitten',
  music: 'music song songs band album playlist',
  exercise: 'exercise workout workouts gym fitness jogging',
  phone: 'phone smartphone iphone android mobile',
  computer: 'computer laptop macbook pc',
  email: 'email emails mail inbox gmail',
  calendar: 'calendar schedule agenda',
  school: 'school university college course degree',
  sleep: 'sleep bedtime nap insomnia',
  summary: 'summary summaries summarise summarize recap overview digest roundup',
  password: 'password passwords passcode login',
};

/** Each word's stem → the concepts it belongs to (made on first use: `embed.ts` imports this). */
let byStem: Map<string, string[]> | undefined;
function lookup(): Map<string, string[]> {
  if (byStem) return byStem;
  byStem = new Map();
  for (const [concept, words] of Object.entries(GROUPS))
    for (const word of words.split(' ')) {
      const s = stem(word);
      const list = byStem.get(s) ?? [];
      if (!list.includes(concept)) list.push(concept);
      byStem.set(s, list);
    }
  return byStem;
}

/** The concepts these word stems (from `tokens`) are about, as tokens of their own (`~vehicle`). */
export function concepts(stems: string[]): string[] {
  const map = lookup();
  const out = new Set<string>();
  for (const s of stems) for (const c of map.get(s) ?? []) out.add(`~${c}`);
  return [...out];
}

/** Word stems and the concepts they're about: what search and the built-in vectors compare. */
export function withConcepts(stems: string[]): string[] {
  return [...stems, ...concepts(stems)];
}
