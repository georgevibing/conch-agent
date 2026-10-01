/**
 * The words generated parts put under headings of their own, as plain data:
 * the parts draw them, and the table of contents and search list them
 * (`pages.ts`) without drawing anything.
 */
import reference from 'virtual:conch-reference';

import type { FileRef } from '../../reference/types';
import { slugify, type Heading } from '../site/text';

export const FILE_CLASSES: readonly { id: FileRef['class']; title: string; about: string }[] = [
  { id: 'kept', title: 'Backed up', about: 'Yours. In every backup, and restored with it.' },
  {
    id: 'secret',
    title: 'Keys and sign-ins',
    about: 'Only in a backup you lock with a passphrase.',
  },
  {
    id: 'derived',
    title: 'Rebuilt by itself',
    about: 'Never backed up: Conch makes it again, or it’s only about this computer.',
  },
  {
    id: 'outside',
    title: 'Not Conch’s to back up',
    about: 'Back these up with your other files.',
  },
];

/** The groups `pnpm conch` commands come in, in the order they're listed. */
export const CLI_GROUPS: readonly string[] = [
  ...new Set(reference.cli.map((command) => command.group)),
];

const heading = (text: string): Heading => ({ id: slugify(text), text, level: 2 });

/** The headings a generated part adds to its page. */
export function embedHeadings(name: string): Heading[] {
  if (name === 'cli') return CLI_GROUPS.map(heading);
  if (name === 'files')
    return FILE_CLASSES.filter((kind) => reference.files.some((f) => f.class === kind.id)).map(
      (kind) => heading(kind.title),
    );
  return [];
}
