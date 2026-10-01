import { ActivityPage, SafetyStatus, type ActivityKind } from '@conch/protocol';

import { request } from '../../api/client';

/** Safe hands (ADR 0028). */
export const safetyApi = {
  status: () => request(SafetyStatus, '/api/safety'),
  activity: (options: { before?: number; kind?: ActivityKind } = {}) => {
    const params = new URLSearchParams();
    if (options.before) params.set('before', String(options.before));
    if (options.kind) params.set('kind', options.kind);
    const query = params.toString();
    return request(ActivityPage, `/api/activity${query ? `?${query}` : ''}`);
  },
};

export const safetyKeys = {
  status: ['safety'] as const,
  activity: (kind?: ActivityKind) => ['activity', kind ?? 'all'] as const,
};
