/**
 * Updates for the desktop app (ADR 0054). The gateway decides and the app
 * does the work.
 *
 * The gateway lists the GitHub Releases of Conch's repository, offers the
 * newest in the person's channel by the same rules a checkout uses
 * (`release/semver.ts`), and reads each release's notes from its body (the
 * notes `pnpm release` wrote). A release is offered only once this computer's
 * files are attached to it. Updating asks the app to download that release
 * (electron-updater checks its SHA-512) and install it, which restarts Conch.
 * An app that can't replace itself — an unsigned Mac app, a `.deb` — offers
 * the release page instead.
 */
import type { ReleaseChannel, ReleaseNotes } from '@conch/protocol';

import type { DesktopApp } from '../desktop/app';
import { parseNotes } from '../release/notes';
import { channelOf, offered, releaseOfTag } from '../release/semver';

export interface AppOffer {
  version: string;
  channel: ReleaseChannel;
  /** Where its files are: `https://github.com/<owner>/<repo>/releases/download/v1.2.3`. */
  feed: string;
  /** Its page on GitHub, for a person to download it from. */
  page: string;
  notes: ReleaseNotes;
}

export interface AppCheck {
  offers: AppOffer[];
  /** The look didn't get an answer: one quiet sentence. Offers are then the last look's. */
  problem?: string;
}

export type AppInstall = { kind: 'ready' } | { kind: 'failed'; message: string };

/** The file electron-updater reads for this computer: what must be attached before a release is offered. */
export function feedFile(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === 'win32') return 'latest.yml';
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'linux') return arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml';
  return undefined;
}

/** Why the person downloads it themselves, in their words. */
export function downloadReason(platform: NodeJS.Platform): string {
  return platform === 'darwin'
    ? 'Download it, then drag Conch into Applications to replace this one. Your chats and settings stay as they are.'
    : 'Download it and open it to install it over this one. Your chats and settings stay as they are.';
}

/** One release from GitHub's list, as much of it as Conch reads. */
interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: unknown;
}

export interface AppReleasesDeps {
  app: DesktopApp;
  repository: { owner: string; repo: string };
  /** This app's version (`SERVER_VERSION`). */
  version: string;
  development?: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: typeof fetch;
}

export class AppReleases {
  constructor(private readonly deps: AppReleasesDeps) {}

  get updates(): 'install' | 'download' {
    return this.deps.app.updates;
  }

  get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }

  /** The releases worth offering on `channel`, newest first. */
  async check({
    channel,
    failed = [],
  }: {
    channel: ReleaseChannel;
    failed?: string[];
  }): Promise<AppCheck> {
    const { owner, repo } = this.deps.repository;
    const file = feedFile(this.platform, this.deps.arch ?? process.arch);
    if (!file) return { offers: [], problem: 'There’s no Conch app for this computer yet.' };
    let list: unknown;
    try {
      const response = await (this.deps.fetch ?? fetch)(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': `Conch/${this.deps.version}`,
            'x-github-api-version': '2022-11-28',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok)
        return {
          offers: [],
          problem:
            response.status === 403 || response.status === 429
              ? 'GitHub asked Conch to wait before looking again. It looks again later.'
              : 'Conch couldn’t read its releases just now. It looks again later.',
        };
      list = await response.json();
    } catch {
      return { offers: [], problem: 'Conch couldn’t reach GitHub to look for updates.' };
    }
    if (!Array.isArray(list))
      return { offers: [], problem: 'GitHub answered with something else.' };
    const base = `https://github.com/${owner}/${repo}/releases`;
    const releases = (list as GitHubRelease[]).flatMap((item) => {
      if (item.draft === true || typeof item.tag_name !== 'string') return [];
      const release = releaseOfTag(item.tag_name);
      if (!release) return [];
      const names = Array.isArray(item.assets)
        ? (item.assets as { name?: unknown }[]).map((a) => a.name)
        : [];
      // Not built for this computer yet (or ever): nothing to install.
      if (!names.includes(file)) return [];
      const page =
        typeof item.html_url === 'string' && item.html_url.startsWith(`${base}/`)
          ? item.html_url
          : `${base}/tag/${item.tag_name}`;
      const date = typeof item.published_at === 'string' ? Date.parse(item.published_at) : NaN;
      const notes = parseNotes(typeof item.body === 'string' ? item.body.slice(0, 20_000) : '');
      return [
        {
          release,
          offer: {
            version: release.version,
            channel: channelOf(release),
            feed: `${base}/download/${item.tag_name}`,
            page,
            notes: {
              version: release.version,
              channel: channelOf(release),
              ...(Number.isFinite(date) && { date }),
              ...notes,
            },
          } satisfies AppOffer,
        },
      ];
    });
    const offers = offered(releases, {
      channel,
      current: this.deps.development ? '0.0.0' : this.deps.version,
      failed,
    });
    return { offers: offers.slice(0, 6).map((r) => r.offer) };
  }

  /**
   * Ask the app to download `offer` and install it. Resolves when it's
   * downloaded and checked (the app then quits and the installer takes over),
   * or when it failed. `progress` hears how far along the download is.
   */
  install(offer: AppOffer, progress: (percent: number) => void): Promise<AppInstall> {
    const { app } = this.deps;
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: AppInstall) => {
        if (settled) return;
        settled = true;
        stop();
        resolve(result);
      };
      const stop = app.listen((message) => {
        if (message.type === 'wake.stop' || message.version !== offer.version) return;
        if (message.type === 'update.progress') progress(message.percent);
        else if (message.type === 'update.ready') done({ kind: 'ready' });
        else done({ kind: 'failed', message: message.message });
      });
      void app.send({ type: 'update', version: offer.version, feed: offer.feed }).then((sent) => {
        if (!sent) done({ kind: 'failed', message: 'The Conch app didn’t answer. Try again.' });
      });
    });
  }
}
