import type { Room } from '../recovery/gateway';

const UNKNOWN = { why: 'new work is held for now', until: 'as soon as there’s room' };

/**
 * What a provider's own shell command is told when Conch holds it for room:
 * that it never ran, why, what it waits for, and what to do meanwhile that will
 * work here. `canQueue` only when this turn has `process_start`: advice the
 * assistant can't follow sends it round in circles.
 */
export function heldCommandWords(room: Room | undefined, canQueue: boolean): string {
  const { why, until } = room && !room.room ? room : UNKNOWN;
  return [
    `Conch held this command before it ran, so nothing happened: ${why}.`,
    `Commands run again by themselves ${until}.`,
    canQueue
      ? 'To run it as soon as there’s room, start it with process_start: it waits its turn and starts by itself. Then use process_read with wait_ms: 30000 to wait for it, rather than trying again.'
      : 'Meanwhile, carry on with reading and planning, and try the command again in about 30 seconds, not sooner.',
  ].join(' ');
}
