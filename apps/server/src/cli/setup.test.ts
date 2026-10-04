import type { AddressStatus, DnsReport } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Prompts } from './prompts';
import { setup, type Reach, type SetupDeps } from './setup';
import { captureUi } from './ui';

/**
 * `conch setup` (ADR 0064), every path with pretend pieces: what it asks,
 * what it waits for, what it runs with sudo (only with a yes), and the link
 * it ends with.
 */

const NAME = 'conch.example.com';
const HERE = '203.0.113.7';

function report(pointing: DnsReport['pointing']): DnsReport {
  return {
    name: NAME,
    mine: { v4: HERE },
    found: { v4: pointing === 'here' ? [HERE] : [], v6: [] },
    pointing,
    message: pointing === 'here' ? `${NAME} points here.` : `${NAME} doesn’t point anywhere yet.`,
    advice: pointing === 'here' ? [] : [{ type: 'A', host: 'conch', name: NAME, value: HERE }],
  };
}

const ready: AddressStatus = {
  state: 'ready',
  name: NAME,
  url: `https://${NAME}`,
  certificate: { notAfter: Date.now() + 80 * 86_400_000, issuer: 'Let’s Encrypt' },
};

/** Answers in order, as the person would type them. */
function prompts(
  answers: { choose?: Reach; ask?: string[]; confirm?: boolean[] } = {},
  interactive = true,
) {
  const asked: string[] = [];
  const ask = [...(answers.ask ?? [])];
  const confirm = [...(answers.confirm ?? [])];
  return {
    asked,
    prompts: {
      interactive,
      choose: vi.fn(async (question: string) => {
        asked.push(question);
        return answers.choose;
      }),
      ask: vi.fn(async (question: string) => {
        asked.push(question);
        return ask.shift();
      }),
      confirm: vi.fn(async (question: string) => {
        asked.push(question);
        return confirm.shift() ?? false;
      }),
      close: vi.fn(),
    } as unknown as Prompts,
  };
}

function deps(
  over: Partial<SetupDeps> = {},
  answers?: Parameters<typeof prompts>[0],
  interactive = true,
) {
  const { ui, text } = captureUi();
  const typed = prompts(answers, interactive);
  let now = 1_700_000_000_000;
  const set = vi.fn(async () => ({ state: 'checking', name: NAME }) as AddressStatus);
  const base: SetupDeps = {
    ui,
    prompts: typed.prompts,
    conch: (args) => `conch ${args}`,
    version: '1.0.0',
    hostname: 'vps-1',
    headless: true,
    port: 4317,
    target: 'http://127.0.0.1:4317',
    allowedHosts: [],
    user: 'george',
    gateway: {
      running: vi.fn(async () => true),
      start: vi.fn(async () => true),
      restartOn: vi.fn(async () => true),
      address: { set, status: vi.fn(async () => ready) },
    },
    dns: vi.fn(async () => report('here')),
    ports: {
      allowed: vi.fn(async () => true),
      privateNode: vi.fn(async () => '/home/george/.conch/runtime/node/bin/node'),
      command: vi.fn(async (node: string) => `sudo setcap cap_net_bind_service=+ep ${node}`),
    },
    firewall: vi.fn(async () => undefined),
    sudo: vi.fn(async () => true),
    tailscale: { turnOn: vi.fn(async () => ({ url: 'https://vps-1.tail1.ts.net' })) },
    access: {
      method: vi.fn(async () => 'none' as const),
      hello: vi.fn(async () => ({ code: 'HELLO-CODE', expiresAt: now + 3_600_000 })),
    },
    open: vi.fn(async () => true),
    sleep: vi.fn(async (ms: number) => void (now += ms)),
    now: () => now,
  };
  return { deps: { ...base, ...over }, text, asked: typed.asked };
}

