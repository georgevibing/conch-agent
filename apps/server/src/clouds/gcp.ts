/**
 * Google Cloud, the way it's already set up on this computer (ADR 0109):
 * application default credentials (`gcloud auth application-default login`)
 * for who you are, and your projects for where the bill goes.
 *
 * The credentials file is only looked at to say whether there is one, what
 * kind, and which project it bills; its secrets are never read into Conch.
 * Tokens come from gcloud itself (`print-access-token`), last under an hour,
 * and are kept in memory only.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CloudAccount, LoginState } from '@conch/protocol';
import { z } from 'zod';

import type { LoginHandle } from '../engines/types';
import { CloudError } from './errors';
import { clean, type CloudExec } from './exec';
import { parseIni } from './ini';
import { signIn } from './signin';

export interface GcpDeps {
  exec: CloudExec;
  env: NodeJS.ProcessEnv;
  home: string;
  platform?: NodeJS.Platform;
  now?: () => number;
  read?: (path: string) => Promise<string | undefined>;
}

const readText = (path: string) => readFile(path, 'utf8').catch(() => undefined);

/** A Google Cloud project id, as Google allows them: safe in an address. */
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** gcloud's own folder. */
export function gcloudDir(deps: Pick<GcpDeps, 'env' | 'home' | 'platform'>): string {
  const own = deps.env.CLOUDSDK_CONFIG?.trim();
  if (own) return own;
  if ((deps.platform ?? process.platform) === 'win32')
    return join(deps.env.APPDATA ?? join(deps.home, 'AppData', 'Roaming'), 'gcloud');
  return join(deps.home, '.config', 'gcloud');
}

const Adc = z.object({
  type: z.string().optional(),
  quota_project_id: z.string().optional(),
  project_id: z.string().optional(),
});

/** Whether this computer has application default credentials, and which project they bill. */
export async function adc(
  deps: GcpDeps,
): Promise<{ present: boolean; kind?: string; project?: string }> {
  const path =
    deps.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    join(gcloudDir(deps), 'application_default_credentials.json');
  const text = await (deps.read ?? readText)(path);
  if (!text) return { present: false };
  try {
    const parsed = Adc.safeParse(JSON.parse(text));
    if (!parsed.success) return { present: true };
    const project = parsed.data.quota_project_id ?? parsed.data.project_id;
    return {
      present: true,
      ...(parsed.data.type && { kind: parsed.data.type }),
      ...(project && PROJECT_ID.test(project) && { project }),
    };
  } catch {
    return { present: false };
  }
}

/** The project gcloud uses now: the environment's, else the active configuration's. */
export async function activeProject(deps: GcpDeps): Promise<string | undefined> {
  for (const name of [
    'ANTHROPIC_VERTEX_PROJECT_ID',
    'GOOGLE_CLOUD_PROJECT',
    'CLOUDSDK_CORE_PROJECT',
  ]) {
    const value = deps.env[name]?.trim();
    if (value && PROJECT_ID.test(value)) return value;
  }
  const dir = gcloudDir(deps);
  const read = deps.read ?? readText;
  const active = ((await read(join(dir, 'active_config'))) ?? 'default').trim() || 'default';
  if (!/^[\w.-]+$/.test(active)) return undefined;
  const config = parseIni((await read(join(dir, 'configurations', `config_${active}`))) ?? '');
  const project = config.get('core')?.get('project');
  return project && PROJECT_ID.test(project) ? project : undefined;
}

const Projects = z.array(
  z.object({
    projectId: z.string(),
    name: z.string().optional(),
    lifecycleState: z.string().optional(),
  }),
);

export class GcpCloud {
  #token?: { value: string; until: number };
  #pending?: Promise<string>;
  #projects?: { value: CloudAccount[]; at: number };

  constructor(private readonly deps: GcpDeps) {}

