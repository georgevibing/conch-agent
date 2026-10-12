import { act, renderHook } from '@testing-library/react';
import { ATTACHMENT_LIMITS } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDraftAttachments } from './useDraftAttachments';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('@conch/nacre', async (load) => ({ ...(await load<object>()), toast }));
// Uploads that never finish: what's on the card is all that matters here.
vi.mock('./uploads', () => ({
  uploadAttachment: () => new Promise(() => undefined),
  discardAttachment: vi.fn(),
  attachmentText: vi.fn(),
  fitImage: (file: File) => Promise.resolve(file),
}));

const notes = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => new File([`note ${from + i}`], `note-${from + i}.txt`));

afterEach(() => vi.clearAllMocks());

describe('useDraftAttachments', () => {
  it('two quick drops together still stop at the most a message takes', async () => {
    const { result } = renderHook(() => useDraftAttachments());
    await act(async () => {
      const half = ATTACHMENT_LIMITS.maxCount / 2 + 1;
      await Promise.all([
        result.current.addFiles(notes(half)),
        result.current.addFiles(notes(half, half)),
      ]);
    });
    expect(result.current.drafts.length).toBe(ATTACHMENT_LIMITS.maxCount);
  });

  it('the same file dropped twice at once is attached once', async () => {
    const { result } = renderHook(() => useDraftAttachments());
    await act(async () => {
      await Promise.all([result.current.addFiles(notes(2)), result.current.addFiles(notes(2))]);
    });
    expect(result.current.drafts.map((d) => d.name)).toEqual(['note-0.txt', 'note-1.txt']);
  });
});
