/**
 * Where work runs (ADR 0106): the place a chat's commands run. This computer,
 * in its sealed box, is the default; a container, an SSH machine of your own
 * or a sandbox in the cloud are chosen per chat (or as the default for new
 * chats). One definition of the words, for the chat's picker, Settings, the
 * row that says where a command ran, and the documentation.
 */
import { z } from 'zod';

/**
 * A place, as a chat keeps it: `computer`, `container`, `cloud`, or
 * `ssh:<host>` for a machine named in your SSH settings. The name can't start
 * with a dash, so it can never be read as one of `ssh`'s options.
 */
export const WorkPlaceId = z
  .string()
  .max(80)
  .regex(/^(?:computer|container|cloud|ssh:[A-Za-z0-9_][A-Za-z0-9._-]{0,63})$/);
export type WorkPlaceId = z.infer<typeof WorkPlaceId>;

export const WorkPlaceKind = z.enum(['computer', 'container', 'ssh', 'cloud']);
export type WorkPlaceKind = z.infer<typeof WorkPlaceKind>;

export function placeKind(id: string): WorkPlaceKind {
  if (id.startsWith('ssh:')) return 'ssh';
  return id === 'container' || id === 'cloud' ? id : 'computer';
}

/** The machine an `ssh:` place names. */
export function sshHostOf(id: string): string | undefined {
  return id.startsWith('ssh:') ? id.slice(4) : undefined;
}

/** Where one command ran, kept on its row, for every place but this computer. */
export const WorkedAt = z.object({
  kind: WorkPlaceKind.exclude(['computer']),
  /** In a few words: "a container", "build-box", "the cloud". */
  name: z.string().min(1).max(80),
});
export type WorkedAt = z.infer<typeof WorkedAt>;

/** The words for each kind of place. */
export interface PlaceWords {
  kind: WorkPlaceKind;
  label: string;
  /** One short line: what it is and what it keeps from your computer. */
  description: string;
  /** On a command's row: "Ran in a container". */
  ranIn: string;
}

export const PLACE_WORDS: Record<WorkPlaceKind, PlaceWords> = {
  computer: {
    kind: 'computer',
    label: 'This computer',
    description: 'In the sealed box here: your work folder only, no network, no keys.',
    ranIn: 'Ran on this computer',
  },
  container: {
    kind: 'container',
    label: 'A container',
    description:
      'A fresh, locked-down box on this computer. It sees only the work folder; your keys and settings stay out.',
    ranIn: 'Ran in a container',
  },
  ssh: {
    kind: 'ssh',
    label: 'Your machine',
    description:
      'A computer you already reach with SSH. The work folder is copied there and back; commands have that machine’s own access.',
    ranIn: 'Ran on',
  },
  cloud: {
    kind: 'cloud',
    label: 'The cloud',
    description:
      'A sandbox at Daytona that sleeps when idle. The work folder is copied there and back; nothing else leaves.',
    ranIn: 'Ran in the cloud',
  },
};

/** How a place stands right now. */
export const WorkPlaceState = z.enum([
  /** Commands can run there now. */
  'ready',
  /** It's waking up or getting its box for the first time: commands wait. */
  'preparing',
  /** Something only you can give is missing: a program, a key. `need` or `action` says what. */
  'needs-setup',
  /** It was reachable before and isn't now (a machine asleep, the network). */
  'unavailable',
]);
export type WorkPlaceState = z.infer<typeof WorkPlaceState>;

export const WorkPlaceInfo = z.object({
  id: WorkPlaceId,
  kind: WorkPlaceKind,
  /** "This computer", "Docker", "build-box", "Daytona". */
  name: z.string().min(1).max(80),
  /** One short line under the name. */
  description: z.string().max(240),
  state: WorkPlaceState,
  /** What's wrong or going on, in one sentence, when it isn't ready. */
  message: z.string().max(300).optional(),
  /** A program it needs, for `<GetIt needId=…>` (ADR 0016). */
  need: z.string().max(80).optional(),
  /** It needs a key first (the cloud). */
  needsKey: z.boolean().optional(),
});
export type WorkPlaceInfo = z.infer<typeof WorkPlaceInfo>;

export const WorkPlacesStatus = z.object({
  places: z.array(WorkPlaceInfo),
  /** Where new chats run. */
  default: WorkPlaceId,
});
export type WorkPlacesStatus = z.infer<typeof WorkPlacesStatus>;

/** Saving the cloud sandbox's key: typed by the person, never shown again. */
export const SetCloudKeyBody = z.object({
  key: z
    .string()
    .trim()
    .min(16)
    .max(400)
    .regex(/^[A-Za-z0-9_.-]+$/, 'That doesn’t look like a Daytona key.'),
});
export type SetCloudKeyBody = z.infer<typeof SetCloudKeyBody>;

/** What the row says about where a command ran: "Ran in a container", "Ran on build-box". */
export function ranInWords(where: WorkedAt): string {
  return where.kind === 'ssh'
    ? `${PLACE_WORDS.ssh.ranIn} ${where.name}`
    : PLACE_WORDS[where.kind].ranIn;
}