  #now() {
    return this.deps.now?.() ?? Date.now();
  }

  forget() {
    this.#token = undefined;
    this.#projects = undefined;
  }

  /**
   * Your projects, newest sign-in's view: from gcloud when it's here (only
   * active ones), else the projects this computer names itself.
   */
  async projects(options: { force?: boolean } = {}): Promise<CloudAccount[]> {
    if (!options.force && this.#projects && this.#now() - this.#projects.at < 5 * 60_000)
      return this.#projects.value;
    const [credentials, active] = await Promise.all([adc(this.deps), activeProject(this.deps)]);
    const known = new Map<string, CloudAccount>();
    const add = (id: string, label: string, isDefault: boolean) => {
      if (!PROJECT_ID.test(id) || known.has(id)) return;
      known.set(id, {
        id,
        label,
        detail: label === id ? 'Google Cloud project' : `Google Cloud project · ${id}`,
        state: credentials.present ? 'ready' : 'signed-out',
        kind: 'project',
        isDefault,
        broad: false,
      });
    };
    if (active) add(active, active, true);
    if (credentials.project) add(credentials.project, credentials.project, !active);
    const listed = await this.deps.exec
      .run('gcloud', ['projects', 'list', '--format=json', '--limit=200', '--sort-by=projectId'], {
        timeout: 30_000,
      })
      .catch(() => undefined);
    if (listed?.code === 0) {
      try {
        const projects = Projects.safeParse(JSON.parse(listed.stdout));
        if (projects.success)
          for (const project of projects.data)
            if (!project.lifecycleState || project.lifecycleState === 'ACTIVE') {
              const existing = known.get(project.projectId);
              if (existing && project.name)
                known.set(project.projectId, {
                  ...existing,
                  label: project.name,
                  detail: `Google Cloud project · ${project.projectId}`,
                });
              else add(project.projectId, project.name ?? project.projectId, false);
            }
      } catch {
        // A list Conch can't read leaves the projects this computer names.
      }
    }
    const value = [...known.values()].sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label),
    );
    this.#projects = { value, at: this.#now() };
    return value;
  }

  /** Signed in at all: there are application default credentials here. */
  async signedIn(): Promise<boolean> {
    return (await adc(this.deps)).present;
  }

  /** A token for Google's APIs, renewed well before its hour is up. */
  async token(options: { force?: boolean } = {}): Promise<string> {
    if (!options.force && this.#token && this.#token.until > this.#now()) return this.#token.value;
    this.#pending ??= this.#mint().finally(() => (this.#pending = undefined));
    return this.#pending;
  }

  async #mint(): Promise<string> {
    if (!(await adc(this.deps)).present)
      throw new CloudError(
        'signed-out',
        'Sign in to Google Cloud on this computer, and Conch carries on.',
      );
    const result = await this.deps.exec.run(
      'gcloud',
      ['auth', 'application-default', 'print-access-token'],
      { timeout: 30_000 },
    );
    if (result.code === 127)
      throw new CloudError(
        'missing-tool',
        'Conch uses the Google Cloud CLI to sign in to Google Cloud. Install it, and Conch carries on.',
        {
          need: 'gcloud',
        },
      );
    const value = result.stdout.trim().split(/\s+/).at(-1) ?? '';
    if (result.code !== 0 || !/^[\w.-]{20,}$/.test(value)) {
      const said = result.stderr.toLowerCase();
      if (/reauth|invalid_grant|expired|login|credentials|refresh/.test(said))
        throw new CloudError(
          'signed-out',
          'Your Google Cloud sign-in has ended. Sign in to Google Cloud again.',
        );
      throw new CloudError(
        'failed',
        clean(result.stderr) || 'Google Cloud didn’t hand Conch a token.',
      );
    }
    this.#token = { value, until: this.#now() + 45 * 60_000 };
    return value;
  }

  /** `gcloud auth application-default login`: Google's page opens on this computer. */
  signIn(update: (state: LoginState) => void): LoginHandle {
    return signIn(
      this.deps.exec,
      {
        program: 'gcloud',
        args: ['auth', 'application-default', 'login'],
        hosts: /(^|\.)(google\.com|googleapis\.com)$/,
        waiting:
          'Sign in to Google on the page that opened on the computer Conch runs on. This updates by itself.',
        verify: async () => {
          this.forget();
          await this.token({ force: true });
          return true;
        },
        done: 'Signed in to Google Cloud.',
      },
      update,
    );
  }
}
