import {
  Artifact,
  ArtifactContent,
  ArtifactDraft,
  ArtifactList,
  LiveDataApprovals,
  LiveDataInfo,
  LiveDataResult,
  type ArtifactVersionRef,
  type LiveDataRequest,
  type SaveArtifactVersionBody,
  type UpdateArtifactBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });
const Started = z.object({ conversationId: z.string() });

const at = (id: string) => `/api/artifacts/${encodeURIComponent(id)}`;

/** Show me (ADR 0034), edited by hand and with live data (ADR 0039). */
export const artifactsApi = {
  list: async () => (await request(ArtifactList, '/api/artifacts')).artifacts,
  get: (id: string) => request(Artifact, at(id)),
  version: (id: string, n: number) => request(ArtifactContent, `${at(id)}/versions/${n}`),
  update: (id: string, body: UpdateArtifactBody) =>
    request(Artifact, at(id), { method: 'PATCH', body }),
  remove: (id: string) => request(Ok, at(id), { method: 'DELETE' }),
  refresh: (id: string) => request(Started, `${at(id)}/refresh`, { method: 'POST', body: {} }),
  /** A version you made by hand. */
  save: (id: string, body: SaveArtifactVersionBody) =>
    request(Artifact, `${at(id)}/versions`, { method: 'POST', body }),
  /** The page you're editing, so its preview is served sealed like a saved one. */
  draft: (id: string, content: string) =>
    request(ArtifactDraft, `${at(id)}/draft`, { method: 'PUT', body: { content } }),
  liveInfo: (id: string, version: ArtifactVersionRef) =>
    request(LiveDataInfo, `${at(id)}/versions/${version}/live-data`),
  liveRead: (id: string, version: ArtifactVersionRef, body: LiveDataRequest) =>
    request(LiveDataResult, `${at(id)}/versions/${version}/live-data`, { method: 'POST', body }),
  allow: (id: string, body: { version: ArtifactVersionRef; host: string; local?: boolean }) =>
    request(LiveDataInfo, `${at(id)}/live-data`, { method: 'POST', body }),
  revoke: (id: string, host: string) =>
    request(Ok, `${at(id)}/live-data/${encodeURIComponent(host)}`, { method: 'DELETE' }),
  approvals: async () => (await request(LiveDataApprovals, '/api/live-data')).approvals,
};

/** The sealed page (ADR 0034): opaque origin, no network, framed only by Conch. */
export const frameUrl = (id: string, n: number, theme: 'light' | 'dark') =>
  `${at(id)}/versions/${n}/frame?theme=${theme}`;

/** The page you're editing, sealed the same way; `rev` makes each change a new load. */
export const draftFrameUrl = (id: string, rev: number, theme: 'light' | 'dark') =>
  `${at(id)}/versions/draft/frame?theme=${theme}&rev=${rev}`;

export const downloadUrl = (id: string, n: number) => `${at(id)}/versions/${n}/download`;
