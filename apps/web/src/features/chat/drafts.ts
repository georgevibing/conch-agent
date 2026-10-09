import {
  type Attachment,
  DraftList,
  DraftReply,
  NEW_CHAT_DRAFT,
  type PutDraftBody,
  type TurnOptions,
} from '@conch/protocol';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef } from 'react';

import { request } from '../../api/client';
import { NEW } from '../../live/store';
import { loadLocalDraft, localDraftKeys, saveLocalDraft } from './composer';

/**
 * What you were writing and hadn't sent, kept by Conch (ADR 0124): one per
 * chat and one for the new chat page. This device keeps a copy too
 * (`composer.ts`), so the box fills at once and nothing is lost while Conch
 * can't be reached; Conch's copy is what follows you to another browser,
 * your phone, and through a restart.
 */

const draftList = ['drafts'] as const;
/** How long typing pauses before the draft goes to Conch. */
export const DRAFT_SAVE_MS = 700;

const serverKey = (key: string) => (key === NEW ? NEW_CHAT_DRAFT : key);
const draftPath = (key: string) => `/api/conversations/${encodeURIComponent(serverKey(key))}/draft`;

export const draftsApi = {
  list: () => request(DraftList, '/api/drafts'),
  get: (key: string, signal?: AbortSignal) => request(DraftReply, draftPath(key), { signal }),
  put: (key: string, body: PutDraftBody) =>
    request(DraftReply, draftPath(key), { method: 'PUT', body }),
  /** As the page goes away: sent so that it still lands once the tab is gone. */
  putAsLeaving: (key: string, body: PutDraftBody) => {
    try {
      void fetch(draftPath(key), {
        method: 'PUT',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    } catch {
      // Too big to send as the page goes, or no network: this device's copy goes next time.
    }
  },
};

/** The chats with something unsent, here or on another device, by their list key. */
export function useDraftKeys(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: draftList,
    queryFn: draftsApi.list,
    staleTime: 30_000,
  });
  const keys = new Set(data?.drafts.map((d) => d.key) ?? []);
  // What this device has that couldn't reach Conch yet counts too.
  for (const key of localDraftKeys()) keys.add(key === NEW ? NEW_CHAT_DRAFT : key);
  return keys;
}

/** The chat list's mark, kept in step as you write, without waiting to ask Conch again. */
function markList(client: QueryClient, key: string, has: boolean) {
  const at = serverKey(key);
  client.setQueryData<DraftList>(draftList, (old) => {
    // Unchanged, the list isn't told: it draws again only when a mark comes or goes.
    if (!old || old.drafts.some((d) => d.key === at) === has) return old;
    const others = old.drafts.filter((d) => d.key !== at);
    return { drafts: has ? [{ key: at, updatedAt: Date.now() }, ...others] : others };
  });
}

/** A draft as the composer has it. */
export interface KeptDraft {
  text: string;
  /** What's attached and uploaded, in order. */
  attachments: Attachment[];
  /** A new chat's choices; a chat keeps its own. */
  options?: TurnOptions;
}

const empty = (d: Pick<KeptDraft, 'text' | 'attachments'>) =>
  !d.text.trim() && d.attachments.length === 0;

/** What a draft is, for telling whether Conch already has it (a new chat's choices ride along). */
const sign = (d: Pick<KeptDraft, 'text' | 'attachments'>) =>
  JSON.stringify([d.text, d.attachments.map((a) => a.id)]);

const bodyOf = (key: string, d: KeptDraft): PutDraftBody => ({
  text: d.text,
  attachments: d.attachments.map((a) => a.id),
  ...(key === NEW && d.options && Object.keys(d.options).length > 0 && { options: d.options }),
});

/**
 * Keep the composer's draft for `key`, here at once and with Conch shortly
 * after typing pauses (at once when it's cleared, as on send). Opening a chat,
 * and coming back to the tab, takes Conch's copy when this device has nothing
 * newer of its own: what was written on the phone shows here.
 *
 * `adopt` puts a draft from Conch in the box (with the ids it no longer has,
 * so their cards can say so); `lost` names attachments Conch no longer has.
 */
