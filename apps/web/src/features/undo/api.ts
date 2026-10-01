import { LatestUndo, UndoPreview, UndoResult } from '@conch/protocol';

import { request } from '../../api/client';

/** Undo (ADR 0030). */
export const undoApi = {
  preview: (ids: string[], direction: 'undo' | 'redo') =>
    request(UndoPreview, '/api/undo/preview', { method: 'POST', body: { ids, direction } }),
  apply: (ids: string[], direction: 'undo' | 'redo', force = false) =>
    request(UndoResult, '/api/undo', { method: 'POST', body: { ids, direction, force } }),
  latest: () => request(LatestUndo, '/api/undo/latest'),
};
