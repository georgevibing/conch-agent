/**
 * Who an email is for, in the words the cards use. Mirrors `MailPerson` in
 * `@conch/protocol`: an address, and a name when the thread gave one. Names
 * are outside words; they're drawn as plain text, and an approval always
 * shows the address beside them.
 */

export interface MailPerson {
  address: string;
  name?: string;
}

/** A file that goes with an email. Mirrors `MailFile`. */
export interface MailAttachment {
  /** Its id in the chat (`att_…`): with one, it can be taken off the email on the card. */
  id?: string;
  name: string;
  mime?: string;
  size?: number;
}

/** What the person changed on the card: the email as they approved it. Mirrors `MailEdit`. */
export interface MailChange {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** The files still going, by id: only ever fewer than were shown. */
  attachments?: string[];
}

/** A person from an address or from what a tool said. */
export const personOf = (who: string | MailPerson): MailPerson =>
  typeof who === 'string' ? { address: who } : who;

/** The name to say: theirs when known, else the address. */
export const nameOf = (person: MailPerson): string => person.name?.trim() || person.address;

/**
 * An address Gmail would take: one `@`, a dot in the domain, no spaces or
 * angle brackets. The gateway checks it again with the same rules as the
 * model's call; this only says so before the person presses Send.
 */
export function isAddress(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/.test(value)
  );
}

/** "Maya Kim", "Maya Kim and Sam", "Maya Kim and 2 others". */
export function peopleWords(people: readonly MailPerson[]): string {
  const [first, second] = people;
  if (!first) return 'nobody';
  if (people.length === 1) return nameOf(first);
  if (people.length === 2 && second) return `${nameOf(first)} and ${nameOf(second)}`;
  return `${nameOf(first)} and ${people.length - 1} others`;
}

/** The words **Follow up** puts in the composer: a request to the assistant, never an email. */
export function followUpRequest(email: { to: readonly MailPerson[]; subject: string }): string {
  return `Draft a follow-up to ${peopleWords(email.to)} about “${email.subject || 'my last email'}”`;
}

/** The words **Send it now** puts in the composer, for a draft waiting in Gmail. */
export function sendDraftRequest(email: { to: readonly MailPerson[]; subject: string }): string {
  return `Send the draft to ${email.to.map((p) => p.address).join(', ')} about “${email.subject || 'no subject'}”`;
}

/** The words **Try again** puts in the composer, after an email that didn't go. */
export function retryRequest(email: { to: readonly MailPerson[]; subject: string }): string {
  return `Try sending the email to ${email.to.map((p) => p.address).join(', ')} about “${email.subject || 'no subject'}” again`;
}

/** The same people, in the same order, whatever the case of their addresses. */
export const samePeople = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v.toLowerCase() === b[i]?.toLowerCase());
