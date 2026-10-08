/**
 * Approve from the notification (ADR 0108).
 *
 * A notification can carry **Allow** only for a step that is routine to
 * allow: one that sends nothing to other people, spends nothing, deletes
 * nothing, reads no keys, and was not asked because the chat read someone
 * else's words. Everything else says **Review**: the person opens Conch, sees
 * the whole of it on the approval sheet, and confirms it's them (passkey or
 * password, the gateway's "sudo mode") before it goes.
 *
 * A lock-screen answer is bound to exactly one question by a ticket:
 * - 32 random bytes, one per device per question, carried inside the push
 *   (encrypted end to end to that device: RFC 8291), never in a URL;
 * - kept here only as its SHA-256, in memory (a restart forgets every
 *   question, so it forgets every ticket);
 * - good once (used or not, Allow or Deny), for this device's own sign-in
 *   only, and for as long as the question is: 30 minutes at most;
 * - forgotten the moment the question is answered anywhere else.
 *
 * Pure apart from the clock, so the abuse cases are tested directly
 * (`approve.test.ts`).
 */
import { createHash, randomBytes } from 'node:crypto';

import type { ConversationEvent } from '@conch/protocol';

import { assessRisk } from '../conversations/risk';
import { sinkReason } from '../conversations/taint';
import { PLAN_APPROVAL } from '../plans/mode';

type Asked = Extract<ConversationEvent, { type: 'permission.requested' }>;

/** How long a question waits for a person before it's a no (and its tickets with it). */
export const APPROVAL_WAIT_MS = 30 * 60 * 1000;

/** Whether a lock-screen tap may allow it, and if not, why, in a few words. */
export type LockScreen = { quick: true } | { quick: false; why: string };

/** In a command: deleting, sending, publishing, reaching another machine, or being root. */
const OUTWARD =
  /(?:^|[\s;&|(`$])(?:rm|rmdir|del|erase|rd|unlink|shred|truncate|dd|mv|curl|wget|scp|sftp|rsync|ssh|nc|ncat|telnet|ftp|sudo|doas|su|chmod|chown|kill|pkill|killall|Remove-Item|Invoke-WebRequest|Invoke-RestMethod)(?=$|[\s;&|)])|\bgit\s+(?:push|reset|clean|rebase|checkout\s+--|restore|branch\s+-D|stash\s+(?:drop|clear))|\b(?:npm|pnpm|yarn|cargo|gem|twine|poetry)\s+publish\b|\bgh\s+(?:release|pr\s+merge|repo\s+delete)/;

/** Conch's own tools that act in your apps or send things out. */
const SENDS = /^(?:mcp__conch__)?(?:google_|slack_|channel_|image_generate|app_publish|publish)/;

/**
 * Whether a step is routine enough to allow from a notification. Errs to
 * "open Conch": a step this can't read is a step that needs the app.
 */
export function lockScreenCheck(asked: Asked, workspace: string): LockScreen {
  if (asked.cost) return { quick: false, why: 'It costs money.' };
  if (asked.vault) return { quick: false, why: 'It uses something from Passwords.' };
  if (asked.browser) return { quick: false, why: 'It acts on a website for you.' };
  if (asked.once || asked.editable)
    return { quick: false, why: 'It sends something to other people.' };
  if (asked.taint || asked.lasting || asked.afterReading)
    return { quick: false, why: 'This chat read something from outside.' };
  if (asked.toolName === PLAN_APPROVAL) return { quick: false, why: 'A plan is worth reading.' };
  const risk = assessRisk(asked.toolName, asked.input, { workspace });
  if (risk) return { quick: false, why: `It would ${risk.reason}.` };
  // Stricter than Auto on purpose: from a lock screen, anything that deletes, sends or
  // reaches another machine waits for the app, even inside the work folder.
  const command = (asked.input as { command?: unknown } | undefined)?.command;
  if (typeof command === 'string' && OUTWARD.test(command))
    return { quick: false, why: 'It deletes or sends something.' };
  const sink = sinkReason(asked.toolName, asked.input, { workspace });
  // A command was judged above, and a search query is everyday; the rest send or change things.
  if (sink && !/^(?:run a command|send a search query)/.test(sink))
    return { quick: false, why: `It would ${sink}.` };
  if (SENDS.test(asked.toolName)) return { quick: false, why: 'It acts in one of your apps.' };
  // Another app's tool (an MCP server you added): Conch can't tell what it does.
  if (/^mcp__(?!conch__)/.test(asked.toolName))
    return { quick: false, why: 'It acts in one of your apps.' };
  return { quick: true };
}

interface Ticket {
  owner: string;
  conversationId: string;
  permissionId: string;
  quick: boolean;
  expiresAt: number;
}

export type Redeemed =
  { ok: true; ticket: Ticket } | { ok: false; reason: 'unknown' | 'expired' | 'not-yours' };

const digest = (token: string) => createHash('sha256').update(token).digest('base64url');

/** The tickets a notification's Allow and Deny carry: one per device per question, good once. */
export class ApprovalTickets {
  readonly #tickets = new Map<string, Ticket>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A new ticket for `owner`'s device to answer this one question. */
  issue(owner: string, conversationId: string, permissionId: string, quick: boolean): string {
    this.#sweep();
    const token = randomBytes(32).toString('base64url');
    this.#tickets.set(digest(token), {
      owner,
      conversationId,
      permissionId,
      quick,
      expiresAt: this.now() + APPROVAL_WAIT_MS,
    });
    return token;
  }

  /**
   * Spends a ticket: whatever comes of it, it's gone. Only the device it was
   * made for can spend it, and only while the question could still be answered.
   */
  redeem(token: string, owner: string | undefined): Redeemed {
    const key = digest(token);
    const ticket = this.#tickets.get(key);
    if (!ticket) return { ok: false, reason: 'unknown' };
    this.#tickets.delete(key);
    if (ticket.expiresAt <= this.now()) return { ok: false, reason: 'expired' };
    if (!owner || ticket.owner !== owner) return { ok: false, reason: 'not-yours' };
    // A ticket answers one question once: its siblings for other devices go too.
    this.forget(ticket.permissionId);
    return { ok: true, ticket };
  }

  /** The question was answered (or ran out): no ticket for it is good any more. */
  forget(permissionId: string): void {
    for (const [key, t] of this.#tickets)
      if (t.permissionId === permissionId) this.#tickets.delete(key);
  }

  get size(): number {
    return this.#tickets.size;
  }

  #sweep() {
    const now = this.now();
    for (const [key, t] of this.#tickets) if (t.expiresAt <= now) this.#tickets.delete(key);
  }
}
