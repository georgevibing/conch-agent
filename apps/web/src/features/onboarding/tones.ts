import type { Tone } from '@conch/protocol';

export const toneOptions: { value: Tone; label: string; sample: string }[] = [
  { value: 'warm', label: 'Warm', sample: '“Happy to help — let’s figure this out together.”' },
  { value: 'concise', label: 'Concise', sample: '“Done. Three files changed.”' },
  {
    value: 'playful',
    label: 'Playful',
    sample: '“Ooh, a regex puzzle. My favourite kind of trouble.”',
  },
  {
    value: 'precise',
    label: 'Precise',
    sample: '“Two options, with one assumption I should flag first.”',
  },
];
