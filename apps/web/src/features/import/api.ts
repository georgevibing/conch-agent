import {
  ImportPlan,
  ImportResult,
  ImportStatus,
  UndoImportResult,
  type ImportSourceId,
} from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { request } from '../../api/client';

/** Come home (ADR 0035). Every response is checked against the protocol. */
export const importApi = {
  status: () => request(ImportStatus, '/api/import'),
  plan: (source: ImportSourceId) =>
    request(ImportPlan, `/api/import/${encodeURIComponent(source)}`),
  run: (source: ImportSourceId, items: string[]) =>
    request(ImportResult, '/api/import', { method: 'POST', body: { source, items } }),
  undo: () => request(UndoImportResult, '/api/import/undo', { method: 'POST', body: {} }),
};

export const importKeys = { status: ['import'] as const };

/** The other agents on this computer, and the last import while it can be undone. */
export function useImportStatus(enabled = true) {
  return useQuery({
    queryKey: importKeys.status,
    queryFn: importApi.status,
    staleTime: 60_000,
    enabled,
  });
}

/** Where an import is, from the `import.progress` event. */
export const useImportProgress = create<{
  done: number;
  total: number;
  current?: string;
}>(() => ({ done: 0, total: 0 }));

/** Settings → Memory opens Come home with this focus (Repair everything, ⌘K). */
export const COME_HOME_FOCUS = 'come-home';
