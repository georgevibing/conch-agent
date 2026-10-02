/**
 * Show me (ADR 0034): things the assistant makes for you to see and use.
 *
 * Every provider can make them. One with Conch's tools calls
 * `artifact_create` / `artifact_update`; a chat-only model writes a fenced
 * ```artifact block, which Conch takes out of the reply as it finishes.
 * Each version is kept; the chat shows a card, the panel shows the thing.
 *
 * A pinned artifact is an app in the sidebar. "Refresh" asks for fresh data
 * in a chat of its own, with the same guard as any chat (ADR 0028): it reads
 * the web, and anything that would send something out asks first.
 */
import {
  ArtifactKind,
  ARTIFACT_MAX,
  artifactProblem,
  type Artifact,
  type ConversationEvent,
  type ConversationEventInput,
  type ServerEvent,
} from '@conch/protocol';
import { z } from 'zod';

import type { ConversationManager } from '../conversations/manager';
import { describeTaint } from '../conversations/taint';
import type { DoctorCheck } from '../doctor/service';
import type { HostTool } from '../engines/types';
import { navigates } from './frame';
import { LiveData, LiveDataError, readSources, type fetchLive, type LiveDataAccess } from './live';
import { artifactOperationId, ArtifactError, type ArtifactStore } from './store';

/** The words a model reads to know when and how to make one. */
const GUIDE = [
  'Make something the user can see and use beside the chat: a page or small app (`html`, one self-contained file with inline CSS and JS),',
  'a document (`markdown`), a picture or diagram (`svg`), a diagram in Mermaid (`mermaid`), a chart (`chart`) or a table (`table`, CSV with a header row).',
  'Use it when the answer is something to look at, keep or use again (a report, a calculator, a plan, a chart of numbers), not for a short reply.',
  'Pages run sealed off: no network, no external images, fonts or scripts, no links out, no forms — put everything inline (data: URLs for images).',
  'A chart is JSON: {"type":"bar"|"line"|"area"|"pie","title"?,"labels":[...],"series":[{"name","values":[numbers]}],"unit"?,"stacked"?}.',
  'A page that needs live data (prices, weather, a status) declares where it reads from, in the page: <script type="application/conch-data">{"name":{"url":"https://host/path?q={param}","params":{"param":{"choices":["a","b"]}|{"min":0,"max":100,"step":1}},"every":600}}</script>.',
  'The host is written out; the page fills in only the declared {params}. In its code, `const r = await conch.data("name", {param: "a"})` gives {ok, status, text, json(), at}; `conch.watch("name", {...}, r => …)` calls back now and on every refresh. The user is asked once per host; until then r.ok is false and r.message says why.',
].join('\n');

/** A fenced block a provider without tools writes: ```artifact kind="html" title="Budget"``` … ```. */
const FENCE =
  /```artifact\s+kind="([a-z]+)"\s+title="([^"\n]{1,80})"(?:\s+id="([A-Za-z0-9_]+)")?\s*\n([\s\S]*?)\n```/g;

export function fencedArtifacts(text: string) {
  const out: { kind: ArtifactKind; title: string; id?: string; content: string }[] = [];
  for (const m of text.matchAll(FENCE)) {
    const kind = ArtifactKind.safeParse(m[1]);
    if (kind.success && m[4]?.trim())
      out.push({
        kind: kind.data,
        title: m[2] ?? 'Untitled',
        ...(m[3] && { id: m[3] }),
        content: m[4],
      });
  }
  return out;
}

/** Content that's right for its kind, or a sentence the model can act on. */
export function checkContent(kind: ArtifactKind, content: string): string | undefined {
  const problem = artifactProblem(kind, content);
  // The model gets the shape too; a person sees where it broke in the editor.
  return problem && kind === 'chart' && /JSON has a mistake/.test(problem)
    ? `${problem} A chart must be JSON: {"type":"bar","labels":[…],"series":[{"name":"…","values":[…]}]}.`
    : problem;
}

