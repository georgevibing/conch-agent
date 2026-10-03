/**
 * When an email arrives (ADR 0056): Gmail's own search, from where the pulse
 * last looked, through whichever way the account signs in (Google's sign-in
 * or an app password). No model until something matches.
 */
import type { MailSender } from '@conch/protocol';

import {
  SourceError,
  type CheckResult,
  type Happening,
  type SourceContext,
  type TriggerOf,
  type TriggerSource,
} from './types';

export interface MailAccount {
  id: string;
  email: string;
  /** Signed in and allowed to read mail. */
  ready: boolean;
  /** Why not, in a sentence. */
  problem?: string;
}

export interface MailMessage {
  id: string;
  fromAddress?: string;
  fromName?: string;
  subject: string;
  text: string;
  date?: number;
  labels?: string[];
  link?: string;
}

/** What the mail source needs from Gmail (`google/`), so a test can pretend. */
export interface MailAccess {
  /** Accounts that can read mail, with Gmail turned on in Apps. Empty: no Gmail. */
  accounts(): Promise<MailAccount[]>;
  /** Gmail's search, newest first, as ids. */
  search(accountId: string, query: string, limit: number): Promise<string[]>;
  read(accountId: string, messageId: string): Promise<MailMessage>;
}

const EVERY_MS = 2 * 60_000;
/** Gmail indexes some mail late: each look reaches back this far, and ids keep it to once. */
const OVERLAP_MS = 60 * 60_000;
/** At most this many new messages read in one look (the rest wait for the next). */
const PER_LOOK = 20;
const DETAIL_CHARS = 2_000;

const quote = (text: string) => `"${text.replace(/["\\]/g, ' ').trim()}"`;

/** Gmail's search for this trigger, from `after` (epoch ms). */
export function mailQuery(trigger: TriggerOf<'mail'>, after: number): string {
  const parts = ['in:inbox', '-from:me', '-in:chats', `after:${Math.floor(after / 1000)}`];
  const senders = trigger.from.map((s) => `from:${s.address ?? quote(s.name ?? '')}`);
  if (senders.length === 1) parts.push(senders[0] ?? '');
  if (senders.length > 1) parts.push(`(${senders.join(' OR ')})`);
  const words = trigger.words.map(quote);
  if (words.length === 1) parts.push(words[0] ?? '');
  if (words.length > 1) parts.push(`(${words.join(' OR ')})`);
  return parts.join(' ');
}

const who = (s: MailSender) => s.name ?? s.address ?? 'someone';

