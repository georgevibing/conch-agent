/**
 * Anthropic's own skills (`github.com/anthropics/skills`, ADR 0070): read
 * straight from GitHub at the newest commit, one folder per skill under
 * `skills/`. Only the ones whose licence lets you copy them are listed
 * (most are Apache-2.0; the document skills are "source-available" and stay
 * where they are).
 *
 * Cost: one API call for the newest commit and one for its tree, at most
 * every few hours; each SKILL.md and licence comes from
 * raw.githubusercontent.com, checked against git's hash.
 */
import { readKey, splitSkill, splitTitle } from '../frontmatter';
import { type GitHubSkills, type TreeFile } from './github';
import { MarketError } from './http';
import { licenseOf } from './license';
import {
  type Fetched,
  inTurn,
  type MarketSource,
  plainLine,
  type SourceListing,
  titleOf,
} from './types';

const OWNER = 'anthropics';
const REPO = 'skills';
const ROOT = 'skills';
/** How long a look at the repository is kept before asking GitHub again. */
const INDEX_TTL_MS = 6 * 60 * 60_000;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface Indexed {
  at: number;
  commit: string;
  listings: Map<string, SourceListing>;
}

export class AnthropicSource implements MarketSource {
  readonly id = 'anthropic' as const;
  readonly label = 'Anthropic';
  #index?: Indexed;
  #loading?: Promise<Indexed>;

  constructor(
    private readonly github: GitHubSkills,
    private readonly now: () => number = Date.now,
  ) {}

  /** The skill folders in the repository at this commit. */
  async #folders(commit: string, signal?: AbortSignal): Promise<Map<string, TreeFile[]>> {
    const tree = await this.github.tree(OWNER, REPO, commit, signal);
    const out = new Map<string, TreeFile[]>();
    for (const file of tree) {
      const match = /^skills\/([^/]+)\/(.+)$/.exec(file.path);
      if (!match?.[1] || !match[2] || !NAME.test(match[1])) continue;
      const list = out.get(match[1]) ?? [];
      list.push(file);
      out.set(match[1], list);
    }
    for (const [name, files] of out)
      if (!files.some((f) => f.path === `${ROOT}/${name}/SKILL.md`)) out.delete(name);
    return out;
  }

  async #load(signal?: AbortSignal): Promise<Indexed> {
    const commit = await this.github.head(OWNER, REPO, undefined, signal);
    if (this.#index?.commit === commit) return { ...this.#index, at: this.now() };
    const folders = await this.#folders(commit, signal);
    const listings = new Map<string, SourceListing>();
    // Only what decides whether it's listed, and its card: SKILL.md and a licence.
    const reads = await inTurn([...folders], 6, async ([name, files]) => {
      const wanted = files.filter((f) =>
        new RegExp(`^${ROOT}/${name}/(?:SKILL\\.md|LICEN[CS]E(?:\\.txt|\\.md)?)$`, 'i').test(
          f.path,
        ),
      );
      const read = new Map<string, Buffer>();
      for (const file of wanted)
        read.set(
          file.path.slice(`${ROOT}/${name}/`.length),
          await this.github.file(OWNER, REPO, commit, file, signal),
        );
      return [name, read] as const;
    });
    for (const [name, read] of reads) {
      if (licenseOf(read).kind === 'restricted') continue;
      const text = read.get('SKILL.md')?.toString('utf8') ?? '';
      const { front, body } = splitSkill(text);
      const description = readKey(front, 'description') ?? '';
      if (!description.trim()) continue;
      listings.set(name, {
        id: `anthropic:${name}`,
        source: 'anthropic',
        sourceLabel: this.label,
        name,
        title: (splitTitle(body).title ?? titleOf(name)).slice(0, 80),
        description: plainLine(description),
        publisher: { name: 'Anthropic', handle: OWNER, url: `https://github.com/${OWNER}` },
        trust: 'official',
        trustNote: 'From Anthropic’s own skills on GitHub.',
        url: `https://github.com/${OWNER}/${REPO}/tree/${commit}/${ROOT}/${name}`,
      });
    }
    return { at: this.now(), commit, listings };
  }

  async #ready(signal?: AbortSignal): Promise<Indexed> {
    if (this.#index && this.now() - this.#index.at < INDEX_TTL_MS) return this.#index;
    this.#loading ??= this.#load(signal).finally(() => {
      this.#loading = undefined;
    });
    this.#index = await this.#loading;
    return this.#index;
  }

  async search(query: string, signal?: AbortSignal): Promise<SourceListing[]> {
    const { listings } = await this.#ready(signal);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = [...listings.values()];
    if (!words.length) return all;
    return all.filter((l) => {
      const hay = `${l.name} ${l.title} ${l.description}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    });
  }

  async listing(key: string, signal?: AbortSignal): Promise<SourceListing> {
    const found = (await this.#ready(signal)).listings.get(key);
    if (!found) throw new MarketError('not-found', 'Anthropic doesn’t share that skill any more.');
    return found;
  }

  async latest(key: string, signal?: AbortSignal) {
    if (!NAME.test(key)) return undefined;
    const { commit } = await this.#ready(signal);
    const path = `${ROOT}/${key}`;
    return {
      pin: { kind: 'commit' as const, owner: OWNER, repo: REPO, path, commit },
      content: await this.github.content(OWNER, REPO, commit, path, signal),
    };
  }

  async fetch(key: string, signal?: AbortSignal): Promise<Fetched> {
    if (!NAME.test(key))
      throw new MarketError('not-found', 'That isn’t one of Anthropic’s skills.');
    const index = await this.#ready(signal);
    const listing = await this.listing(key, signal);
    const path = `${ROOT}/${key}`;
    const { files, content } = await this.github.folder(OWNER, REPO, index.commit, path, signal);
    return {
      listing,
      pin: { kind: 'commit', owner: OWNER, repo: REPO, path, commit: index.commit },
      files,
      content,
    };
  }
}
