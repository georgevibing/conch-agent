import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkPlaceId } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { WORKPLACE_SECRETS, WorkPlaces } from './service';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'conch-places-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const KEY = 'dtn_' + 'f00dfeedf00dfeed1234';

function places(options: { place?: WorkPlaceId; daytona?: number; container?: boolean } = {}) {
  const home = temp();
  const service = new WorkPlaces({
    home,
    defaultPlace: async () => options.place ?? 'computer',
    hosts: async () => ['build-box'],
    findContainer: async () =>
      options.container ? { kind: 'docker', path: '/x/docker' } : undefined,
    fetch: async () => new Response('[]', { status: options.daytona ?? 200 }),
  });
  return { home, service };
}

describe('where work runs', () => {
  it('lists this computer first, then a container, each SSH machine and the cloud', async () => {
    const { service } = places({ container: true });
    const status = await service.status();
    expect(status.places.map((p) => [p.id, p.state])).toEqual([
      ['computer', 'ready'],
      ['container', 'ready'],
      ['ssh:build-box', 'ready'],
      ['cloud', 'needs-setup'],
    ]);
    expect(status.places[1]?.name).toBe('Docker');
    expect(status.default).toBe('computer');
  });

  it('offers to get Docker or Podman when neither is here', async () => {
    const { service } = places();
    const container = (await service.status()).places.find((p) => p.id === 'container');
    expect(container).toMatchObject({ state: 'needs-setup', need: 'container' });
  });

  it('gives a turn its place, and none for this computer', () => {
    const { service } = places();
    expect(service.forTurn('computer')).toBeUndefined();
    expect(service.forTurn(undefined)).toBeUndefined();
    expect(service.forTurn('container')).toMatchObject({ kind: 'container', seals: true });
    expect(service.forTurn('ssh:build-box')).toMatchObject({
      kind: 'ssh',
      seals: false,
      where: { name: 'build-box' },
    });
    expect(service.forTurn('cloud')).toMatchObject({ kind: 'cloud', seals: false });
  });

  it('keeps the cloud key only once Daytona takes it, sealed in its own file', async () => {
    const refused = places({ daytona: 401 });
    await expect(refused.service.setCloudKey(KEY)).rejects.toThrow(/didn’t accept/);
    expect(await refused.service.hasCloudKey()).toBe(false);
    const { home, service } = places();
    await service.setCloudKey(KEY);
    expect(await service.hasCloudKey()).toBe(true);
    expect(JSON.parse(readFileSync(join(home, WORKPLACE_SECRETS), 'utf8'))).toEqual({
      daytona: KEY,
    });
    // The status never carries it.
    expect(JSON.stringify(await service.status())).not.toContain(KEY);
    await service.forgetCloudKey();
    expect(await service.hasCloudKey()).toBe(false);
  });

  it('Repair everything says nothing while work runs here, and what to do otherwise', async () => {
    expect(
      await places()
        .service.doctorCheck()
        .run({ repair: false, signal: AbortSignal.timeout(5000) }),
    ).toEqual([]);
    const items = await places({ place: 'container' })
      .service.doctorCheck()
      .run({ repair: false, signal: AbortSignal.timeout(5000) });
    expect(items[0]).toMatchObject({
      state: 'needs-you',
      action: { kind: 'need', need: 'container' },
    });
    const cloud = await places({ place: 'cloud' })
      .service.doctorCheck()
      .run({ repair: false, signal: AbortSignal.timeout(5000) });
    expect(cloud[0]).toMatchObject({ state: 'needs-you', action: { place: 'security' } });
  });
});