function list(items: string[], joiner = 'or'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items.at(-1)}`;
}

/** "When Anna Smith emails you", "When an email about “invoice” arrives". */
export function describeMail(trigger: TriggerOf<'mail'>): string {
  const people = trigger.from.map(who);
  const words = trigger.words.map((w) => `“${w}”`);
  const about = words.length ? ` about ${list(words)}` : '';
  if (people.length) {
    const shown =
      people.length > 3 ? [...people.slice(0, 2), `${people.length - 2} others`] : people;
    return `When ${list(shown)} email${shown.length === 1 && people.length === 1 ? 's' : ''} you${about}`;
  }
  return words.length ? `When an email${about} arrives` : 'When an email arrives';
}

export function mailSource(access: MailAccess): TriggerSource<'mail'> {
  const accountsFor = async (trigger: TriggerOf<'mail'>) => {
    const all = await access.accounts();
    if (!all.length)
      throw new SourceError('needs-you', 'Connect Gmail so Conch can notice new email.', {
        label: 'Open Apps',
        place: 'integrations',
        focus: 'gmail',
      });
    const chosen = trigger.account ? all.filter((a) => a.id === trigger.account) : all;
    if (!chosen.length)
      throw new SourceError(
        'needs-you',
        'The Google account this routine reads isn’t connected any more.',
        { label: 'Open Apps', place: 'integrations', focus: 'gmail' },
      );
    const ready = chosen.filter((a) => a.ready);
    if (!ready.length)
      throw new SourceError(
        'needs-you',
        chosen[0]?.problem ?? 'Gmail needs you to sign in again.',
        { label: 'Open Apps', place: 'integrations', focus: 'gmail' },
      );
    return ready;
  };

  const happening = (account: MailAccount, m: MailMessage): Happening => {
    const name = m.fromName || m.fromAddress || 'Someone';
    const subject = m.subject.trim() || '(no subject)';
    const lines = [
      `From: ${m.fromName ? `${m.fromName} <${m.fromAddress ?? ''}>` : (m.fromAddress ?? '')}`,
      `To: ${account.email}`,
      `Subject: ${subject}`,
      ...(m.date ? [`Date: ${new Date(m.date).toISOString()}`] : []),
      '',
      m.text.slice(0, DETAIL_CHARS) + (m.text.length > DETAIL_CHARS ? '\n[…]' : ''),
    ];
    return {
      id: `mail:${account.id}:${m.id}`,
      at: m.date ?? Date.now(),
      label: `${name}’s email “${subject.slice(0, 80)}”`,
      ...(m.link && { link: m.link }),
      detail: lines.join('\n'),
    };
  };

  /** Mail sent from this account (Conch's own replies included) and drafts never count. */
  const own = (account: MailAccount, m: MailMessage) =>
    m.labels?.some((l) => l === 'SENT' || l === 'DRAFT') ||
    m.fromAddress?.toLowerCase() === account.email.toLowerCase();

  return {
    kind: 'mail',
    async validate(trigger) {
      const seen = new Set<string>();
      const from = trigger.from.filter((s) => {
        const key = (s.address ?? s.name ?? '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const words = [...new Set(trigger.words.map((w) => w.trim()).filter(Boolean))];
      return { ...trigger, from, words };
    },
    describe: describeMail,
    note: () => 'Conch looks for new email every 2 minutes while it’s running.',
    taint: () => ({ kind: 'app', label: 'an email' }),
    every: () => EVERY_MS,
    async check(ctx) {
      const accounts = await accountsFor(ctx.trigger);
      const looked = (ctx.state.looked ?? {}) as Record<string, number>;
      const happenings: Happening[] = [];
      const failures: SourceError[] = [];
      for (const account of accounts) {
        const from = Math.max(ctx.since, (looked[account.id] ?? ctx.since) - OVERLAP_MS);
        try {
          const ids = await access.search(account.id, mailQuery(ctx.trigger, from), PER_LOOK);
          const known = new Set((ctx.state.ids as string[] | undefined) ?? []);
          for (const id of ids) {
            if (ctx.signal.aborted) break;
            if (known.has(`${account.id}:${id}`)) continue;
            const message = await access.read(account.id, id);
            known.add(`${account.id}:${id}`);
            // Older than the routine itself (a slow index, a moved message): not news.
            if (own(account, message) || (message.date && message.date < ctx.since - 60_000))
              continue;
            happenings.push(happening(account, message));
          }
          ctx.state.ids = [...known].slice(-300);
          looked[account.id] = ctx.now;
        } catch (error) {
          failures.push(
            error instanceof SourceError
              ? error
              : new SourceError('retry', 'Gmail didn’t answer. Conch will look again shortly.'),
          );
        }
      }
      // One account failing doesn't hide another's mail; all failing is a failure.
      if (failures.length === accounts.length && failures[0]) throw failures[0];
      const result: CheckResult = {
        happenings: happenings.sort((a, b) => a.at - b.at),
        state: { ...ctx.state, looked },
      };
      return result;
    },
    async sample(ctx: SourceContext<TriggerOf<'mail'>>) {
      const [account] = await accountsFor(ctx.trigger);
      if (!account) return undefined;
      const query = mailQuery(ctx.trigger, ctx.now - 90 * 86_400_000);
      for (const id of await access.search(account.id, query, 5)) {
        const message = await access.read(account.id, id);
        if (!own(account, message)) return happening(account, message);
      }
      return undefined;
    },
  };
}
