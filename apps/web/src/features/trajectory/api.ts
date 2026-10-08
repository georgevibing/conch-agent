import {
  RunTimeline,
  TrajectoryExportResult,
  TrajectoryPreview,
  type TrajectoryExportBody,
} from '@conch/protocol';
import { create } from 'zustand';

import { request } from '../../api/client';

/** How I did it (ADR 0113): a chat's timeline, and saving chats as a file on this computer. */
export const trajectoryApi = {
  timeline: (id: string) =>
    request(RunTimeline, `/api/conversations/${encodeURIComponent(id)}/timeline`),
  preview: (body: TrajectoryExportBody, signal?: AbortSignal) =>
    request(TrajectoryPreview, '/api/trajectories/preview', { method: 'POST', body, signal }),
  save: (body: TrajectoryExportBody) =>
    request(TrajectoryExportResult, '/api/trajectories/export', { method: 'POST', body }),
};

export const trajectoryKeys = {
  timeline: (id: string) => ['trajectory', 'timeline', id] as const,
  preview: (body: TrajectoryExportBody) => ['trajectory', 'preview', body] as const,
};

/** Which chat's timeline is open, and what's being saved: one chat, or a batch. */
interface HowItDidIt {
  runFor: string | null;
  /** `{}` is a batch; with a chat, just that one. */
  saving: { conversationId?: string } | null;
  openRun(conversationId: string): void;
  closeRun(): void;
  openSave(scope: { conversationId?: string }): void;
  closeSave(): void;
}

export const useHowItDidIt = create<HowItDidIt>((set) => ({
  runFor: null,
  saving: null,
  openRun: (runFor) => set({ runFor }),
  closeRun: () => set({ runFor: null }),
  openSave: (saving) => set({ saving }),
  closeSave: () => set({ saving: null }),
}));
