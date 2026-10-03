/**
 * Where the app finds what it runs (ADR 0054).
 *
 * - **Installed**: everything is in the app's resources: `node/` (Node 24
 *   itself) and `conch/` (Conch, laid out like a checkout).
 * - **`pnpm desktop:start`**: the same layout, built into `apps/desktop/payload`
 *   but not packaged.
 * - **`pnpm desktop:dev`**: the repository itself, the Node that runs pnpm,
 *   and the web app's dev server for the window.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface Places {
  /** Conch's folder: `apps/server`, `apps/web/dist`, the root `package.json`. */
  conch: string;
  /** The Node that runs the gateway. */
  node: string;
  /** The folder with Node's own programs (npm, npx), added to the end of PATH. */
  nodeBin: string;
  /** The app's pictures and pages (inside its archive once installed). */
  resources: string;
  /** Where the window loads the web app from in development (Vite), instead of the gateway. */
  web?: string;
  /** `CONCH_HOME`. */
  home: string;
  kind: 'installed' | 'payload' | 'dev';
}

/** Where Node lives in a Node download: `node.exe` on Windows, `bin/node` elsewhere. */
export function nodeIn(folder: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? join(folder, 'node.exe') : join(folder, 'bin', 'node');
}

export function places({
  packaged,
  resourcesPath,
  appPath,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
}: {
  packaged: boolean;
  /** `process.resourcesPath`. */
  resourcesPath: string;
  /** `app.getAppPath()`: `apps/desktop` when not packaged. */
  appPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
}): Places {
  const home = resolve(env.CONCH_HOME?.trim() || join(homedir(), '.conch'));
  if (packaged) {
    const node = join(resourcesPath, 'node');
    return {
      conch: join(resourcesPath, 'conch'),
      node: nodeIn(node, platform),
      nodeBin: platform === 'win32' ? node : join(node, 'bin'),
      resources: join(appPath, 'dist', 'resources'),
      home,
      kind: 'installed',
    };
  }
  const resources = join(appPath, 'dist', 'resources');
  const web = env.CONCH_DESKTOP_WEB?.trim();
  if (web) {
    // Development: the repository, run by the Node that runs pnpm.
    const node = env.npm_node_execpath?.trim() || env.NODE?.trim() || 'node';
    return {
      conch: resolve(appPath, '..', '..'),
      node,
      nodeBin: resolve(node, '..'),
      resources,
      web,
      home,
      kind: 'dev',
    };
  }
  const payload = join(appPath, 'payload', `${platform}-${arch}`);
  const node = join(payload, 'node');
  return {
    conch: join(payload, 'conch'),
    node: nodeIn(node, platform),
    nodeBin: platform === 'win32' ? node : join(node, 'bin'),
    resources,
    home,
    kind: 'payload',
  };
}

/** What's missing from a layout, in a sentence for the status page; undefined when it's whole. */
export function missing(at: Places): string | undefined {
  if (at.kind !== 'dev' && !existsSync(at.node))
    return at.kind === 'payload'
      ? 'The app’s copy of Conch isn’t built yet. Run pnpm desktop:start, which builds it.'
      : 'This copy of the Conch app is missing part of itself. Install it again from the download page.';
  if (!existsSync(join(at.conch, 'apps', 'server', 'src', 'main.ts')))
    return at.kind === 'installed'
      ? 'This copy of the Conch app is missing part of itself. Install it again from the download page.'
      : 'The app’s copy of Conch isn’t built yet. Run pnpm desktop:start, which builds it.';
  return undefined;
}
