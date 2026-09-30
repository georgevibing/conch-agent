import type { BackupStatus, BackupSummary } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import type * as Backups from './backups';
import { BackupSection } from './BackupSection';

const upload = vi.hoisted(() => vi.fn());
vi.mock('./backups', async (original) => ({
  ...(await original<typeof Backups>()),
  uploadBackup: upload,
}));

const HOUR = 60 * 60 * 1000;

const contents = {
  settings: true,
  memories: 12,
  commands: 4,
  routines: 3,
  skills: 2,
  integrations: 5,
  integrationsSigningIn: 5,
  chats: 240,
  attachments: 18,
};

const backup = (patch: Partial<BackupSummary> = {}): BackupSummary => ({
  id: 'auto-20260930-031200',
  kind: 'automatic',
  createdAt: Date.now() - 2 * HOUR,
  conchVersion: '0.2.0',
  size: 48 * 1024 * 1024,
  contents,
  downloadable: true,
  ...patch,
});

const status = (patch: Partial<BackupStatus> = {}): BackupStatus => ({
  automatic: true,
  lastAutomaticAt: Date.now() - 2 * HOUR,
  backups: [backup()],
  chats: { count: 240, bytes: 48 * 1024 * 1024 },
  ...patch,
});

const health = {
  ok: true,
  serverVersion: '0.2.0',
  protocolVersion: 7,
  bootId: 'b1',
  restartable: true,
};
const auth = { method: 'none', signedIn: true, setupRequired: false, secure: true };

function routes(current: BackupStatus, extra: Record<string, (body: unknown) => unknown> = {}) {
  return mockFetch({
    'GET /api/backups': () => current,
    'GET /api/health': () => health,
    'GET /api/auth': () => auth,
    'GET /api/access': () => ({}),
    ...extra,
  });
}

let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  upload.mockReset();
  useUi.setState({ restarting: undefined, settingsFocus: undefined });
});

