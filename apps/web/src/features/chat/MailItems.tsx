/**
 * Email in the chat (ADR 0060, ADR 0099): the letter to approve, the moment
 * it goes, and the letter that went. The approval card is the email itself,
 * changeable in place; what the person approves is what the gateway sends,
 * after checking it again. The sent card comes from what Gmail confirmed,
 * and a call that failed or may have gone says so from the call itself —
 * never "sent" before Gmail said it was.
 */
import type { MailEdit, MailSentView } from '@conch/protocol';
import {
  ApprovalLine,
  MailCompose,
  MailSent,
  followUpRequest,
  retryRequest,
  sendDraftRequest,
  type MailAttachment,
  type MailPerson,
} from '@conch/nacre';
import { useState, type ReactNode } from 'react';

import type { TranscriptItem } from '../../live/reducer';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { useComposerInsert } from './ToolFound';
import { useArrivedLive } from './TranscriptItems';

type Tool = Extract<TranscriptItem, { kind: 'tool' }>;
type Permission = Extract<TranscriptItem, { kind: 'permission' }>;
type Decision = 'allow' | 'allow-always' | 'deny';

/** An email as a mail tool's call carries it, read defensively: the input is the model's. */
export interface MailCall {
  to: MailPerson[];
  cc: MailPerson[];
  subject: string;
  body: string;
  from?: string;
  reply: boolean;
  /** The files going: their names as the gateway found them, beside the ids the call named. */
  files: MailAttachment[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The email in a call's input, or nothing when it isn't one. */
export function mailOf(input: unknown): MailCall | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const call = input as Record<string, unknown>;
  const to = strings(call.to);
  if (!to.length || typeof call.subject !== 'string' || typeof call.body !== 'string')
    return undefined;
  const names =
    call.names && typeof call.names === 'object' ? (call.names as Record<string, unknown>) : {};
  const person = (address: string): MailPerson => {
    const name = names[address.toLowerCase()];
    return typeof name === 'string' && name.trim() ? { address, name } : { address };
  };
  // The card's names (`files`) and their ids (`fileIds`), both from the gateway, in order.
  const ids = strings(call.fileIds);
  const files = strings(call.files).map((name, i) => {
    const id = ids[i];
    return id ? { id, name } : { name };
  });
  return {
    files,
    to: to.map(person),
    cc: strings(call.cc).map(person),
    subject: call.subject,
    body: call.body,
    ...(typeof call.accountEmail === 'string' && { from: call.accountEmail }),
    reply: typeof call.sourceMessageId === 'string',
  };
}

const bare = (name: string) => name.replace(/^mcp__conch__/, '');
const isSend = (name: string) => bare(name) === 'google_mail_send';

/** Gmail's Sent folder for an account: where to look when it may have gone. */
const sentFolder = (account?: string) =>
  `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : ''}#sent`;

/**
 * The approval for an email: the letter, Send or Save draft, Don't send, and
 * (for a send) Edit in place and "Save as a draft instead". Once allowed it
 * stays while the email goes — folding and flying — until Gmail has answered.
 */
export function MailApproval({
  item,
  call,
  mail,
  onRespond,
}: {
  item: Permission;
  call?: Tool;
  mail: MailCall;
  onRespond: (decision: Decision, edit?: MailEdit) => void;
}) {
  const [sent, setSent] = useState<'send' | 'decline' | 'draft'>();
  const sendRef = useAutoFocus<HTMLButtonElement>();
  const insert = useComposerInsert();
  const send = isSend(item.toolName);
  const going =
    (item.decision === 'allow' || sent === 'send') &&
    send &&
    (!item.decision || !call || call.status === 'running' || call.status === 'pending');
  if (item.decision && !going) {
    const title = (item.title ?? item.summary).replace(/^./, (c) => c.toUpperCase());
    return <ApprovalLine decision={item.decision}>{title}</ApprovalLine>;
  }
  return (
    <MailCompose
      intent={send ? 'send' : 'draft'}
      {...(mail.from && { from: mail.from })}
      to={mail.to}
      cc={mail.cc}
      subject={mail.subject}
      body={mail.body}
      files={mail.files}
      reply={mail.reply}
      editable={Boolean(item.editable)}
      caution={item.caution ?? item.taint}
      status={going ? 'sending' : 'asking'}
      {...(sent && { busy: sent })}
      sendRef={sendRef}
      onSend={(edit) => {
        setSent('send');
        onRespond('allow', edit);
      }}
      onDecline={() => {
        setSent('decline');
        onRespond('deny');
      }}
      {...(send && {
        // Not sent: the person asks for a draft in their own words, and reads it first.
        onDraftInstead: () => {
          setSent('draft');
          onRespond('deny');
          insert(
            `Save that email to ${mail.to.map((p) => p.address).join(', ')} as a Gmail draft instead of sending it`,
          );
        },
      })}
    />
  );
}

/** The letter that went (or waits in Drafts), from what Gmail confirmed. */
export function MailSentItem({ view }: { view: MailSentView }) {
  const insert = useComposerInsert();
  const arriving = useArrivedLive();
  return (
    <MailSent
      state={view.state}
      from={view.from}
      to={view.to}
      {...(view.cc && { cc: view.cc })}
      subject={view.subject}
      body={view.body}
      {...(view.clipped && { clipped: true })}
      at={view.at}
      {...(view.url && { url: view.url })}
      {...(view.reply && { reply: true })}
      {...(view.edited && { edited: true })}
      {...(view.files && { files: view.files })}
      arriving={arriving}
      onFollowUp={() => insert(followUpRequest(view))}
      onSendDraft={() => insert(sendDraftRequest(view))}
    />
  );
}

/** Words the gateway says when Gmail may have taken it (`writes.ts`). */
const MAY_HAVE_SENT = /may have sent/i;
/** Words the gateway ends with when it sent nothing. */
const NOTHING_SENT = /Nothing was sent\.?\s*$/i;

/**
 * An email's card from its call, where Gmail confirmed nothing to draw: on
 * its way (no question was asked, so no card is folding), didn't go, or may
 * have gone. Nothing for a call that's fine, or one the person said no to.
 */
export function mailMoment(tool: Tool, asked?: Permission): ReactNode | undefined {
  if (!isSend(tool.name) || tool.view) return undefined;
  const mail = mailOf(tool.input);
  if (!mail) return undefined;
  if (tool.approval === 'declined' || tool.approval === 'refused' || tool.approval === 'expired')
    return undefined;
  const running = tool.status === 'running' || tool.status === 'pending';
  if (running) return asked ? undefined : <MailMomentCard mail={mail} state="sending" />;
  const output = tool.output ?? '';
  if (MAY_HAVE_SENT.test(output))
    return <MailMomentCard mail={mail} state="uncertain" url={sentFolder(mail.from)} />;
  if (tool.status === 'error' || NOTHING_SENT.test(output))
    return <MailMomentCard mail={mail} state="failed" reason={reasonOf(output)} />;
  return undefined;
}

/** The gateway's sentence, short; never a stack or raw JSON. */
function reasonOf(output: string): string {
  const text = output.replace(/\s+/g, ' ').trim();
  if (!text || text.startsWith('{') || text.length > 240) return 'Nothing was sent.';
  return text;
}

function MailMomentCard({
  mail,
  state,
  url,
  reason,
}: {
  mail: MailCall;
  state: 'sending' | 'uncertain' | 'failed';
  url?: string;
  reason?: string;
}) {
  const insert = useComposerInsert();
  return (
    <MailSent
      state={state}
      {...(mail.from && { from: mail.from })}
      to={mail.to}
      cc={mail.cc}
      subject={mail.subject}
      body={mail.body.slice(0, 4000)}
      reply={mail.reply}
      {...(url && { url })}
      {...(reason && { reason })}
      onRetry={() => insert(retryRequest(mail))}
    />
  );
}
