import {
  AppCallResult,
  CommunityResults,
  ConchApp,
  ConchAppFound,
  ConchAppPreview,
  ConchAppsList,
  PublishState,
  type AcceptAppOfferBody,
  type InstallAppBody,
  type PreviewAppBody,
} from '@conch/protocol';
import { z } from 'zod';

import { ApiError, request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });
/** The system's Open dialog was closed without a file. */
const Picked = z.union([ConchAppPreview, z.object({ cancelled: z.literal(true) })]);

const at = (id: string) => `/api/conch-apps/${encodeURIComponent(id)}`;

/** Where a page's tools are called: an app you have, or a draft being made in a chat. */
export type PageOwner = { appId: string } | { draftId: string };

const ownerPath = (owner: PageOwner) =>
  'appId' in owner
    ? at(owner.appId)
    : `/api/conch-apps/drafts/${encodeURIComponent(owner.draftId)}`;

/** Apps you make, share and add (ADR 0061). */
export const conchAppsApi = {
  list: async () => (await request(ConchAppsList, '/api/conch-apps')).apps,
  get: (id: string) => request(ConchApp, at(id)),
  community: (q: string, signal?: AbortSignal) =>
    request(CommunityResults, `/api/conch-apps/community?q=${encodeURIComponent(q)}`, { signal }),
  /** What a link or a `.conchapp` holds, before anything is added. */
  preview: (body: PreviewAppBody) =>
    request(ConchAppPreview, '/api/conch-apps/preview', { method: 'POST', body }),
  /** The system's Open dialog, on the computer Conch runs on. Undefined: closed without a file. */
  pick: async () => {
    const picked = await request(Picked, '/api/conch-apps/pick', { method: 'POST', body: {} });
    return 'cancelled' in picked ? undefined : picked;
  },
  install: (body: z.input<typeof InstallAppBody>) =>
    request(ConchApp, '/api/conch-apps/install', { method: 'POST', body }),
  acceptOffer: (offerId: string, body: z.input<typeof AcceptAppOfferBody>) =>
    request(ConchApp, `/api/conch-apps/offers/${encodeURIComponent(offerId)}/accept`, {
      method: 'POST',
      body,
    }),
  declineOffer: (offerId: string, conversationId: string) =>
    request(Ok, `/api/conch-apps/offers/${encodeURIComponent(offerId)}/decline`, {
      method: 'POST',
      body: { conversationId },
    }),
  setPinned: (id: string, pinned: boolean) =>
    request(ConchApp, at(id), { method: 'PATCH', body: { pinned } }),
  remove: (id: string, keepData: boolean) =>
    request(Ok, `${at(id)}${keepData ? '?keepData=1' : ''}`, { method: 'DELETE' }),
  /** A secret is never sent back: the answer says only which settings are saved. */
  setSettings: (id: string, values: Record<string, string>) =>
    request(ConchApp, `${at(id)}/settings`, { method: 'PATCH', body: { values } }),
  updatePreview: (id: string) => request(ConchAppFound, `${at(id)}/update`),
  applyUpdate: (id: string) => request(ConchApp, `${at(id)}/update`, { method: 'POST', body: {} }),
  rollback: (id: string, version: string) =>
    request(ConchApp, `${at(id)}/rollback`, { method: 'POST', body: { version } }),
  publishState: (id: string) => request(PublishState, `${at(id)}/publish`),
  publish: (id: string) => request(PublishState, `${at(id)}/publish`, { method: 'POST', body: {} }),
  call: (owner: PageOwner, tool: string, input: Record<string, unknown>, confirmed: boolean) =>
    request(AppCallResult, `${ownerPath(owner)}/call`, {
      method: 'POST',
      body: { tool, input, confirmed },
    }),
  /**
   * **Save as a file**: the signed `.conchapp`, fetched (so a request to
   * confirm it's you can be answered first) and handed to the browser as a
   * download.
   */
  exportFile: async (id: string): Promise<{ name: string; blob: Blob }> => {
    let response: Response;
    try {
      response = await fetch(`${at(id)}/export`);
    } catch {
      throw new ApiError(0, 'offline', 'Can’t reach Conch. Is the gateway running?');
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      throw new ApiError(
        response.status,
        body.error ?? 'error',
        body.message ?? 'It wasn’t saved.',
      );
    }
    const name =
      /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
      `${id}.conchapp`;
    return { name, blob: await response.blob() };
  },
};

/** A page of an app (or a draft), sealed like an artifact's, in the person's theme and accent. */
export function pageFrameUrl(
  owner: PageOwner,
  pageId: string,
  theme: 'light' | 'dark',
  accent?: string,
) {
  const query = new URLSearchParams({ theme, ...(accent && { accent }) });
  return `${ownerPath(owner)}/pages/${encodeURIComponent(pageId)}/frame?${query.toString()}`;
}

/** Hand a file to the browser as a download, named as given. */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A file the person chose, as base64 for `preview` (a phone, another computer, a drop). */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file couldn’t be read.'));
    reader.onload = () => {
      const text = String(reader.result);
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