/** The newest version, when it's the person's own edit: what the next turn must build on. */
const editedLatest = (artifact: Artifact) => {
  const latest = artifact.versions.at(-1);
  return latest?.edited ? latest : undefined;
};

export interface ArtifactDeps {
  store: ArtifactStore;
  conversations: () => ConversationManager;
  emit: (event: ServerEvent) => void;
  /** Who said which page may read from where (ADR 0046). */
  access: LiveDataAccess;
  /** Conch's own port: a page never reads from it. */
  gatewayPort: number;
  /** Reads for pages; a test's pretend network. */
  fetchLive?: typeof fetchLive;
}

/** Pages being edited, so their preview is served sealed like any other. Never written down. */
const DRAFTS = 20;

export class ArtifactService {
  readonly #drafts = new Map<string, { content: string; rev: number }>();
  readonly live: LiveData;

  constructor(private readonly deps: ArtifactDeps) {
    this.live = new LiveData({
      access: deps.access,
      gatewayPort: deps.gatewayPort,
      fetch: deps.fetchLive,
      page: async (id, version) => {
        const artifact = await this.deps.store.get(id);
        if (artifact.kind !== 'html')
          throw new LiveDataError('invalid', 'Only pages read live data.');
        const html =
          version === 'draft'
            ? this.#drafts.get(id)?.content
            : (await this.deps.store.content(id, version)).content;
        if (html === undefined) throw new LiveDataError('not-found', 'Nothing is being edited.');
        return { html, title: artifact.title };
      },
      tainted: async (id) => {
        const artifact = await this.deps.store.get(id);
        if (!artifact.conversationId) return undefined;
        const read = await this.deps
          .conversations()
          .taintOf(artifact.conversationId)
          .catch(() => []);
        return read.length ? describeTaint(read) : undefined;
      },
    });
  }

  get store() {
    return this.deps.store;
  }

  /** What you're editing, kept so the preview can be served (sealed) from the gateway. */
  async draft(id: string, content: string): Promise<{ rev: number; navigates: boolean }> {
    const artifact = await this.deps.store.get(id);
    if (artifact.kind !== 'html') throw new ArtifactError('invalid', 'Only pages have a preview.');
    if (content.length > ARTIFACT_MAX)
      throw new ArtifactError(
        'too-big',
        `That’s more than ${ARTIFACT_MAX.toLocaleString('en')} characters.`,
      );
    const rev = (this.#drafts.get(id)?.rev ?? 0) + 1;
    this.#drafts.delete(id);
    this.#drafts.set(id, { content, rev });
    for (const key of this.#drafts.keys()) {
      if (this.#drafts.size <= DRAFTS) break;
      this.#drafts.delete(key);
    }
    return { rev, navigates: navigates(content) };
  }

  /** The page you're editing, for its sealed preview. */
  draftContent(id: string): string | undefined {
    return this.#drafts.get(id)?.content;
  }

  /**
   * A version you made by hand (ADR 0046). It's marked as yours, the chat
   * it was made in says so, and the next turn there builds on it.
   */
  async edit(id: string, input: { content: string; base: number; force?: boolean }) {
    const current = await this.deps.store.get(id);
    const wrong = checkContent(current.kind, input.content);
    if (wrong) throw new ArtifactError('invalid', wrong);
    const artifact = await this.deps.store.addVersion(id, {
      content: input.content,
      note: 'Edited by you',
      edited: true,
      navigates: current.kind === 'html' && navigates(input.content),
      ...(!input.force && { base: input.base }),
    });
    this.#drafts.delete(id);
    this.#changed(artifact);
    if (artifact.conversationId)
      await this.deps
        .conversations()
        .note(artifact.conversationId, {
          type: 'artifact',
          artifactId: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          version: artifact.versions.at(-1)?.n ?? 1,
          action: 'edited',
          note: 'Edited by you',
        })
        .catch(() => undefined);
    return artifact;
  }

  #changed(artifact: Artifact) {
    this.deps.emit({ type: 'artifact.changed', artifact });
  }

  /** The user's own request, to refresh from: the last thing they said before it was made. */
  #request(events: readonly ConversationEvent[] | undefined): string | undefined {
    const said = [...(events ?? [])].reverse().find((e) => e.type === 'user.message');
    return said?.type === 'user.message' ? said.text.slice(0, 4000) : undefined;
  }

