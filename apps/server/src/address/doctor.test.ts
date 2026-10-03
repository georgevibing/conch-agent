import { describe, expect, it, vi } from 'vitest';

import { addressCheck } from './doctor';
import type { AddressStatus } from './service';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const DAY = 86_400_000;
const signal = new AbortController().signal;

function service(status: AddressStatus, after: AddressStatus = status) {
  return {
    status: vi.fn(() => status),
    renew: vi.fn(async () => after),
    restart: vi.fn(async () => after),
  };
}

const ready = (days: number, extra: Partial<AddressStatus> = {}): AddressStatus => ({
  state: 'ready',
  name: 'conch.example.com',
  url: 'https://conch.example.com',
  certificate: { notAfter: NOW + days * DAY, issuer: 'Let’s Encrypt' },
  ...extra,
});

describe('addressCheck', () => {
  it('says nothing when there’s no address', async () => {
    expect(
      await addressCheck(service({ state: 'off' }), () => NOW).run({ repair: false, signal }),
    ).toEqual([]);
  });

  it('is ok with a certificate that has time left', async () => {
    const [item] = await addressCheck(service(ready(60)), () => NOW).run({ repair: false, signal });
    expect(item).toMatchObject({
      state: 'ok',
      message: expect.stringMatching(/good for 60 more days/),
    });
  });

  it('warns when the certificate is running out and renewing fails', async () => {
    const status = ready(3, { problem: { kind: 'unreachable', message: 'Port 80 is closed.' } });
    const [item] = await addressCheck(service(status), () => NOW).run({ repair: false, signal });
    expect(item).toMatchObject({
      state: 'warning',
      message: expect.stringMatching(/runs out in 3 days.*Port 80/),
    });
  });

  it('renews on repair, and says it fixed it', async () => {
    const svc = service(ready(3, { problem: { kind: 'unreachable', message: 'x' } }), ready(90));
    const [item] = await addressCheck(svc, () => NOW).run({ repair: true, signal });
    expect(svc.renew).toHaveBeenCalled();
    expect(item).toMatchObject({ state: 'fixed', message: expect.stringMatching(/renewed/) });
  });

  it('reopens the ports first, then gives the one command if it still can’t', async () => {
    const problem: AddressStatus = {
      state: 'problem',
      name: 'conch.example.com',
      problem: {
        kind: 'ports-privilege',
        message: 'Not allowed on port 80.',
        command: 'sudo setcap x',
      },
    };
    const svc = service(problem);
    const [item] = await addressCheck(svc, () => NOW).run({ repair: true, signal });
    expect(svc.restart).toHaveBeenCalled();
    expect(item).toMatchObject({
      state: 'needs-you',
      action: { kind: 'command', command: 'sudo setcap x' },
    });
  });

  it('asks a person to turn on an address from another computer', async () => {
    const svc = service({
      state: 'problem',
      name: 'conch.example.com',
      problem: { kind: 'another-computer', message: 'Set up on another computer.' },
    });
    const [item] = await addressCheck(svc, () => NOW).run({ repair: true, signal });
    expect(svc.renew).not.toHaveBeenCalled();
    expect(item).toMatchObject({ state: 'needs-you', action: { kind: 'open', place: 'security' } });
  });

  it('is only a warning while Let’s Encrypt is unavailable', async () => {
    const svc = service({
      state: 'problem',
      name: 'conch.example.com',
      problem: { kind: 'ca-unavailable', message: 'Conch couldn’t reach Let’s Encrypt.' },
    });
    const [item] = await addressCheck(svc, () => NOW).run({ repair: false, signal });
    expect(item?.state).toBe('warning');
  });
});
