import { describe, expect, it, vi } from 'vitest';
import type { Doctor, DoctorCheck } from '../doctor/service';
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
});