export function useKeptDraft(
  key: string,
  now: KeptDraft,
  on: {
    adopt: (draft: KeptDraft, missing: readonly string[]) => void;
    lost: (ids: readonly string[]) => void;
  },
) {
  const client = useQueryClient();
  /** What Conch has for this key, as far as this tab knows. */
  const synced = useRef<string | undefined>(undefined);
  const pending = useRef<{
    key: string;
    body: PutDraftBody;
    timer: ReturnType<typeof setTimeout>;
  }>(undefined);
  const latest = useRef(now);
  // First, so every effect below reads this render's draft.
  useEffect(() => {
    latest.current = now;
  });
  const signature = sign(now);

  const sent = useEffectEvent((at: string, body: PutDraftBody, reply: DraftReply) => {
    const gone = new Set(reply.missing);
    const ids = (body.attachments ?? []).filter((id) => !gone.has(id));
    const theirs = JSON.stringify([body.text, ids]);
    markList(client, at, Boolean(body.text.trim()) || ids.length > 0);
    // This device's copy is Conch's now, unless it changed since (or as you left).
    const mine = loadLocalDraft(at);
    if (mine && sign({ text: mine.text, attachments: mine.attachments ?? [] }) === theirs)
      saveLocalDraft(at, { ...mine, synced: true });
    if (at !== key) return;
    synced.current = theirs;
    if (reply.missing.length) on.lost(reply.missing);
  });

  const push = useEffectEvent((at: string, body: PutDraftBody) => {
    draftsApi.put(at, body).then(
      (reply) => sent(at, body, reply),
      () => {
        // It stays here, unsent, and goes with the next change or when Conch is back. (A chat
        // deleted elsewhere refuses it: its copy here is never shown again, and soon pushed out.)
      },
    );
  });

  const flush = useEffectEvent((leaving = false) => {
    const waiting = pending.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.current = undefined;
    if (leaving) draftsApi.putAsLeaving(waiting.key, waiting.body);
    else push(waiting.key, waiting.body);
  });

  const schedule = useEffectEvent((at: string, body: PutDraftBody, delay: number) => {
    if (pending.current && pending.current.key !== at) flush();
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { key: at, body, timer: setTimeout(() => flush(), delay) };
  });

  /** Take Conch's copy, unless this device has something newer of its own. */
  const load = useEffectEvent((signal: AbortSignal) => {
    draftsApi.get(key, signal).then(
      (reply) => {
        if (signal.aborted) return;
        const mine = latest.current;
        const dirty = synced.current === undefined || sign(mine) !== synced.current;
        if (dirty) {
          // What's here is newer (written offline, or since it opened): it goes to Conch.
          schedule(key, bodyOf(key, mine), 0);
          return;
        }
        const theirs: KeptDraft = reply.draft
          ? {
              text: reply.draft.text,
              attachments: reply.draft.attachments,
              ...(reply.draft.options && { options: reply.draft.options }),
            }
          : { text: '', attachments: [] };
        synced.current = sign(theirs);
        markList(client, key, !empty(theirs));
        if (sign(theirs) !== sign(mine) || reply.missing.length) on.adopt(theirs, reply.missing);
        saveLocalDraft(key, { ...theirs, synced: true });
      },
      () => {
        // Conch can't be reached: what's here stays, and goes when it can.
      },
    );
  });

  // Opening a chat: what Conch has, unless what's here is newer.
  useEffect(() => {
    const mine = loadLocalDraft(key);
    // Nothing here is the same as Conch having nothing; a copy here says whether it went.
    synced.current = !mine
      ? sign({ text: '', attachments: [] })
      : mine.synced
        ? sign({ text: mine.text, attachments: mine.attachments ?? [] })
        : undefined;
    const abort = new AbortController();
    load(abort.signal);
    return () => abort.abort();
  }, [key]);

  // Every change is kept here at once, and goes to Conch once typing pauses.
  const options = JSON.stringify(now.options ?? null);
  useEffect(() => {
    const current = latest.current;
    const same = signature === synced.current;
    saveLocalDraft(key, { ...current, synced: same });
    if (same) {
      // Typed back to what Conch has: nothing to send.
      if (pending.current?.key === key) {
        clearTimeout(pending.current.timer);
        pending.current = undefined;
      }
      return;
    }
    markList(client, key, !empty(current));
    schedule(key, bodyOf(key, current), empty(current) ? 0 : DRAFT_SAVE_MS);
  }, [key, signature, options, client]);

  // Back to the tab, or back online: send what's waiting, or take what was written elsewhere.
  useEffect(() => {
    let abort: AbortController | undefined;
    const back = () => {
      if (pending.current) return flush();
      if (sign(latest.current) !== synced.current)
        return schedule(key, bodyOf(key, latest.current), 0);
      abort?.abort();
      abort = new AbortController();
      load(abort.signal);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const gone = () => flush(true);
    window.addEventListener('focus', back);
    window.addEventListener('online', back);
    window.addEventListener('pagehide', gone);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      abort?.abort();
      window.removeEventListener('focus', back);
      window.removeEventListener('online', back);
      window.removeEventListener('pagehide', gone);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [key]);

  // Leaving the chat: what was waiting goes now.
  useEffect(() => () => flush(), []);
}
