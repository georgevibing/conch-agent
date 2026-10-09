/**
 * Making a Feishu (or Lark) bot by scanning a code (ADR 0120): Feishu's own
 * app registration, the device flow of RFC 8628 that its Node SDK uses
 * (`scene/registration`). Conch asks for a code, shows it, and waits; the
 * person scans it with Feishu on their phone and confirms, and Feishu makes
 * a custom app with a bot, the permissions, the events and the card
 * callback Conch needs, then hands its App ID and App Secret to Conch, with
 * who scanned it. That person is the owner: scanning the code Conch showed
 * on its own page is the hello.
 *
 * Only Feishu's own accounts service is called (accounts.feishu.cn, or
 * accounts.larksuite.com when the scanner's organisation is on Lark).
 */
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type { ChannelEndpoints } from './adapters';
import { ChannelError, pause } from './types';

export const FEISHU_ACCOUNTS = {
  feishu: 'https://accounts.feishu.cn',
  lark: 'https://accounts.larksuite.com',
};

/** What a scanned app may do and hear, filled in for the person. */
export const FEISHU_APP = {
  scopes: {
    tenant: [
      'im:message',
      'im:message:send_as_bot',
      'im:message.p2p_msg:readonly',
      'im:message.group_at_msg:readonly',
      'im:resource',
      'im:chat:readonly',
      'contact:user.base:readonly',
    ],
    user: [],
  },
  events: {
    items: {
      tenant: ['im.message.receive_v1', 'im.chat.access_event.bot_p2p_chat_entered_v1'],
      user: [],
    },
  },
  callbacks: { items: ['card.action.trigger'] },
};

type Region = 'feishu' | 'lark';

export interface FeishuScanResult {
  region: Region;
  appId: string;
  appSecret: string;
  /** Who scanned it, as the new app knows them. */
  openId?: string;
}

export type FeishuScanState =
  | { state: 'waiting'; url: string; expiresAt: number }
  | { state: 'done'; channelId: string }
  | { state: 'expired' | 'denied' | 'failed'; message: string };

interface Scan {
  status: FeishuScanState;
  stop: AbortController;
  at: number;
}

/** The scans in progress, by an id only this Conch's page knows. Each lasts minutes. */
export class FeishuRegistrations {
  #scans = new Map<string, Scan>();

  constructor(
    private readonly endpoints: ChannelEndpoints = {},
    /** Connect the new app, its scanner as the owner; the channel's id back. */
    private readonly onDone: (result: FeishuScanResult) => Promise<string>,
    /** The assistant's name, for the app Feishu makes. */
    private readonly name: () => Promise<string> = async () => 'Conch',
  ) {}

  #base(region: Region) {
    return this.endpoints.feishuAccounts?.[region] ?? FEISHU_ACCOUNTS[region];
  }

  async #post(region: Region, form: Record<string, string>, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(`${this.#base(region)}/oauth/v1/app/registration`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        `Couldn’t reach ${region === 'lark' ? 'Lark' : 'Feishu'} (${(error as Error).message}).`,
      );
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body };
  }

  /** A new code to scan, and the page's id for it. */
  async begin(region: Region): Promise<{ id: string; url: string; expiresAt: number }> {
    this.#sweep();
    if (this.#scans.size >= 5)
      throw new ChannelError(
        'rate-limit',
        'Several codes are already waiting. Use one of those, or wait a minute.',
      );
    const { status, body } = await this.#post(region, {
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id',
    });
    const device = typeof body.device_code === 'string' ? body.device_code : undefined;
    const page =
      typeof body.verification_uri_complete === 'string'
        ? body.verification_uri_complete
        : undefined;
    if (status >= 400 || !device || !page || !/^https?:\/\//.test(page))
      throw new ChannelError(
        'network',
        `${region === 'lark' ? 'Lark' : 'Feishu'} didn’t give a code to scan. Make the app by hand below, or try again.`,
      );
    const url = new URL(page);
    url.searchParams.set('from', 'sdk');
    url.searchParams.set('tp', 'sdk');
    url.searchParams.set('source', 'conch');
    url.searchParams.set('name', (await this.name().catch(() => 'Conch')).slice(0, 40) || 'Conch');
    url.searchParams.set('desc', 'Your assistant, on Conch');
    url.searchParams.set('addons', gzipSync(JSON.stringify(FEISHU_APP)).toString('base64url'));
    const expiresAt = Date.now() + (Number(body.expires_in) || 600) * 1000;
    const id = randomBytes(12).toString('base64url');
    const scan: Scan = {
      status: { state: 'waiting', url: url.toString(), expiresAt },
      stop: new AbortController(),
      at: Date.now(),
    };
    this.#scans.set(id, scan);
    void this.#poll(
      scan,
      region,
      device,
      Math.max(2, Number(body.interval) || 5) * 1000,
      expiresAt,
    );
    return { id, url: url.toString(), expiresAt };
  }

  status(id: string): FeishuScanState | undefined {
    return this.#scans.get(id)?.status;
  }

  cancel(id: string) {
    this.#scans.get(id)?.stop.abort();
    this.#scans.delete(id);
  }

  stop() {
    for (const scan of this.#scans.values()) scan.stop.abort();
    this.#scans.clear();
  }

  #sweep() {
    for (const [id, scan] of this.#scans)
      if (Date.now() - scan.at > 15 * 60_000) {
        scan.stop.abort();
        this.#scans.delete(id);
      }
  }

  async #poll(scan: Scan, first: Region, device: string, every: number, until: number) {
    let region = first;
    let wait = every;
    const signal = scan.stop.signal;
    while (!signal.aborted && Date.now() < until) {
      if (!(await pause(wait, signal))) return;
      let reply: { status: number; body: Record<string, unknown> };
      try {
        reply = await this.#post(region, { action: 'poll', device_code: device }, signal);
      } catch {
        // A blip: the next poll tries again.
        continue;
      }
      const error = typeof reply.body.error === 'string' ? reply.body.error : undefined;
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        wait += 5_000;
        continue;
      }
      if (error === 'access_denied') {
        scan.status = {
          state: 'denied',
          message: 'The code was declined in the app. Show a new one to try again.',
        };
        return;
      }
      if (error === 'expired_token') break;
      const appId = reply.body.client_id;
      const appSecret = reply.body.client_secret;
      const user = (reply.body.user_info ?? {}) as { open_id?: string; tenant_brand?: string };
      // Scanned with Lark: the app lives on Lark's cloud, so ask there.
      if (user.tenant_brand === 'lark' && region === 'feishu' && typeof appId !== 'string') {
        region = 'lark';
        continue;
      }
      if (typeof appId === 'string' && typeof appSecret === 'string') {
        const result: FeishuScanResult = {
          region: user.tenant_brand === 'lark' ? 'lark' : region,
          appId,
          appSecret,
          ...(typeof user.open_id === 'string' &&
            /^ou_[\w-]{4,64}$/.test(user.open_id) && { openId: user.open_id }),
        };
        try {
          scan.status = { state: 'done', channelId: await this.onDone(result) };
        } catch (failure) {
          scan.status = {
            state: 'failed',
            message: failure instanceof Error ? failure.message : 'Couldn’t connect the new app.',
          };
        }
        return;
      }
      if (error) {
        scan.status = {
          state: 'failed',
          message: `Feishu said no (${error}). Make the app by hand below.`,
        };
        return;
      }
    }
    if (!signal.aborted)
      scan.status = { state: 'expired', message: 'That code ran out. Show a new one.' };
  }
}
