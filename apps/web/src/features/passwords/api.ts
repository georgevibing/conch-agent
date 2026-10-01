import {
  BreachCheckResult,
  type ImportFormat,
  ImportPreview,
  PasswordHistory,
  Revealed,
  type SaveVaultItemBody,
  TotpCode,
  VaultItemDetail,
  VaultList,
  VaultLockState,
  type VaultFieldKind,
  type VaultFieldRole,
  KeePassDatabase,
  VaultSource,
  type VaultSourceId,
  VaultTransferJob,
  VaultTransferPreview,
} from '@conch/protocol';
import { z } from 'zod';

import { ApiError, request, SIGNED_OUT_EVENT } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

export const vaultApi = {
  list: () => request(VaultList, '/api/vault'),
  item: (id: string) => request(VaultItemDetail, `/api/vault/items/${encodeURIComponent(id)}`),
  create: (body: SaveVaultItemBody) =>
    request(VaultItemDetail, '/api/vault/items', { method: 'POST', body }),
  update: (id: string, body: SaveVaultItemBody) =>
    request(VaultItemDetail, `/api/vault/items/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  patch: (id: string, body: { favorite?: boolean; tags?: string[] }) =>
    request(Ok, `/api/vault/items/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  reveal: (id: string, fieldId: string, copy = false) =>
    request(Revealed, `/api/vault/items/${encodeURIComponent(id)}/reveal`, {
      method: 'POST',
      body: { fieldId, copy },
    }),
  totp: (id: string, fieldId?: string) =>
    request(TotpCode, `/api/vault/items/${encodeURIComponent(id)}/totp`, {
      method: 'POST',
      body: fieldId ? { fieldId } : {},
    }),
  history: (id: string) =>
    request(PasswordHistory, `/api/vault/items/${encodeURIComponent(id)}/history`),
  trash: (ids: string[]) => request(Ok, '/api/vault/trash', { method: 'POST', body: { ids } }),
  restore: (ids: string[]) => request(Ok, '/api/vault/restore', { method: 'POST', body: { ids } }),
  purge: (ids?: string[]) =>
    request(z.object({ removed: z.number() }), '/api/vault/purge', {
      method: 'POST',
      body: ids ? { ids } : {},
    }),
  importFile: (body: {
    format: ImportFormat;
    text: string;
    commit: boolean;
    skipDuplicates: boolean;
  }) => request(ImportPreview, '/api/vault/import', { method: 'POST', body }),
  breaches: () => request(BreachCheckResult, '/api/vault/breaches', { method: 'POST', body: {} }),
  setSource: (id: VaultSourceId, body: { enabled?: boolean; database?: string }) =>
    request(z.array(VaultSource), `/api/vault/sources/${id}`, { method: 'PATCH', body }),
  unlockSource: (id: VaultSourceId, password: string) =>
    request(z.array(VaultSource), `/api/vault/sources/${id}/unlock`, {
      method: 'POST',
      body: { password },
    }),
  lockSource: (id: VaultSourceId) =>
    request(Ok, `/api/vault/sources/${id}/lock`, { method: 'POST', body: {} }),
  transferPreview: (id: VaultSourceId, ids?: string[]) =>
    request(VaultTransferPreview, `/api/vault/sources/${id}/transfer`, {
      method: 'POST',
      body: { commit: false, ...(ids && { ids }) },
    }),
  transfer: (
    id: VaultSourceId,
    body: { ids?: string[]; skipDuplicates: boolean; keepSynced: boolean },
  ) =>
    request(VaultTransferJob, `/api/vault/sources/${id}/transfer`, {
      method: 'POST',
      body: { ...body, commit: true },
    }),
  transferJob: (jobId: string) =>
    request(VaultTransferJob, `/api/vault/transfers/${encodeURIComponent(jobId)}`),
  cancelTransfer: (jobId: string) =>
    request(Ok, `/api/vault/transfers/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      body: {},
    }),
  setSync: (id: VaultSourceId, enabled: boolean) =>
    request(z.array(VaultSource), `/api/vault/sources/${id}/sync`, {
      method: 'PATCH',
      body: { enabled },
    }),
  syncNow: (id: VaultSourceId) =>
    request(z.array(VaultSource), `/api/vault/sources/${id}/sync`, { method: 'POST', body: {} }),
  keepassDatabases: () =>
    request(z.array(KeePassDatabase), '/api/vault/sources/keepassxc/databases'),
  removePasskey: (id: string, passkeyId: string) =>
    request(
      Ok,
      `/api/vault/items/${encodeURIComponent(id)}/passkeys/${encodeURIComponent(passkeyId)}`,
      { method: 'DELETE' },
    ),
  unlock: (password: string) =>
    request(Ok, '/api/vault/unlock', { method: 'POST', body: { password } }),
  lock: () => request(Ok, '/api/vault/lock', { method: 'POST', body: {} }),
  setLock: (body: { enabled?: boolean; password?: string; autoLockMinutes?: number }) =>
    request(VaultLockState, '/api/vault/lock', { method: 'PATCH', body }),
  answer: (
    id: string,
    body: {
      title: string;
      fields: { label: string; kind: VaultFieldKind; role?: VaultFieldRole; value: string }[];
      urls?: string[];
    },
  ) =>
    request(z.object({ itemId: z.string() }), `/api/vault/requests/${encodeURIComponent(id)}`, {
      method: 'POST',
      body,
    }),
  decline: (id: string) =>
    request(Ok, `/api/vault/requests/${encodeURIComponent(id)}/decline`, {
      method: 'POST',
      body: {},
    }),
  /** Every password as a CSV file, downloaded. */
  async exportCsv(): Promise<Blob> {
    const response = await fetch('/api/vault/export', { method: 'POST' });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (response.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
      throw new ApiError(
        response.status,
        body.error ?? 'error',
        body.message ?? 'Couldn’t export.',
      );
    }
    return response.blob();
  },
};
