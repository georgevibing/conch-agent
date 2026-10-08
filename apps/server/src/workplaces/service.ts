/**
 * Where work runs (ADR 0106): the places a chat's commands can run, how each
 * stands, and the one a turn uses. This computer (its sealed box) is always
 * there and is the default; the others are found, not configured: Docker or
 * Podman if it's here (or one press to get it), each machine in your SSH
 * settings, and the cloud once you've added a Daytona key.
 */
import { join } from 'node:path';

import {
  placeKind,
  PLACE_WORDS,
  sshHostOf,
  type DoctorItem,
  type WorkPlaceId,
  type WorkPlaceInfo,
  type WorkPlacesStatus,
} from '@conch/protocol';
import { z } from 'zod';

import type { DoctorCheck } from '../doctor/service';
import { Mutex, writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';
import { CloudSandboxes, cloudPlace, type Fetcher } from './cloud';
import { containerPlace, Containers } from './container';
import type { Exec } from './exec';
import { sshPlace, SshMachines } from './ssh';
import type { WorkPlace } from './types';

export type { WorkPlace } from './types';

const Secrets = z.object({ daytona: z.string().optional() });
type Secrets = z.infer<typeof Secrets>;

/** `workplaces.secrets.json`: the cloud's key, sealed with Conch's other keys (ADR 0025). */
export const WORKPLACE_SECRETS = 'workplaces.secrets.json';

export interface WorkPlacesDeps {
  home: string;
  /** Where new chats run now (`preferences.place`). */
  defaultPlace: () => Promise<WorkPlaceId>;
  heal?: (message: string) => void;
  exec?: Exec;
  fetch?: Fetcher;
  hosts?: () => Promise<string[]>;
  findContainer?: ConstructorParameters<typeof Containers>[0]['find'];
  findSsh?: () => Promise<string | undefined>;
}

const GROUP = 'This computer';

export class WorkPlaces {
  readonly containers: Containers;
  readonly machines: SshMachines;
  readonly cloud: CloudSandboxes;
  readonly #mutex = new Mutex();
  #secrets?: Promise<Secrets>;

  constructor(private readonly deps: WorkPlacesDeps) {
    const dir = join(deps.home, 'workplaces');
    this.containers = new Containers({
      dir,
      ...(deps.exec && { exec: deps.exec }),
      ...(deps.findContainer && { find: deps.findContainer }),
      ...(deps.heal && { heal: deps.heal }),
    });
    this.machines = new SshMachines({
      dir,
      ...(deps.exec && { exec: deps.exec }),
      ...(deps.hosts && { hosts: deps.hosts }),
      ...(deps.findSsh && { findSsh: deps.findSsh }),
    });
    this.cloud = new CloudSandboxes({
      key: async () => (await this.#read()).daytona,
      ...(deps.fetch && { fetch: deps.fetch }),
    });
  }

  get #path() {
    return join(this.deps.home, WORKPLACE_SECRETS);
  }

  #read(): Promise<Secrets> {
    this.#secrets ??= readStore(this.#path, Secrets).then(
      (read) => read.value,
      (error: unknown) => {
        this.#secrets = undefined;
        throw error;
      },
    );
    return this.#secrets;
  }

  /** Save the cloud's key, after checking it opens Daytona. Never returned again. */
  async setCloudKey(key: string): Promise<void> {
    await this.#mutex.run(async () => {
      const before = await this.#read();
      this.#secrets = Promise.resolve({ ...before, daytona: key });
      const check = await this.cloud.check();
      if (!check.ok) {
        this.#secrets = Promise.resolve(before);
        throw new Error(check.message ?? 'Daytona didn’t accept that key.');
      }
      await writeJson(this.#path, { ...before, daytona: key });
      this.cloud.forget();
    });
  }

  async forgetCloudKey(): Promise<void> {
    await this.#mutex.run(async () => {
      const { daytona: _gone, ...rest } = await this.#read();
      await writeJson(this.#path, rest);
      this.#secrets = Promise.resolve(rest);
      this.cloud.forget();
    });
  }

  /** The key itself, only for Passwords' own list of Conch's keys (ADR 0025). */
  async cloudKey(): Promise<string | undefined> {
    return (await this.#read()).daytona;
  }

  async hasCloudKey(): Promise<boolean> {
    return Boolean((await this.#read().catch(() => ({}) as Secrets)).daytona);
  }

  /**
   * The place a turn's commands run, or nothing for this computer. A place
   * that has gone (a machine no longer in your SSH settings) still answers,
   * with what happened, so a command never quietly runs here instead.
   */
  forTurn(id: WorkPlaceId | undefined): WorkPlace | undefined {
    if (!id) return undefined;
    switch (placeKind(id)) {
      case 'container':
        return containerPlace(this.containers);
      case 'cloud':
        return cloudPlace(this.cloud);
      case 'ssh': {
        const host = sshHostOf(id);
        return host ? sshPlace(this.machines, host) : undefined;
      }
      default:
        return undefined;
    }
  }

  /** Every place, as it stands. `look`: also reach each SSH machine (for the picker, not a list). */
  async status({ look = false }: { look?: boolean } = {}): Promise<WorkPlacesStatus> {
    const [container, hosts, key, chosen] = await Promise.all([
      this.containers.look(),
      this.machines.hosts().catch((): string[] => []),
      this.hasCloudKey(),
      this.deps.defaultPlace().catch(() => 'computer' as const),
    ]);
    const places: WorkPlaceInfo[] = [
      {
        id: 'computer',
        kind: 'computer',
        name: PLACE_WORDS.computer.label,
        description: PLACE_WORDS.computer.description,
        state: 'ready',
      },
      {
        id: 'container',
        kind: 'container',
        name:
          container.state === 'ready'
            ? container.program.kind === 'docker'
              ? 'Docker'
              : 'Podman'
            : PLACE_WORDS.container.label,
        description: PLACE_WORDS.container.description,
        state: container.state,
        ...(container.state !== 'ready' && { message: container.message }),
        ...(container.state !== 'ready' && container.need && { need: container.need }),
      },
    ];
    const looks = look
      ? await Promise.all(hosts.slice(0, 12).map((host) => this.machines.look(host)))
      : [];
    hosts.slice(0, 24).forEach((host, i) => {
      const seen = looks[i];
      places.push({
        id: `ssh:${host}`,
        kind: 'ssh',
        name: host,
        description: PLACE_WORDS.ssh.description,
        state: !seen || seen.ok ? 'ready' : 'unavailable',
        ...(seen && !seen.ok && seen.message && { message: seen.message }),
      });
    });
    places.push({
      id: 'cloud',
      kind: 'cloud',
      name: 'Daytona',
      description: PLACE_WORDS.cloud.description,
      state: key ? 'ready' : 'needs-setup',
      ...(!key && { needsKey: true, message: 'Needs a Daytona key. It’s free to start.' }),
    });
    return { places, default: chosen };
  }

  /** Boxes a crash left behind, removed at start. Quietly said in Health when there were any. */
  async start(): Promise<void> {
    const removed = await this.containers.sweep().catch(() => 0);
    if (removed)
      this.deps.heal?.(
        `Removed ${removed} container${removed === 1 ? '' : 's'} left from before Conch restarted`,
      );
  }

  /** Repair everything: the default place, and the container engine when it's in use. */
  doctorCheck(): DoctorCheck {
    return {
      id: 'workplaces',
      group: GROUP,
      title: 'Where work runs',
      run: async ({ repair }) => {
        const chosen = await this.deps.defaultPlace().catch(() => 'computer' as WorkPlaceId);
        const base = { id: 'workplaces', group: GROUP, title: 'Where work runs' };
        const kind = placeKind(chosen);
        if (kind === 'computer') return [];
        const items: DoctorItem[] = [];
        if (kind === 'container') {
          const removed = repair ? await this.containers.sweep().catch(() => 0) : 0;
          try {
            if (repair) await this.containers.ready(AbortSignal.timeout(120_000));
            const look = await this.containers.look();
            if (look.state === 'needs-setup')
              items.push({
                ...base,
                state: 'needs-you',
                message: look.message,
                action: {
                  kind: 'need',
                  label: 'Install Podman',
                  need: 'container',
                  mode: 'install',
                },
              });
            else
              items.push({
                ...base,
                state: repair && removed ? 'fixed' : 'ok',
                message:
                  repair && removed
                    ? `In a container. Removed ${removed} left behind.`
                    : 'In a container.',
              });
          } catch (error) {
            items.push({
              ...base,
              state: 'needs-you',
              message:
                error instanceof Error ? error.message : 'The container program didn’t answer.',
              action: { kind: 'open', label: 'Open', place: 'security', focus: 'workplaces' },
            });
          }
        } else if (kind === 'ssh') {
          const host = sshHostOf(chosen) ?? '';
          const known = (await this.machines.hosts().catch((): string[] => [])).includes(host);
          const look = known
            ? await this.machines.look(host)
            : { ok: false, message: `${host} isn’t in your SSH settings any more.` };
          items.push(
            look.ok
              ? { ...base, state: 'ok', message: `On ${host}.` }
              : {
                  ...base,
                  state: 'needs-you',
                  message: look.message ?? `${host} isn’t answering.`,
                  action: { kind: 'open', label: 'Open', place: 'security', focus: 'workplaces' },
                },
          );
        } else {
          if (repair) this.cloud.forget();
          const check = (await this.hasCloudKey())
            ? await this.cloud.check()
            : { ok: false, message: 'The cloud needs your Daytona key.' };
          items.push(
            check.ok
              ? { ...base, state: 'ok', message: 'In the cloud (Daytona).' }
              : {
                  ...base,
                  state: 'needs-you',
                  message: check.message ?? 'Daytona isn’t answering.',
                  action: { kind: 'open', label: 'Open', place: 'security', focus: 'workplaces' },
                },
          );
        }
        return items;
      },
    };
  }
}
