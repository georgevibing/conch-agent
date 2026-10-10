/** Runs only on trusted main. Outputs public data, never credentials. */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import { verifyPublication } from './verify';
import { describesChannel, publications, selectPublication } from './select';
import { SitePublication } from './schema';

const root = resolve(import.meta.dirname, '../../..');
const repository = process.env.GITHUB_REPOSITORY ?? 'georgevibing/conch-agent';
if (repository !== 'georgevibing/conch-agent')
  throw new Error('Publish only from Conch’s repository.');
const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const token = process.env.GH_TOKEN;
async function api(path: string): Promise<unknown> {
  // Local checks use gh's existing sign-in without reading or printing its token.
  if (!token)
    return JSON.parse(
      execFileSync('gh', ['api', `repos/${repository}/${path}`], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  // GitHub's API has passing bad moments (a 502, a dropped connection): ask
  // again a few times, a little later each time, before keeping the current site.
  let response: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((wait) => setTimeout(wait, 2_000 * 2 ** (attempt - 1)));
    response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
    if (response && response.status < 500) break;
  }
  if (!response)
    throw new Error(`GitHub ${path.split('?')[0]} didn't answer; keeping the current site.`);
  if (!response.ok)
    throw new Error(
      `GitHub ${path.split('?')[0]} returned ${response.status}; keeping the current site.`,
    );
  return response.json();
}

git(['fetch', 'origin', 'main', '+refs/tags/v*:refs/conch-site/tags/v*']);
const runs = z
  .object({
    workflow_runs: z.array(
      z.object({
        head_sha: z.string().regex(/^[0-9a-f]{40}$/),
        head_branch: z.string(),
        event: z.string(),
        conclusion: z.string(),
      }),
    ),
  })
  .parse(
    await api('actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100'),
  );
const main = runs.workflow_runs.find(
  (run) => run.head_branch === 'main' && run.event === 'push' && run.conclusion === 'success',
)?.head_sha;
if (!main) throw new Error('No successful main CI run yet; keeping the current site.');
git(['merge-base', '--is-ancestor', main, 'origin/main']);

const all: unknown[] = [];
for (let page = 1; ; page++) {
  const batch = z.array(z.unknown()).parse(await api(`releases?per_page=100&page=${page}`));
  all.push(...batch);
  if (batch.length < 100) break;
}
const releases = await publications(all, (tag) =>
  verifyPublication(async (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
    return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }, tag),
);
const production = SitePublication.parse(
  selectPublication(releases, main, (release) => {
    const schema = spawnSync('git', ['show', `${release.commit}:apps/docs/publishing/schema.ts`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    return schema.status === 0 && describesChannel(schema.stdout, release.channel);
  }),
);
const next = SitePublication.parse({ channel: 'development', commit: main, next: true, releases });
const snapshot = { production, next };
const folder = resolve(root, '.site');
if (process.argv.includes('--verify')) {
  if (JSON.stringify(snapshot) !== readFileSync(resolve(folder, 'selection.json'), 'utf8').trim())
    throw new Error(
      'Published releases or validated main changed during the build; run Website again.',
    );
} else {
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, 'selection.json'), JSON.stringify(snapshot));
  writeFileSync(resolve(folder, 'production.json'), JSON.stringify(production));
  writeFileSync(resolve(folder, 'next.json'), JSON.stringify(next));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `production=${production.commit}\nnext=${main}\n`);
}