describe('an address of my own', () => {
  it('asks the address, checks it points here, answers on it and ends with the hello link', async () => {
    const t = deps({}, { choose: 'address', ask: [`https://${NAME.toUpperCase()}/`] });
    expect(await setup([], t.deps)).toBe(0);
    expect(t.asked).toEqual(['How will you reach Conch?', 'Your address:']);
    expect(t.deps.gateway.address.set).toHaveBeenCalledWith(NAME);
    const out = t.text();
    expect(out).toContain(`${NAME} points here`);
    expect(out).toContain(`https://${NAME}/#hello=HELLO-CODE`);
    expect(out).toContain('Whoever opens it first owns this Conch');
    expect(out).toContain('Let’s Encrypt');
    expect(out).toContain('All set.');
    expect(t.deps.sudo).not.toHaveBeenCalled();
  });

  it('shows the record to add, then waits for it to arrive', async () => {
    const dns = vi
      .fn<SetupDeps['dns']>()
      .mockResolvedValueOnce(report('missing'))
      .mockResolvedValueOnce(report('missing'))
      .mockResolvedValue(report('here'));
    const t = deps({ dns }, { choose: 'address', ask: [NAME] });
    expect(await setup([], t.deps)).toBe(0);
    const out = t.text();
    expect(out).toContain('Add this record where you bought your domain');
    expect(out).toMatch(/A\s+conch\s+203\.0\.113\.7/);
    expect(out).toContain(`This server is at ${HERE}`);
    expect(dns).toHaveBeenCalledTimes(3);
  });

  it('with nobody to ask, shows the record and how to carry on, and changes nothing', async () => {
    const t = deps({ dns: vi.fn(async () => report('missing')) }, {}, false);
    expect(await setup(['--domain', NAME, '--yes'], t.deps)).toBe(1);
    expect(t.text()).toContain(`conch setup --domain ${NAME}`);
    expect(t.deps.gateway.address.set).not.toHaveBeenCalled();
  });

  it('refuses an address that isn’t one, in words', async () => {
    const t = deps();
    expect(await setup(['--domain', 'localhost'], t.deps)).toBe(1);
    expect(t.deps.gateway.address.set).not.toHaveBeenCalled();
  });

  it('on Linux, gets the port permission with one sudo, and only with a yes', async () => {
    const no = deps(
      { ports: { ...deps().deps.ports, allowed: vi.fn(async () => false) } },
      { choose: 'address', ask: [NAME], confirm: [false] },
    );
    expect(await setup([], no.deps)).toBe(1);
    expect(no.deps.sudo).not.toHaveBeenCalled();
    expect(no.text()).toContain('sudo setcap cap_net_bind_service=+ep');

    const yes = deps(
      { ports: { ...deps().deps.ports, allowed: vi.fn(async () => false) } },
      { choose: 'address', ask: [NAME], confirm: [true] },
    );
    expect(await setup([], yes.deps)).toBe(0);
    expect(yes.deps.sudo).toHaveBeenCalledWith(
      'sudo setcap cap_net_bind_service=+ep /home/george/.conch/runtime/node/bin/node',
    );
    // Conch starts again on the Node that has the permission.
    expect(yes.deps.gateway.restartOn).toHaveBeenCalledWith(
      '/home/george/.conch/runtime/node/bin/node',
    );
  });

  it('gets the port permission when Conch finds it missing after all, then carries on', async () => {
    const status = vi
      .fn<SetupDeps['gateway']['address']['status']>()
      .mockResolvedValueOnce({
        state: 'problem',
        name: NAME,
        problem: { kind: 'ports-privilege', message: 'Conch may not answer on ports 80 and 443.' },
      })
      .mockResolvedValue(ready);
    const base = deps().deps;
    const t = deps(
      { gateway: { ...base.gateway, address: { set: base.gateway.address.set, status } } },
      { choose: 'address', ask: [NAME], confirm: [true] },
    );
    expect(await setup([], t.deps)).toBe(0);
    expect(t.deps.sudo).toHaveBeenCalledWith(expect.stringContaining('setcap'));
    expect(t.deps.gateway.restartOn).toHaveBeenCalled();
    expect(t.text()).not.toContain('Conch may not answer on ports 80 and 443.');
  });

  it('offers to open the server’s firewall', async () => {
    const t = deps(
      {
        firewall: vi.fn(async () => ({
          name: 'The ufw firewall',
          command: 'sudo ufw allow 80,443/tcp',
        })),
      },
      { choose: 'address', ask: [NAME], confirm: [true] },
    );
    expect(await setup([], t.deps)).toBe(0);
    expect(t.deps.sudo).toHaveBeenCalledWith('sudo ufw allow 80,443/tcp');
    expect(t.text()).toContain('Ports 80 and 443 are open.');
  });

  it('says what’s in the way, with the fix, and tries again when asked', async () => {
    const status = vi
      .fn<SetupDeps['gateway']['address']['status']>()
      .mockResolvedValueOnce({
        state: 'problem',
        name: NAME,
        problem: { kind: 'unreachable', message: 'Port 80 can’t be reached from the internet.' },
      })
      .mockResolvedValue(ready);
    const t = deps(
      {
        gateway: {
          ...deps().deps.gateway,
          address: {
            set: vi.fn(async () => ({ state: 'checking', name: NAME }) as AddressStatus),
            status,
          },
        },
      },
      { choose: 'address', ask: [NAME], confirm: [true] },
    );
    expect(await setup([], t.deps)).toBe(0);
    expect(t.text()).toContain('Port 80 can’t be reached from the internet.');
    expect(t.deps.gateway.address.set).toHaveBeenCalledTimes(2);
  });

  it('starts Conch first when it isn’t running', async () => {
    const t = deps(
      { gateway: { ...deps().deps.gateway, running: vi.fn(async () => false) } },
      { choose: 'address', ask: [NAME] },
    );
    expect(await setup([], t.deps)).toBe(0);
    expect(t.deps.gateway.start).toHaveBeenCalled();
  });

  it('doesn’t hand out a hello link for a Conch that’s already someone’s', async () => {
    const t = deps(
      { access: { method: vi.fn(async () => 'passkey' as const), hello: vi.fn() } },
      { choose: 'address', ask: [NAME] },
    );
    expect(await setup([], t.deps)).toBe(0);
    expect(t.deps.access.hello).not.toHaveBeenCalled();
    expect(t.text()).toContain('already yours');
  });
});