  async create(input: {
    conversationId: string;
    kind: ArtifactKind;
    title: string;
    content: string;
    note?: string;
    request?: string;
    operationId?: string;
  }): Promise<Artifact> {
    const wrong = checkContent(input.kind, input.content);
    if (wrong) throw new ArtifactError('invalid', wrong);
    const artifact = await this.deps.store.create({
      ...input,
      refresh: input.request,
      navigates: input.kind === 'html' && navigates(input.content),
    });
    this.#changed(artifact);
    return artifact;
  }

  async update(
    id: string,
    input: { content: string; note?: string; refreshed?: boolean; base?: number },
    options: { checkBase?: boolean } = {},
  ) {
    const current = await this.deps.store.get(id);
    // Your edit is never overwritten blindly: the model must say it started from it.
    const yours = editedLatest(current);
    if (options.checkBase && yours && input.base !== yours.n)
      throw new ArtifactError(
        'conflict',
        `The user edited “${current.title}” by hand: version ${yours.n} is theirs. Start from their version (under “Edited by the user” in your instructions), keep their changes, and send it again with base: ${yours.n}.`,
      );
    const wrong = checkContent(current.kind, input.content);
    if (wrong) throw new ArtifactError('invalid', wrong);
    const { base: _base, ...version } = input;
    const artifact = await this.deps.store.addVersion(id, {
      ...version,
      navigates: current.kind === 'html' && navigates(input.content),
    });
    this.#changed(artifact);
    return artifact;
  }

  async patch(id: string, body: { title?: string; pinned?: boolean; refresh?: string | null }) {
    const artifact = await this.deps.store.update(id, (a) => {
      const next: Artifact = { ...a, ...(body.title && { title: body.title }) };
      if (body.pinned === true) next.pinned = a.pinned ?? { at: Date.now() };
      if (body.pinned === false) delete next.pinned;
      if (body.refresh === null || body.refresh === '') delete next.refresh;
      else if (body.refresh) next.refresh = { prompt: body.refresh };
      return next;
    });
    this.#changed(artifact);
    return artifact;
  }

  async remove(id: string) {
    await this.deps.store.remove(id);
    this.#drafts.delete(id);
    await this.live.forget(id).catch(() => undefined);
    this.deps.emit({ type: 'artifact.deleted', artifactId: id });
  }

