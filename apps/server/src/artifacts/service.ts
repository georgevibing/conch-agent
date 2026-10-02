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
  ChartSpec,
  type Artifact,
  type ConversationEvent,
  type ConversationEventInput,
  type ServerEvent,
} from '@conch/protocol';
import { z } from 'zod';

import type { ConversationManager } from '../conversations/manager';
import type { DoctorCheck } from '../doctor/service';
import type { HostTool } from '../engines/types';
import { navigates } from './frame';
import { artifactOperationId, ArtifactError, type ArtifactStore } from './store';

/** The words a model reads to know when and how to make one. */
const GUIDE = [
  'Make something the user can see and use beside the chat: a page or small app (`html`, one self-contained file with inline CSS and JS),',
  'a document (`markdown`), a picture or diagram (`svg`), a diagram in Mermaid (`mermaid`), a chart (`chart`) or a table (`table`, CSV with a header row).',
  'Use it when the answer is something to look at, keep or use again (a report, a calculator, a plan, a chart of numbers), not for a short reply.',
  'Pages run sealed off: no network, no external images, fonts or scripts, no links out, no forms — put everything inline (data: URLs for images).',
  'A chart is JSON: {"type":"bar"|"line"|"area"|"pie","title"?,"labels":[...],"series":[{"name","values":[numbers]}],"unit"?,"stacked"?}.',
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
  if (!content.trim()) return 'It’s empty. Send the whole thing.';
  if (kind === 'chart') {
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      return 'A chart must be JSON: {"type":"bar","labels":[…],"series":[{"name":"…","values":[…]}]}.';
    }
    const spec = ChartSpec.safeParse(json);
    if (!spec.success)
      return `The chart doesn’t fit: ${spec.error.issues[0]?.path.join('.')} ${spec.error.issues[0]?.message}.`;
    if (spec.data.series.some((s) => s.values.length !== spec.data.labels.length))
      return 'Each series needs one value per label.';
  }
  if (kind === 'svg' && !/<svg[\s>]/i.test(content)) return 'An svg must start with <svg …>.';
  if (kind === 'table' && content.split(/\r?\n/).filter(Boolean).length < 2)
    return 'A table needs a header row and at least one row of data.';
  return undefined;
}

export interface ArtifactDeps {
  store: ArtifactStore;
  conversations: () => ConversationManager;
  emit: (event: ServerEvent) => void;
}

export class ArtifactService {
  constructor(private readonly deps: ArtifactDeps) {}

  get store() {
    return this.deps.store;
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

  async update(id: string, input: { content: string; note?: string; refreshed?: boolean }) {
    const current = await this.deps.store.get(id);
    const wrong = checkContent(current.kind, input.content);
    if (wrong) throw new ArtifactError('invalid', wrong);
    const artifact = await this.deps.store.addVersion(id, {
      ...input,
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
        'Make a new version of something you made with artifact_create: send the whole new content (not a diff), and a few words on what changed.',
      input: {
        id: z.string().max(64),
        content: z.string().min(1),
        note: z.string().max(200).optional(),
      },
      run: async (args) => {
        const { id, content, note } = args as { id: string; content: string; note?: string };
        if (options.only && id !== options.only)
          return { text: `This chat can only update ${options.only}.`, isError: true };
        try {
          const artifact = await this.update(id, {
            content,
            note,
            refreshed: Boolean(options.only),
          });
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

  /** For providers without Conch's tools: how to make one in a reply. */
  promptSection(hostTools: boolean): string {
    if (hostTools)
      return '## Artifacts\nWhen the answer is something to see or use (a page, a document, a chart, a diagram, a table), make it with artifact_create; improve it with artifact_update.';
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
        'Keep its look and layout; change what has changed. Send the whole new version with artifact_update, then say in one sentence what is new.',
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
