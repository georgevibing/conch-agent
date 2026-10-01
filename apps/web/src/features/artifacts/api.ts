import { Artifact, ArtifactContent, ArtifactList, type UpdateArtifactBody } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });
const Started = z.object({ conversationId: z.string() });

/** Show me (ADR 0034). */
export const artifactsApi = {
  list: async () => (await request(ArtifactList, '/api/artifacts')).artifacts,
  get: (id: string) => request(Artifact, `/api/artifacts/${encodeURIComponent(id)}`),
  version: (id: string, n: number) =>
    request(ArtifactContent, `/api/artifacts/${encodeURIComponent(id)}/versions/${n}`),
  update: (id: string, body: UpdateArtifactBody) =>
    request(Artifact, `/api/artifacts/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) =>
    request(Ok, `/api/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  refresh: (id: string) =>
    request(Started, `/api/artifacts/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
      body: {},
    }),
};

/** The sealed page (ADR 0034): opaque origin, no network, framed only by Conch. */
export const frameUrl = (id: string, n: number, theme: 'light' | 'dark') =>
  `/api/artifacts/${encodeURIComponent(id)}/versions/${n}/frame?theme=${theme}`;

export const downloadUrl = (id: string, n: number) =>
  `/api/artifacts/${encodeURIComponent(id)}/versions/${n}/download`;