  #card(
    append: (e: ConversationEventInput) => void,
    artifact: Artifact,
    action: 'created' | 'updated',
  ) {
    const v = artifact.versions.at(-1);
    append({
      type: 'artifact',
      artifactId: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      version: v?.n ?? 1,
      action,
      ...(v?.note && { note: v.note }),
    });
  }

  /** `artifact_create` and `artifact_update`, for a chat. `only`: a refresh may update just this one. */
  tools(
    ctx: { conversationId: string; append: (event: ConversationEventInput) => void },
    options: { only?: string } = {},
  ): HostTool[] {
    const say = (a: Artifact, action: string) =>
      `${action} “${a.title}” (id ${a.id}, version ${a.versions.at(-1)?.n ?? 1}). The user sees it beside the chat; say in a sentence what it is, don’t repeat its contents.`;
    const fail = (error: unknown) =>
      error instanceof ArtifactError
        ? { text: error.message, isError: true }
        : Promise.reject(error);
    const update: HostTool = {
      name: 'artifact_update',
      description:
        'Make a new version of something you made with artifact_create: send the whole new content (not a diff), and a few words on what changed. If the user edited it by hand, start from their version and pass its number as base.',
      input: {
        id: z.string().max(64),
        content: z.string().min(1),
        note: z.string().max(200).optional(),
        base: z.number().int().positive().optional(),
      },
      run: async (args) => {
        const { id, content, note, base } = args as {
          id: string;
          content: string;
          note?: string;
          base?: number;
        };
        if (options.only && id !== options.only)
          return { text: `This chat can only update ${options.only}.`, isError: true };
        try {
          const artifact = await this.update(
            id,
            { content, note, base, refreshed: Boolean(options.only) },
            { checkBase: true },
          );
          this.#card(ctx.append, artifact, 'updated');
          return say(artifact, 'Updated');
        } catch (error) {
          return fail(error);
        }
      },
    };
    if (options.only) return [update];
    const create: HostTool = {
      name: 'artifact_create',
      verification: {
        effect: 'write',
        scope: async () => ({
          account: `local:${this.deps.store.dir}`,
          authorization: `artifact:create:${ctx.conversationId}`,
          expiresAt: Date.now() + 10 * 60_000,
        }),
        reconcile: async (args, operationId) => {
          try {
            const saved = await this.deps.store.content(
              artifactOperationId(ctx.conversationId, operationId),
              1,
            );
            if (
              saved.artifact.conversationId !== ctx.conversationId ||
              saved.artifact.kind !== args.kind ||
              saved.artifact.title !== args.title ||
              saved.content !== args.content
            )
              return { state: 'unknown' };
            return {
              state: 'confirmed',
              receipt: {
                provider: 'Conch',
                id: saved.artifact.id,
                label: `Saved “${saved.artifact.title}”`,
                url: `/api/artifacts/${saved.artifact.id}/versions/1/download`,
              },
            };
          } catch (error) {
            return {
              state:
                error instanceof ArtifactError && error.code === 'not-found' ? 'absent' : 'unknown',
            };
          }
        },
      },
      description: GUIDE,
      searchHint: 'artifact page app document chart diagram table svg mermaid visual dashboard',
      input: {
        kind: ArtifactKind,
        title: z.string().min(1).max(80),
        content: z.string().min(1),
        note: z.string().max(200).optional(),
      },
      run: async (args, context) => {
        const { kind, title, content, note } = args as {
          kind: ArtifactKind;
          title: string;
          content: string;
          note?: string;
        };
        const invalid =
          checkContent(kind, content) ??
          (content.length > ARTIFACT_MAX
            ? 'That document is too large. Save a shorter version.'
            : undefined);
        if (invalid) return { text: invalid, effect: 'not-executed' as const };
        try {
          const events = await this.deps
            .conversations()
            .eventsAfter(ctx.conversationId)
            .catch(() => undefined);
          const artifact = await this.create({
            conversationId: ctx.conversationId,
            kind,
            title,
            content,
            note,
            request: this.#request(events),
            operationId: context?.operationId,
          });
          this.#card(ctx.append, artifact, 'created');
          return say(artifact, 'Made');
        } catch (error) {
          return fail(error);
        }
      },
    };
    return [create, update];
  }

  /**
   * What the user changed by hand in this chat's artifacts (ADR 0046): the
   * newest version is theirs, so the next change starts from it.
   */
  async editedSection(conversationId: string | undefined): Promise<string> {
    if (!conversationId) return '';
    const mine = (await this.deps.store.list().catch(() => [] as Artifact[]))
      .filter((a) => a.conversationId === conversationId && editedLatest(a))
      .slice(0, 3);
    const parts: string[] = [];
    for (const artifact of mine) {
      const n = editedLatest(artifact)?.n ?? 1;
      const { content } = await this.deps.store
        .content(artifact.id, n)
        .catch(() => ({ content: '' }));
      parts.push(
        [
          `“${artifact.title}” (id ${artifact.id}): version ${n} was edited by the user, by hand. Build on it and keep their changes unless they ask otherwise; with artifact_update, pass base: ${n}.`,
          `\`\`\`${artifact.kind}\n${content.slice(0, 30_000)}\n\`\`\``,
        ].join('\n'),
      );
    }
    return parts.length ? `## Edited by the user\n\n${parts.join('\n\n')}` : '';
  }

  /** For providers without Conch's tools: how to make one in a reply. */
  promptSection(hostTools: boolean): string {
    if (hostTools)
      return `## Artifacts\nWhen the answer is something to see or use (a page, a document, a chart, a diagram, a table), make it with artifact_create; improve it with artifact_update.\n${GUIDE.split('\n').slice(-2).join('\n')}`;
    return [
      '## Artifacts',
      GUIDE,
      'To make one, write it in your reply as a fenced block, exactly:',
      '```artifact kind="html" title="Short title"',
      '…the whole content…',
      '```',
      'To change one, write it again with its id: ```artifact kind="html" title="Short title" id="a_…"```.',
    ].join('\n');
  }

  /**
   * A reply finished: take out any ```artifact blocks a provider without tools
   * wrote (ADR 0034). Text is collected from the chat's own log.
   */
  async onEvent(event: ServerEvent): Promise<void> {
    if (event.type !== 'conversation.event' || event.event.type !== 'turn.completed') return;
    const id = event.event.conversationId;
    const manager = this.deps.conversations();
    const detail = await manager.detail(id).catch(() => undefined);
    // Task side effects must pass their saved scope and write-ahead ledger.
    // Model text is never an alternate route around those controls.
    if (!detail || detail.conversation.origin?.kind === 'task') return;
    const events = await manager.eventsAfter(id).catch(() => [] as ConversationEvent[]);
    const turnStart = events.findLastIndex((e) => e.type === 'user.message');
    const text = events
      .slice(turnStart + 1)
      .map((e) => (e.type === 'assistant.delta' && e.kind === 'text' ? e.delta : ''))
      .join('');
    for (const block of fencedArtifacts(text)) {
      try {
        const existing = block.id
          ? await this.deps.store.get(block.id).catch(() => undefined)
          : undefined;
        const artifact =
          existing && existing.conversationId === id
            ? await this.update(existing.id, { content: block.content })
            : await this.create({
                conversationId: id,
                kind: block.kind,
                title: block.title,
                content: block.content,
                request: this.#request(events.slice(0, turnStart + 1)),
              });
        await manager.note(id, {
          type: 'artifact',
          artifactId: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          version: artifact.versions.at(-1)?.n ?? 1,
          action: existing ? 'updated' : 'created',
        });
      } catch {
        // A block that isn't a valid artifact stays what it was: text in the reply.
      }
    }
  }

  /**
   * Fresh data for a pinned app: a chat of its own that may only update this
   * artifact, asking first for anything risky, as every chat does.
   */
  async refresh(id: string): Promise<{ conversationId: string }> {
    const artifact = await this.deps.store.get(id);
    if (!artifact.refresh)
      throw new ArtifactError('invalid', 'This one has nothing to refresh from.');
    if (artifact.refreshing) return { conversationId: artifact.refreshing };
    const current = await this.deps.store.content(id);
    const manager = this.deps.conversations();
    // The chat's id, once it exists: its tool calls come after it does.
    const chat: { id?: string } = {};
    const started = await manager.start({
      title: `Refresh: ${artifact.title}`,
      text: [
        `Refresh “${artifact.title}” (id ${artifact.id}) with fresh, current data.`,
        `It was made for this request: ${artifact.refresh.prompt}`,
        `Keep its look and layout; change what has changed. Send the whole new version with artifact_update (base: ${current.n}), then say in one sentence what is new.`,
      ].join('\n\n'),
      origin: { kind: 'artifact', artifactId: id },
      extras: {
        tools: this.tools(
          {
            conversationId: '',
            append: (event) => {
              if (chat.id) void manager.note(chat.id, event as never);
            },
          },
          { only: id },
        ),
        systemExtra: `## The current version\n\n\`\`\`${artifact.kind}\n${current.content.slice(0, 60_000)}\n\`\`\``,
      },
    });
    chat.id = started.conversationId;
    const marked = await this.deps.store.update(id, (a) => ({
      ...a,
      refreshing: started.conversationId,
    }));
    this.#changed(marked);
    void started.result.finally(async () => {
      const done = await this.deps.store
        .update(id, (a) => {
          const { refreshing: _r, ...rest } = a;
          return rest;
        })
        .catch(() => undefined);
      if (done) this.#changed(done);
    });
    return { conversationId: started.conversationId };
  }

  /**
   * Repair everything: the list of sites pages may read from (ADR 0046). A
   * damaged list is set aside as it's read (pages ask again); OKs for pages
   * that are gone, or hosts a page no longer reads from, are tidied away.
   */
  liveDataCheck(): DoctorCheck {
    const item = (state: 'ok' | 'off' | 'fixed' | 'warning', message: string) => ({
      id: 'live-data',
      group: 'Your data',
      title: 'Live data in pages',
      state,
      message,
    });
    return {
      id: 'live-data',
      group: 'Your data',
      title: 'Live data in pages',
      run: async ({ repair }) => {
        const approvals = await this.deps.access.list();
        const all = await this.deps.store.list();
        const stale: { artifactId: string; host: string }[] = [];
        for (const a of approvals) {
          const page = all.find((p) => p.id === a.artifactId);
          if (!page) {
            stale.push(a);
            continue;
          }
          const html = await this.deps.store
            .content(page.id)
            .then((c) => c.content)
            .catch(() => undefined);
          if (html !== undefined && !readSources(html).sources.some((s) => s.host === a.host))
            stale.push(a);
        }
        if (stale.length && repair) {
          for (const s of stale) await this.deps.access.revoke(s.artifactId, s.host);
          return [
            item(
              'fixed',
              `Took back ${stale.length === 1 ? 'an OK' : `${stale.length} OKs`} for pages that no longer read from there.`,
            ),
          ];
        }
        const kept = approvals.length - (repair ? stale.length : 0);
        if (!kept) return [item('off', 'No page reads live data.')];
        const pages = new Set(approvals.map((a) => a.artifactId)).size;
        const local = approvals.some((a) => a.local);
        return [
          {
            ...item(
              local ? 'warning' : 'ok',
              `${pages === 1 ? 'One page reads' : `${pages} pages read`} live data from ${kept === 1 ? 'one site' : `${kept} sites`}${local ? ', one of them on this computer' : ''}.`,
            ),
            ...(local && {
              action: {
                kind: 'open' as const,
                label: 'Review',
                place: 'security' as const,
                focus: 'live-data',
              },
            }),
          },
        ];
      },
    };
  }

  /** Repair everything: the artifacts on disk can be read. */
  doctorCheck(): DoctorCheck {
    return {
      id: 'artifacts',
      group: 'Your data',
      title: 'Things you made',
      run: async () => {
        const all = await this.deps.store.list();
        const pinned = all.filter((a) => a.pinned).length;
        return [
          {
            id: 'artifacts',
            group: 'Your data',
            title: 'Things you made',
            state: all.length ? 'ok' : 'off',
            message: all.length
              ? `${all.length === 1 ? 'One thing' : `${all.length} things`} made in your chats${pinned ? `, ${pinned} pinned as ${pinned === 1 ? 'an app' : 'apps'}` : ''}.`
              : 'Nothing made yet.',
          },
        ];
      },
    };
  }
}