describe('through a tunnel or web server of my own', () => {
  const through: AddressStatus = {
    state: 'ready',
    name: NAME,
    url: `https://${NAME}`,
    via: 'proxy',
  };
  const withStatus = (status: SetupDeps['gateway']['address']['status']) => {
    const base = deps().deps;
    return { gateway: { ...base.gateway, address: { set: base.gateway.address.set, status } } };
  };

  it('says where to point it, checks the way in through it and ends with the hello link', async () => {
    const t = deps(withStatus(vi.fn(async () => through)), { choose: 'proxy', ask: [NAME] });
    expect(await setup([], t.deps)).toBe(0);
    expect(t.asked).toEqual(['How will you reach Conch?', 'Your address:']);
    expect(t.deps.gateway.address.set).toHaveBeenCalledWith(NAME, 'proxy');
    const out = t.text();
    expect(out).toContain(`Point ${NAME} here`);
    expect(out).toContain('http://127.0.0.1:4317');
    expect(out).toContain('Cloudflare Tunnel');
    expect(out).toContain('through your tunnel or web server');
    expect(out).toContain(`https://${NAME}/#hello=HELLO-CODE`);
    // None of the certificate path: no record, no ports, no firewall, no sudo, no Let's Encrypt.
    expect(t.deps.dns).not.toHaveBeenCalled();
    expect(t.deps.ports.allowed).not.toHaveBeenCalled();
    expect(t.deps.firewall).not.toHaveBeenCalled();
    expect(t.deps.sudo).not.toHaveBeenCalled();
    expect(out).not.toContain('Let’s Encrypt');
  });

  it('says so when the proxy asks for its own sign-in first', async () => {
    const t = deps(withStatus(vi.fn(async () => ({ ...through, guarded: true }))), {
      choose: 'proxy',
      ask: [NAME],
    });
    expect(await setup([], t.deps)).toBe(0);
    expect(t.text()).toContain('It asks for its own sign-in first');
  });

  it('says what’s in the way and tries again when asked', async () => {
    const status = vi
      .fn<SetupDeps['gateway']['address']['status']>()
      .mockResolvedValueOnce({
        state: 'problem',
        name: NAME,
        via: 'proxy',
        problem: {
          kind: 'unreachable',
          message: `${NAME} reaches your tunnel or web server, but it can’t reach Conch.`,
        },
      })
      .mockResolvedValue(through);
    const t = deps(withStatus(status), { choose: 'proxy', ask: [NAME], confirm: [true] });
    expect(await setup([], t.deps)).toBe(0);
    expect(t.text()).toContain('but it can’t reach Conch');
    expect(t.deps.gateway.address.set).toHaveBeenCalledTimes(2);
    expect(t.text()).toContain(`https://${NAME}/#hello=HELLO-CODE`);
  });

  it('still hands over the link when the proxy isn’t pointed here yet: Conch keeps checking', async () => {
    const status = vi.fn(async (): Promise<AddressStatus> => ({
      state: 'problem',
      name: NAME,
      via: 'proxy',
      problem: { kind: 'dns', message: `${NAME} can’t be found yet.` },
    }));
    const t = deps(withStatus(status), { choose: 'proxy', ask: [NAME], confirm: [false] });
    expect(await setup([], t.deps)).toBe(0);
    expect(t.text()).toContain('Conch keeps checking by itself');
    expect(t.text()).toContain(`https://${NAME}/#hello=HELLO-CODE`);
  });

  it('takes --proxy with nobody to ask, and a name inside a home network', async () => {
    const t = deps(
      withStatus(vi.fn(async () => ({ ...through, name: 'conch.home.lan' }))),
      {},
      false,
    );
    expect(await setup(['--proxy', 'https://Conch.Home.LAN/', '--yes'], t.deps)).toBe(0);
    expect(t.deps.gateway.address.set).toHaveBeenCalledWith('conch.home.lan', 'proxy');
    expect(t.text()).toContain('https://conch.home.lan/#hello=HELLO-CODE');
  });

  it('refuses a name that isn’t one, in words', async () => {
    const t = deps();
    expect(await setup(['--proxy', 'localhost'], t.deps)).toBe(1);
    expect(t.deps.gateway.address.set).not.toHaveBeenCalled();
  });

  it('a name behind Cloudflare: asks whether a tunnel answers there, and goes that way', async () => {
    const t = deps(
      { ...withStatus(vi.fn(async () => through)), dns: vi.fn(async () => report('cloudflare')) },
      { choose: 'address', ask: [NAME], confirm: [true] },
    );
    expect(await setup([], t.deps)).toBe(0);
    expect(t.asked).toContain(
      `${NAME} is behind Cloudflare. Does a Cloudflare Tunnel (or another proxy of yours) answer there?`,
    );
    expect(t.deps.gateway.address.set).toHaveBeenCalledWith(NAME, 'proxy');
    expect(t.deps.ports.allowed).not.toHaveBeenCalled();
  });

  it('a name behind Cloudflare with nobody to ask: says how to choose the tunnel', async () => {
    const t = deps({ dns: vi.fn(async () => report('cloudflare')) }, {}, false);
    await setup(['--domain', NAME, '--yes'], t.deps);
    expect(t.text()).toContain(`conch setup --proxy ${NAME}`);
  });
});

