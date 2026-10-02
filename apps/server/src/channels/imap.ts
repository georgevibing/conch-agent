/**
 * Signing in to a mailbox over IMAP with an app password, shared by the email
 * channel (ADR 0044) and Gmail with an app password (ADR 0048): one way to
 * open a connection, one way to read a message, and one set of words for
 * what went wrong. Nothing here sends mail.
 */
import { ImapFlow } from 'imapflow';
import PostalMime, { type Email } from 'postal-mime';

import { ChannelError, redact } from './types';

export interface ImapWhere {
  host: string;
  port: number;
}

export interface ImapOptions {
  /** Without TLS. Only ever for a pretend server on 127.0.0.1. */
  insecure?: boolean;
  /** IDLE is renewed this often. */
  idleMs?: number;
}

/** A connection that isn't open yet: TLS from the start, short timeouts, no logs. */
export function imapClient(
  where: ImapWhere,
  auth: { user: string; pass: string },
  options: ImapOptions = {},
): ImapFlow {
  const client = new ImapFlow({
    host: where.host,
    port: where.port,
    secure: !options.insecure,
    ...(options.insecure && { doSTARTTLS: false }),
    auth,
    logger: false,
    disableAutoIdle: true,
    ...(options.idleMs && { maxIdleTime: options.idleMs }),
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 10 * 60_000,
  });
  // A dropped connection shows up as its close (and a failed command); the error event needs no more.
  client.on('error', () => undefined);
  return client;
}

/** The server refused the name or the password. */
export function isAuth(error: unknown): boolean {
  const e = error as { authenticationFailed?: boolean; serverResponseCode?: string };
  return Boolean(e?.authenticationFailed) || e?.serverResponseCode === 'AUTHENTICATIONFAILED';
}

/**
 * What went wrong signing in or reading, in words a person (and a model) can
 * act on. What the server said is read with every secret taken out first, and
 * never repeated.
 */
export function imapFailure(error: unknown, name: string, ...secrets: string[]): ChannelError {
  if (error instanceof ChannelError) return error;
  const e = error as { responseText?: string; code?: string; message?: string };
  const said = redact(`${e.responseText ?? ''} ${e.message ?? ''}`, ...secrets);
  if (isAuth(error)) {
    if (/application-specific|app password|web login required/i.test(said))
      return new ChannelError(
        'auth',
        `${name} wants an app password here, not your account’s own password. Make one and paste it.`,
        { field: 'password' },
      );
    return new ChannelError(
      'auth',
      `${name} didn’t take that app password. Make a new one and paste it.`,
      { field: 'password' },
    );
  }
  if (/IMAP access is disabled|IMAP.*not enabled/i.test(said))
    return new ChannelError(
      'setup',
      `IMAP is turned off for this account. Turn it on in ${name}’s settings.`,
    );
  if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH')
    return new ChannelError('network', `Couldn’t reach ${name}’s mail server.`, {
      field: 'server',
    });
  return new ChannelError('network', `Couldn’t reach ${name} right now.`);
}

/** An email's source, read without following anything in it and with nested mail kept as files. */
export function parseSource(source: Buffer | Uint8Array | ArrayBuffer): Promise<Email> {
  return PostalMime.parse(source, {
    maxNestingDepth: 20,
    maxHeadersSize: 128_000,
    maxRfc822NestingDepth: 0,
    forceRfc822Attachments: true,
  });
}