describe('Settings → Health → Backups', () => {
  it('says it’s backed up, lists the backups, and turns daily backups off', async () => {
    const user = userEvent.setup();
    const calls = routes(status(), {
      'PATCH /api/backups/settings': (body) =>
        status({ automatic: (body as { automatic: boolean }).automatic }),
    });
    renderApp(<BackupSection />);
    const overview = await screen.findByRole('region', { name: 'Backed up automatically' });
    await waitFor(() =>
      expect(overview).toHaveTextContent(/Last backup today at .* · 1 kept · 48 MB/),
    );
    const list = screen.getByRole('list', { name: 'Backups on this computer' });
    expect(list).toHaveTextContent(
      '12 memories · 3 routines · 2 skills · 5 integrations · 240 chats · 48 MB',
    );

    await user.click(screen.getByRole('switch', { name: 'Back up automatically every day' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/api/backups/settings',
        body: { automatic: false },
      }),
    );
    expect(
      await screen.findByRole('region', { name: 'Automatic backups are off' }),
    ).toBeInTheDocument();
  });

  it('says why the last backup didn’t happen, calmly', async () => {
    routes(status({ problem: 'There isn’t enough free space on this computer for a backup.' }));
    renderApp(<BackupSection />);
    expect(
      await screen.findByRole('region', { name: 'The last backup didn’t happen' }),
    ).toHaveTextContent('There isn’t enough free space');
  });

  it('downloads a backup with keys locked by a passphrase typed twice', async () => {
    const user = userEvent.setup();
    const calls = routes(status(), {
      'POST /api/backups': () => ({
        id: 'export-abc123',
        name: 'Conch backup 2026-09-30.conchbackup',
        size: 1024,
      }),
    });
    renderApp(<BackupSection />);
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Back up your Conch' });
    expect(
      within(dialog).getByText('240 chats and the files sent in them · 48 MB'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('switch', { name: 'Include keys and sign-ins' }));
    const download = within(dialog).getByRole('button', { name: 'Download backup' });
    expect(download).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Passphrase'),
      'seven lemons sail past the harbour',
    );
    expect(within(dialog).getByRole('meter', { name: 'Passphrase strength' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/\bpassword\b/)).toBeNull();
    await user.type(within(dialog).getByLabelText('Passphrase again'), 'seven lemons');
    expect(within(dialog).getByText('The two don’t match yet.')).toBeInTheDocument();
    expect(download).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Passphrase again'), ' sail past the harbour');
    await user.click(download);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/backups',
        body: { chats: true, passphrase: 'seven lemons sail past the harbour' },
      }),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/backups/export-abc123/download');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks you to confirm it’s you before taking keys out, then carries on', async () => {
    const user = userEvent.setup();
    let verified = false;
    const calls = routes(status(), {
      'GET /api/auth': () => ({ ...auth, method: 'password' }),
      'POST /api/backups': () =>
        verified
          ? { id: 'export-abc123', name: 'Conch backup 2026-09-30.conchbackup', size: 1024 }
          : new Response(
              JSON.stringify({ error: 'verify-required', message: 'Confirm it’s you.' }),
              { status: 403 },
            ),
      'POST /api/access/verify': () => {
        verified = true;
        return {
          method: 'password',
          username: 'ada',
          suggestedUsername: 'ada',
          keys: [],
          sessions: [],
          checkup: [],
          exposure: 'local',
          port: 4317,
          urls: [],
          verified: true,
        };
      },
    });
    renderApp(<BackupSection />);
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Back up your Conch' });
    await user.click(within(dialog).getByRole('switch', { name: 'Include keys and sign-ins' }));
    await user.type(
      within(dialog).getByLabelText('Passphrase'),
      'seven lemons sail past the harbour',
    );
    await user.type(
      within(dialog).getByLabelText('Passphrase again'),
      'seven lemons sail past the harbour',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Download backup' }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    await user.type(within(confirm).getByLabelText('Password'), 'purple otters juggle at dawn');
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/backups' && c.method === 'POST')).toHaveLength(2),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
  });
});

describe('restoring', () => {
  it('previews a backup in plain words, then restores and waits for Conch', async () => {
    const user = userEvent.setup();
    const calls = routes(status(), {
      'POST /api/backups/auto-20260930-031200/restore': () => ({ restarting: true }),
    });
    renderApp(<BackupSection />);
    await user.click(
      await screen.findByRole('button', { name: /^Restore the backup from Today at/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(within(dialog).getByText(/^From /)).toBeInTheDocument();
    const list = within(dialog).getByRole('list', { name: 'What this backup brings back' });
    expect(list).toHaveTextContent('12 memories');
    expect(list).toHaveTextContent('5 integrations · you’ll sign in to them again');
    expect(list).toHaveTextContent('240 chats');
    expect(within(dialog).getByText(/kept first, so you can undo this/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Passphrase')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/backups/auto-20260930-031200/restore',
        body: { skipSecrets: false },
      }),
    );
    await waitFor(() =>
      expect(useUi.getState().restarting).toEqual({ title: 'Restoring your Conch…', from: 'b1' }),
    );
    expect(sessionStorage.getItem('conch.restoring')).toContain('"at"');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('restores from a file: checks it, asks for its passphrase, and says so when it’s wrong', async () => {
    const user = userEvent.setup();
    const uploaded = backup({
      id: 'upload-1a2b3c',
      kind: 'uploaded',
      downloadable: false,
      contents: { ...contents, secrets: 'passphrase' },
    });
    let resolveUpload: (b: BackupSummary) => void = () => undefined;
    upload.mockImplementation(
      (_file: File, options: { onProgress?: (n: number) => void }) =>
        new Promise<BackupSummary>((resolve) => {
          options.onProgress?.(0.5);
          resolveUpload = resolve;
        }),
    );
    let tries = 0;
    const calls = routes(status(), {
      'POST /api/backups/upload-1a2b3c/restore': () =>
        ++tries === 1
          ? new Response(
              JSON.stringify({
                error: 'wrong-passphrase',
                message: 'That passphrase doesn’t open this backup.',
              }),
              { status: 400 },
            )
          : {
              restarting: false,
              message:
                'Your backup is ready to restore. Restart Conch to finish: stop it (Ctrl+C) and run pnpm start again.',
            },
      'DELETE /api/backups/upload-1a2b3c': () => ({ ok: true }),
    });
    const { container } = renderApp(<BackupSection />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await user.upload(input, new File(['x'], 'Conch backup 2026-09-30.conchbackup'));
    const checking = await screen.findByRole('dialog', { name: 'Restore from a file' });
    expect(
      within(checking).getByText('Checking Conch backup 2026-09-30.conchbackup…'),
    ).toBeInTheDocument();
    act(() => resolveUpload(uploaded));

    const dialog = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(within(dialog).getByRole('list')).toHaveTextContent(
      'Your keys and sign-ins · with your passphrase',
    );
    const restore = within(dialog).getByRole('button', { name: 'Restore' });
    expect(restore).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Passphrase'), 'the wrong one entirely');
    await user.click(restore);
    expect(
      await within(dialog).findByText('That passphrase doesn’t open this backup.'),
    ).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Passphrase'));
    await user.type(
      within(dialog).getByLabelText('Passphrase'),
      'seven lemons sail past the harbour',
    );
    await user.click(restore);
    expect(await screen.findByRole('dialog', { name: 'Almost done' })).toHaveTextContent(
      'Restart Conch to finish',
    );
    expect(calls.filter((c) => c.path.endsWith('/restore')).map((c) => c.body)).toEqual([
      { passphrase: 'the wrong one entirely', skipSecrets: false },
      { passphrase: 'seven lemons sail past the harbour', skipSecrets: false },
    ]);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    // Restored from: nothing to throw away.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('goes on without the keys when the passphrase is forgotten, and lets go of an unused upload', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(
      backup({
        id: 'upload-1a2b3c',
        kind: 'uploaded',
        downloadable: false,
        contents: { ...contents, secrets: 'passphrase' },
      }),
    );
    const calls = routes(status(), { 'DELETE /api/backups/upload-1a2b3c': () => ({ ok: true }) });
    const { container } = renderApp(<BackupSection />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await user.upload(input, new File(['x'], 'b.conchbackup'));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await user.click(within(dialog).getByRole('button', { name: /Forgot it\?/ }));
    expect(within(dialog).getByRole('list')).toHaveTextContent('Keys and sign-ins left out');
    expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'DELETE',
        path: '/api/backups/upload-1a2b3c',
        body: undefined,
      }),
    );
  });

  it('says plainly when a file isn’t a backup, and offers another', async () => {
    // Someone can pick any file (“All files”); the gateway is what says no.
    const user = userEvent.setup({ applyAccept: false });
    const { ApiError } = await import('../../api/client');
    upload.mockRejectedValue(new ApiError(400, 'not-backup', 'That file isn’t a Conch backup.'));
    routes(status());
    const { container } = renderApp(<BackupSection />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await user.upload(input, new File(['x'], 'holiday.jpg'));
    const dialog = await screen.findByRole('dialog', { name: 'Restore from a file' });
    expect(await within(dialog).findByText('That file isn’t a Conch backup.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Choose another file' })).toBeInTheDocument();
  });

  it('offers Undo after a restore, through the same preview', async () => {
    const user = userEvent.setup();
    const undo = backup({
      id: 'undo-20260930-140200',
      kind: 'before-restore',
      downloadable: false,
      contents: { ...contents, secrets: 'local' },
    });
    const calls = routes(
      status({
        backups: [undo, backup()],
        restored: {
          at: Date.now() - 60_000,
          from: { kind: 'uploaded', createdAt: Date.now() - 48 * HOUR },
          undoId: undo.id,
        },
      }),
      { [`POST /api/backups/${undo.id}/restore`]: () => ({ restarting: true }) },
    );
    renderApp(<BackupSection />);
    expect(await screen.findByText(/^Restored a backup from/)).toBeInTheDocument();
    // The Undo copy is in the list too, and never offered for download.
    expect(screen.getByText('Before a restore')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Download the backup from .* 2:02/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo restore' }));
    const dialog = await screen.findByRole('dialog', { name: 'Undo the restore?' });
    expect(dialog).toHaveTextContent('just before the restore');
    await user.click(within(dialog).getByRole('button', { name: 'Undo restore' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === `/api/backups/${undo.id}/restore`)).toBe(true),
    );
    await waitFor(() => expect(useUi.getState().restarting?.title).toBe('Restoring your Conch…'));
  });

  it('says when a restore waits for Conch to start again, and can call it off', async () => {
    const user = userEvent.setup();
    const calls = routes(status({ pending: { kind: 'uploaded', createdAt: Date.now() - HOUR } }), {
      'DELETE /api/backups/pending': () => ({ ok: true }),
      'POST /api/gateway/restart': () => ({ ok: true }),
    });
    renderApp(<BackupSection />);
    expect(await screen.findByText('Restart Conch to finish restoring')).toBeInTheDocument();
    // This Conch can start itself again, so that's one button.
    await user.click(await screen.findByRole('button', { name: 'Restart now' }));
    await waitFor(() =>
      expect(useUi.getState().restarting).toEqual({ title: 'Restoring your Conch…', from: 'b1' }),
    );
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/gateway/restart')).toBe(true);
    act(() => useUi.setState({ restarting: undefined }));
    await user.click(screen.getByRole('button', { name: 'Cancel restore' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'DELETE',
        path: '/api/backups/pending',
        body: undefined,
      }),
    );
  });

  it('says how to finish by hand where Conch can’t start itself again', async () => {
    routes(status({ pending: { kind: 'uploaded', createdAt: Date.now() - HOUR } }), {
      'GET /api/health': () => ({ ...health, restartable: false }),
    });
    renderApp(<BackupSection />);
    expect(
      await screen.findByText(/Stop Conch \(Ctrl\+C\) and run pnpm start again/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
  });

  it('opens Back up now from ⌘K, by name', async () => {
    routes(status());
    useUi.setState({ settingsFocus: 'backup' });
    renderApp(<BackupSection />);
    expect(await screen.findByRole('dialog', { name: 'Back up your Conch' })).toBeInTheDocument();
  });
});