describe('the other two ways', () => {
  it('Tailscale: turns on the private address and ends with the hello link there', async () => {
    const t = deps({}, { choose: 'tailscale' });
    expect(await setup([], t.deps)).toBe(0);
    expect(t.text()).toContain('https://vps-1.tail1.ts.net/#hello=HELLO-CODE');
  });

  it('Tailscale not ready: says what to do', async () => {
    const t = deps(
      {
        tailscale: {
          turnOn: vi.fn(async () => ({
            problem: 'Tailscale isn’t installed.',
            next: 'https://tailscale.com/download',
          })),
        },
      },
      { choose: 'tailscale' },
    );
    expect(await setup([], t.deps)).toBe(1);
    expect(t.text()).toContain('conch setup --tailscale');
  });

  it('just this computer, on a server: the SSH tunnel and a one-time link', async () => {
    const t = deps({}, { choose: 'local' });
    expect(await setup([], t.deps)).toBe(0);
    const out = t.text();
    expect(out).toContain('ssh -N -L 4317:localhost:4317 george@vps-1');
    const tunnel = deps({ sshHost: '198.51.100.7' }, { choose: 'local' });
    await setup([], tunnel.deps);
    expect(tunnel.text()).toContain('george@198.51.100.7');
    expect(out).toContain('conch open --link');
  });

  it('just this computer, but Conch already answers to a name: the link there, no SSH tunnel', async () => {
    const t = deps({ allowedHosts: [NAME] }, { choose: 'local' });
    expect(await setup([], t.deps)).toBe(0);
    const out = t.text();
    expect(out).toContain(`Conch also answers to ${NAME}`);
    expect(out).toContain(`https://${NAME}/#hello=HELLO-CODE`);
    expect(out).toContain(`conch setup --proxy ${NAME}`);
    expect(out).not.toContain('ssh -N -L');
  });

  it('with nobody at the keyboard and nothing chosen, says how to come back to it', async () => {
    const t = deps({}, {}, false);
    expect(await setup([], t.deps)).toBe(0);
    expect(t.text()).toContain('conch setup');
    expect(t.deps.gateway.address.set).not.toHaveBeenCalled();
  });
});

describe('when looking the name up fails', () => {
  it('says so in words and carries on looking, never showing an error from deep inside', async () => {
    const dns = vi
      .fn<SetupDeps['dns']>()
      .mockRejectedValueOnce(new Error('queryA ECONNREFUSED conch.example.com'))
      .mockResolvedValue(report('here'));
    const t = deps({ dns }, { choose: 'address', ask: [NAME] });
    expect(await setup([], t.deps)).toBe(0);
    const out = t.text();
    expect(out).not.toContain('ECONNREFUSED');
    expect(out).toContain('Conch couldn’t look conch.example.com up just now');
  });
});
