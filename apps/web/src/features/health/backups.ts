import {
  BACKUP_LIMITS,
  Health,
  BackupPreview,
  BackupStatus,
  BackupSummary,
  type CreateBackupBody,
  CreatedBackup,
  type RestoreBackupBody,
  RestoreResult,
} from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, request, SIGNED_OUT_EVENT } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });
const path = (id: string) => `/api/backups/${encodeURIComponent(id)}`;

/** Backups (ADR 0020). Every response is checked against the protocol. */
export const backupApi = {
  status: () => request(BackupStatus, '/api/backups'),
  setAutomatic: (automatic: boolean) =>
    request(BackupStatus, '/api/backups/settings', { method: 'PATCH', body: { automatic } }),
  create: (body: CreateBackupBody) =>
    request(CreatedBackup, '/api/backups', { method: 'POST', body }),
  summary: (id: string) => request(BackupSummary, path(id)),
  /** What restoring it brings, read from its files (and what in it can act for you). */
  preview: (id: string) => request(BackupPreview, `${path(id)}/preview`),
  restore: (id: string, body: RestoreBackupBody) =>
    request(RestoreResult, `${path(id)}/restore`, { method: 'POST', body }),
  cancelPending: () => request(Ok, '/api/backups/pending', { method: 'DELETE' }),
  discard: (id: string) => request(Ok, path(id), { method: 'DELETE' }),
  downloadUrl: (id: string) => `${path(id)}/download`,
};

export const backupKeys = { status: ['backups'] as const };

/** Whether Conch can start itself again (it runs under `pnpm start`). */
export function useRestartable() {
  return useQuery({
    queryKey: ['backups', 'restartable'],
    queryFn: () => request(Health, '/api/health'),
    staleTime: 60_000,
    select: (health) => health.restartable,
  });
}

/** Where backups stand, kept fresh by the `backups.changed` event. */
export function useBackups() {
  return useQuery({ queryKey: backupKeys.status, queryFn: backupApi.status, staleTime: 30_000 });
}

/** Save a backup file: the browser downloads it from the gateway, streamed, never held here. */
export function downloadBackup(id: string): void {
  const link = document.createElement('a');
  link.href = backupApi.downloadUrl(id);
  link.download = '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Upload a backup file to restore from (raw bytes, like attachments —
 * ADR 0017), reporting progress. The gateway checks its header and answers
 * with what's in it.
 */
export function uploadBackup(
  file: Blob,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<BackupSummary> {
  if (file.size > BACKUP_LIMITS.maxArchiveBytes)
    return Promise.reject(
      new ApiError(413, 'too-big', 'That file is over 2 GB, too big to be a Conch backup.'),
    );
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/backups/upload');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = BackupSummary.safeParse(json);
        if (parsed.success) return resolve(parsed.data);
        return reject(new ApiError(xhr.status, 'bad-response', 'Conch sent back something odd.'));
      }
      if (xhr.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
      const body = (json ?? {}) as { error?: string; message?: string };
      reject(
        new ApiError(xhr.status, body.error ?? 'error', body.message ?? 'Couldn’t read that file.'),
      );
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'offline', 'Couldn’t reach Conch. Check the connection.'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
