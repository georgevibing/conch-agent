import { describe, expect, it, vi } from 'vitest';
import type { Doctor, DoctorCheck } from '../doctor/service';
import type { GoogleApps } from './apps';
import type { GoogleService } from './service';
import { registerGoogleDoctor } from './doctor';
describe('Google setup repair', () => {
  it('surfaces a saved app with unfinished consent without trying to authorize in the background', async () => {
    let check: DoctorCheck | undefined;
    const google = {
      status: vi.fn(async () => ({ configured: true, accounts: [] })),
      check: vi.fn(),
    };
    registerGoogleDoctor(
      {
        register: (value: DoctorCheck) => {
          check = value;
        },
      } as unknown as Doctor,
      google as unknown as GoogleService,
    );
    expect(await check?.run({ repair: true, signal: new AbortController().signal })).toEqual([
      expect.objectContaining({
        state: 'needs-you',
        action: { kind: 'open', label: 'Connect Google', place: 'integrations' },
      }),
    ]);
    expect(google.check).not.toHaveBeenCalled();
  });

  it('shows each Google app like any other app, and points at the one that needs a sign-in', async () => {
    let check: DoctorCheck | undefined;
    const accounts = [{ id: 'pw-1', email: 'ada@gmail.com', state: 'needs-auth' }];
    const google = {
      status: vi.fn(async () => ({ configured: false, accounts })),
      check: vi.fn(async () => ({ configured: false, accounts })),
    };
    const apps = {
      refresh: vi.fn(async () => undefined),
      list: vi.fn(async () => [
        {
          id: 'gmail',
          name: 'Gmail',
          enabled: true,
          account: 'ada@gmail.com',
          health: { state: 'needs-auth', message: 'Gmail stopped taking this app password.' },
        },
        { id: 'google-drive', name: 'Google Drive', enabled: false, health: { state: 'off' } },
      ]),
    };
    registerGoogleDoctor(
      { register: (value: DoctorCheck) => (check = value) } as unknown as Doctor,
      google as unknown as GoogleService,
      apps as unknown as GoogleApps,
    );
    expect(await check?.run({ repair: true, signal: new AbortController().signal })).toEqual([
      {
        id: 'integrations:gmail',
        group: 'Integrations',
        title: 'Gmail',
        state: 'needs-you',
        message: 'Gmail stopped taking this app password.',
        action: {
          kind: 'open',
          label: 'Sign in again',
          place: 'integrations',
          focus: 'gmail',
        },
      },
    ]);
    // Repair looked again at the account before saying so.
    expect(google.check).toHaveBeenCalledWith('pw-1');
  });
});
