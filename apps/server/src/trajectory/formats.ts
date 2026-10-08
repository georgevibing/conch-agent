/**
 * A chat's log as a trajectory (ADR 0113): the messages, tool calls and their
 * results in the order they happened, then written in the formats other tools
 * read — OpenAI's chat format for fine-tuning, ShareGPT as Hermes writes it,
 * Harbor's ATIF, and a page or Markdown a person reads.
 *
 * Every provider's turns reach the log as the same events, so a trajectory is
 * read the same way whoever answered. Everything that goes into one passes
 * through a `Redaction` first.
 */
import type { ConversationEvent, RunStep, RunTimeline, TurnCost, Usage } from '@conch/protocol';

import { compact } from '../conversations/store';
import type { Redaction } from './redact';
import { clip } from './timeline';

/** Most of one tool result kept in a trajectory. */
const RESULT_MAX = 50_000;

export interface TrajectoryCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type TrajectoryMessage =
  | { role: 'user'; at: number; text: string }
  | {
      role: 'assistant';
      at: number;
      text: string;
      thinking?: string;
      calls: TrajectoryCall[];
      /** On the turn's last reply: which model, what it used and cost. */
      model?: string;
      usage?: Usage;
      cost?: TurnCost;
    }
  | { role: 'tool'; at: number; callId: string; name: string; text: string; failed?: boolean };

export interface Trajectory {
  id: string;
  title: string;
  /** Who answered: the agent's name. */
  agent: string;
  startedAt: number;
  endedAt: number;
  models: string[];
  /** The last turn ended well. */
  completed: boolean;
  messages: TrajectoryMessage[];
  /** For the page and Markdown: the timeline, its words redacted too. */
  timeline: RunTimeline;
}

export interface TrajectoryChat {
  id: string;
  title: string;
  agent: string;
  timeline: RunTimeline;
}

/** A chat's log as messages, with everything in it redacted. */
export function trajectoryOf(
  chat: TrajectoryChat,
  log: ConversationEvent[],
  redaction: Redaction,
): Trajectory {
  const events = compact(log);
  const messages: TrajectoryMessage[] = [];
  const names = new Map<string, string>();
  const finished = new Set<string>();
  const models = new Set<string>();
  let completed = false;
  let reply: Extract<TrajectoryMessage, { role: 'assistant' }> | undefined;
  /** One of the reply's calls has its result: what comes next is a new message. */
  let answered = false;

  /** A call that never came back still needs its answer, or the file isn't valid. */
  const settle = () => {
    for (const call of reply?.calls ?? []) {
      if (finished.has(call.id)) continue;
      finished.add(call.id);
      messages.push({
        role: 'tool',
        at: reply?.at ?? 0,
        callId: call.id,
        name: call.name,
        text: 'No result: the turn ended first.',
        failed: true,
      });
    }
  };
  const fresh = (at: number) => {
    settle();
    reply = { role: 'assistant', at, text: '', calls: [] };
    answered = false;
    messages.push(reply);
    return reply;
  };

  for (const e of events) {
    switch (e.type) {
      case 'user.message':
        settle();
        reply = undefined;
        messages.push({ role: 'user', at: e.at, text: redaction.text(e.text) });
        break;
      case 'assistant.delta': {
        if (!e.delta) break;
        const thinking = e.kind === 'thinking';
        // Thinking comes before a message's words, and both before its calls.
        const to =
          !reply || reply.calls.length > 0 || (thinking && reply.text) ? fresh(e.at) : reply;
        if (thinking) to.thinking = (to.thinking ?? '') + redaction.text(e.delta);
        else to.text += redaction.text(e.delta);
        break;
      }
      case 'tool.started': {
        const to = !reply || answered ? fresh(e.at) : reply;
        names.set(e.toolUseId, e.name);
        to.calls.push({ id: e.toolUseId, name: e.name, arguments: redaction.value(e.input ?? {}) });
        break;
      }
      case 'tool.finished': {
        const name = names.get(e.toolUseId);
        if (!name || finished.has(e.toolUseId)) break;
        finished.add(e.toolUseId);
        answered = true;
        const declined =
          e.approval === 'declined' || e.approval === 'expired' || e.approval === 'refused';
        messages.push({
          role: 'tool',
          at: e.at,
          callId: e.toolUseId,
          name,
          text: declined
            ? e.approval === 'refused'
              ? 'Not run: a rule in Conch stopped it.'
              : 'Not run: the person said no.'
            : clip(redaction.text(e.output ?? ''), RESULT_MAX),
          ...((e.status === 'error' || declined) && { failed: true }),
        });
        break;
      }
      case 'turn.completed': {
        settle();
        completed = e.outcome === 'success';
        if (e.model) models.add(e.model);
        // The turn's tally goes on its last reply.
        const last = messages.findLast((m) => m.role === 'assistant');
        if (last?.role === 'assistant') {
          if (e.model) last.model = e.model;
          if (e.usage) last.usage = e.usage;
          if (e.cost) last.cost = e.cost;
        }
        reply = undefined;
        break;
      }
      default:
        break;
    }
  }
  settle();

  return {
    id: chat.id,
    title: redaction.text(chat.title),
    agent: chat.agent,
    startedAt: chat.timeline.startedAt,
    endedAt: chat.timeline.endedAt,
    models: [...models],
    completed,
    messages: messages.filter(
      (m) => m.role !== 'assistant' || m.text || m.thinking || m.calls.length,
    ),
    timeline: redactTimeline(chat.timeline, redaction),
  };
}

function redactTimeline(timeline: RunTimeline, redaction: Redaction): RunTimeline {
  const text = <T extends string | undefined>(value: T): T =>
    (value === undefined ? value : redaction.text(value)) as T;
  return {
    ...timeline,
    title: redaction.text(timeline.title),
    steps: timeline.steps.map((s): RunStep => ({
      ...s,
      title: text(s.title),
      detail: text(s.detail),
      peek: text(s.peek),
      diff: text(s.diff),
      url: text(s.url),
      ...(s.files && { files: s.files.map((f) => ({ ...f, path: redaction.text(f.path) })) }),
    })),
  };
}

const iso = (at: number) => new Date(at).toISOString();
const json = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

// ── OpenAI chat (fine-tuning JSONL) ─────────────────────────────────────────

export function toOpenAI(t: Trajectory): Record<string, unknown> {
  const tools = new Set<string>();
  let parallel = false;
  const messages = t.messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.callId, content: m.text };
    if (m.calls.length > 1) parallel = true;
    for (const c of m.calls) tools.add(c.name);
    return {
      role: 'assistant',
      content: m.text || null,
      ...(m.calls.length && {
        tool_calls: m.calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: json(c.arguments) },
        })),
      }),
    };
  });
  return {
    messages,
    ...(tools.size && {
      // The log keeps each call, not the schema it was offered with: each tool by name.
      tools: [...tools].map((name) => ({
        type: 'function',
        function: { name, parameters: { type: 'object' } },
      })),
      parallel_tool_calls: parallel,
    }),
  };
}

// ── ShareGPT, as Hermes Agent writes it ─────────────────────────────────────

export function toShareGPT(t: Trajectory): Record<string, unknown> {
  const conversations: { from: string; value: string }[] = [];
  let results: string[] = [];
  const flush = () => {
    if (results.length) conversations.push({ from: 'tool', value: results.join('\n') });
    results = [];
  };
  for (const m of t.messages) {
    if (m.role === 'tool') {
      results.push(
        `<tool_response>\n${json({ tool_call_id: m.callId, name: m.name, content: m.text })}\n</tool_response>`,
      );
      continue;
    }
    flush();
    if (m.role === 'user') conversations.push({ from: 'human', value: m.text });
    else
      conversations.push({
        from: 'gpt',
        value: [
          `<think>\n${m.thinking?.trim() ?? ''}\n</think>`,
          m.text.trim(),
          ...m.calls.map(
            (c) => `<tool_call>\n${json({ name: c.name, arguments: c.arguments })}\n</tool_call>`,
          ),
        ]
          .filter(Boolean)
          .join('\n'),
      });
  }
  flush();
  return {
    conversations,
    timestamp: iso(t.startedAt),
    model: t.models.at(-1) ?? 'unknown',
    completed: t.completed,
  };
}

// ── ATIF (Harbor's Agent Trajectory Interchange Format) ─────────────────────

export const ATIF_VERSION = 'ATIF-v1.8';

export function toATIF(t: Trajectory, conchVersion: string): Record<string, unknown> {
  const steps: Record<string, unknown>[] = [];
  const results = new Map<string, Record<string, unknown>>(); // call id → its step
  let totals = { prompt: 0, completion: 0, cached: 0, cost: 0 };
  for (const m of t.messages) {
    if (m.role === 'user') {
      steps.push({
        step_id: steps.length + 1,
        timestamp: iso(m.at),
        source: 'user',
        message: m.text,
      });
      continue;
    }
    if (m.role === 'tool') {
      const step = results.get(m.callId);
      if (!step) continue;
      const observation = (step.observation ??= { results: [] }) as {
        results: { source_call_id: string; content: string }[];
      };
      observation.results.push({ source_call_id: m.callId, content: m.text });
      continue;
    }
    const step: Record<string, unknown> = {
      step_id: steps.length + 1,
      timestamp: iso(m.at),
      source: 'agent',
      message: m.text,
      ...(m.model && { model_name: m.model }),
      ...(m.thinking?.trim() && { reasoning_content: m.thinking.trim() }),
      ...(m.calls.length && {
        tool_calls: m.calls.map((c) => ({
          tool_call_id: c.id,
          function_name: c.name,
          arguments:
            c.arguments && typeof c.arguments === 'object' && !Array.isArray(c.arguments)
              ? c.arguments
              : { value: c.arguments },
        })),
      }),
    };
    if (m.usage || m.cost?.usd !== undefined) {
      const cost = m.cost?.billing === 'plan' ? undefined : m.cost?.usd;
      step.metrics = {
        ...(m.usage && {
          prompt_tokens: m.usage.inputTokens,
          completion_tokens: m.usage.outputTokens,
          ...(m.usage.cachedInputTokens !== undefined && {
            cached_tokens: m.usage.cachedInputTokens,
          }),
        }),
        ...(cost !== undefined && { cost_usd: cost }),
      };
      totals = {
        prompt: totals.prompt + (m.usage?.inputTokens ?? 0),
        completion: totals.completion + (m.usage?.outputTokens ?? 0),
        cached: totals.cached + (m.usage?.cachedInputTokens ?? 0),
        cost: totals.cost + (cost ?? 0),
      };
    }
    for (const c of m.calls) results.set(c.id, step);
    steps.push(step);
  }
  return {
    schema_version: ATIF_VERSION,
    session_id: t.id,
    agent: {
      name: 'conch',
      version: conchVersion,
      model_name: t.models.at(-1) ?? 'unknown',
      extra: { assistant: t.agent },
    },
    steps,
    notes: t.title,
    final_metrics: {
      total_prompt_tokens: totals.prompt,
      total_completion_tokens: totals.completion,
      total_cached_tokens: totals.cached,
      total_cost_usd: Math.round(totals.cost * 1e6) / 1e6,
      total_steps: steps.length,
    },
  };
}

// ── Words for a person: Markdown and a page ─────────────────────────────────

export function duration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${(Math.round(s * 10) / 10).toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

const usd = (n: number) => (n === 0 ? '' : n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);

/** "4m 12s · 23 steps · 18.2k tokens · $0.06". */
export function tally(timeline: RunTimeline): string {
  const t = timeline.totals;
  return [
    duration(t.durationMs),
    `${timeline.steps.length} ${timeline.steps.length === 1 ? 'step' : 'steps'}`,
    t.inputTokens + t.outputTokens > 0 ? `${tokens(t.inputTokens + t.outputTokens)} tokens` : '',
    usd(t.usd),
    t.planTurns ? 'on your plan' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const day = (at: number) =>
  new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const fence = (text: string) => {
  const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}\n${text}\n${ticks}`;
};

const MARK: Record<string, string> = {
  done: '',
  failed: ' — didn’t work',
  declined: ' — not done',
  waiting: ' — waiting',
};

export function toMarkdown(list: Trajectory[], heading: string): string {
  const out: string[] = [`# ${heading}`, ''];
  for (const t of list) {
    const tl = t.timeline;
    out.push(
      `## ${t.title}`,
      '',
      `_${day(t.startedAt)} · ${t.agent}${t.models.length ? ` · ${t.models.join(', ')}` : ''} · ${tally(tl)}_`,
      '',
    );
    for (const s of tl.steps) {
      const when = duration(s.at - tl.startedAt);
      if (s.kind === 'asked') {
        out.push(`### You · ${when}`, '', s.peek ?? s.title.replace(/^/, ''), '');
        continue;
      }
      if (s.kind === 'said') {
        out.push(`**${t.agent}** · ${when}`, '', s.peek ?? s.title, '');
        continue;
      }
      const took = s.durationMs ? ` (${duration(s.durationMs)})` : '';
      out.push(
        `- ${s.kind === 'thought' ? '_Thought it through_' : s.title}${took}${s.detail ? ` — ${s.detail}` : ''}${MARK[s.status ?? 'done'] ?? ''}`,
      );
      if (s.diff)
        out.push(
          '',
          fence(s.diff).replace(/^```+/, (m) => `${m}diff`),
          '',
        );
      else if (s.peek && s.kind !== 'thought') out.push('', fence(clip(s.peek, 1200)), '');
    }
    out.push('');
  }
  return `${out.join('\n').trim()}\n`;
}

const html = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1b18;--muted:#6b665e;--line:#e7e2d9;--card:#fff;--accent:#8a6bd1;--ok:#2f7d5b;--bad:#b4533a;--add:#e6f4ea;--del:#fbe9e7}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece8e1;--muted:#a19a8f;--line:#2e2b27;--card:#1e1c19;--accent:#b49cf0;--ok:#6cc59a;--bad:#e58a6f;--add:#1f3326;--del:#3a221d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:3rem 1.25rem 5rem}h1{font:600 2rem/1.2 ui-serif,Georgia,serif;margin:0 0 .25rem}
.lede{color:var(--muted);margin:0 0 2.5rem}article{margin:0 0 3.5rem}h2{font:600 1.35rem/1.3 ui-serif,Georgia,serif;margin:0 0 .25rem}
.meta{color:var(--muted);font-size:.85rem;margin:0 0 1rem}.bar{display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden;margin:0 0 1.5rem}
.bar i{display:block;min-width:2px;background:var(--line)}.bar i[data-k=tool]{background:var(--accent)}.bar i[data-k=approval]{background:#d6a33c}.bar i[data-s=failed]{background:var(--bad)}
ol{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}li{position:relative;margin:0 0 .9rem;padding-left:1.1rem}
li::before{content:"";position:absolute;left:-6px;top:.5rem;width:10px;height:10px;border-radius:50%;background:var(--card);border:2px solid var(--accent)}
li[data-k=asked]::before{background:var(--fg);border-color:var(--fg)}li[data-s=failed]::before{border-color:var(--bad)}li[data-s=declined]::before{border-style:dashed}
.t{font-weight:500}.d{color:var(--muted)}.w{color:var(--muted);font-variant-numeric:tabular-nums;font-size:.8rem;margin-left:.4rem}
.words{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.75rem 1rem;margin:.35rem 0 0}
details{margin:.35rem 0 0}summary{cursor:pointer;color:var(--muted);font-size:.85rem}pre{white-space:pre-wrap;word-break:break-word;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;margin:.35rem 0 0;max-height:24rem;overflow:auto}
pre .a{background:var(--add);display:block}pre .r{background:var(--del);display:block}footer{color:var(--muted);font-size:.8rem;border-top:1px solid var(--line);padding-top:1rem}
`;

function stepHtml(s: RunStep, t: Trajectory): string {
  const when = `<span class="w">${html(duration(s.at - t.timeline.startedAt))}${s.durationMs ? ` · took ${html(duration(s.durationMs))}` : ''}</span>`;
  const attrs = `data-k="${s.kind}" data-s="${s.status ?? 'done'}"`;
  if (s.kind === 'asked' || s.kind === 'said')
    return `<li ${attrs}><span class="t">${s.kind === 'asked' ? 'You' : html(t.agent)}</span>${when}<div class="words">${html(s.peek ?? s.title)}</div></li>`;
  const diff = s.diff
    ? `<details><summary>What changed</summary><pre>${s.diff
        .split('\n')
        .map((l) =>
          l.startsWith('+')
            ? `<span class="a">${html(l)}</span>`
            : l.startsWith('-')
              ? `<span class="r">${html(l)}</span>`
              : html(l),
        )
        .join('\n')}</pre></details>`
    : '';
  const peek =
    !s.diff && s.peek
      ? `<details><summary>${s.kind === 'thought' ? 'The thought' : 'What came back'}</summary><pre>${html(s.peek)}</pre></details>`
      : '';
  const mark = MARK[s.status ?? 'done'] ?? '';
  return `<li ${attrs}><span class="t">${html(s.title)}</span>${mark ? `<span class="d">${html(mark)}</span>` : ''}${when}${s.detail ? `<div class="d">${html(s.detail)}</div>` : ''}${diff}${peek}</li>`;
}

/**
 * A page to read: self-contained, with no script and nothing fetched (its own
 * policy says so), every word escaped. It opens anywhere and shows only text.
 */
export function toHtml(list: Trajectory[], heading: string, made: string): string {
  const articles = list.map((t) => {
    const tl = t.timeline;
    const span = Math.max(1, tl.endedAt - tl.startedAt);
    const bar = tl.steps
      .filter((s) => s.kind !== 'asked' && s.kind !== 'said')
      .slice(0, 400)
      .map(
        (s) =>
          `<i data-k="${s.kind}" data-s="${s.status ?? 'done'}" style="flex:${Math.max(1, Math.round(((s.durationMs ?? 0) / span) * 1000))}"></i>`,
      )
      .join('');
    return `<article><h2>${html(t.title)}</h2><p class="meta">${html(`${day(t.startedAt)} · ${t.agent}${t.models.length ? ` · ${t.models.join(', ')}` : ''} · ${tally(tl)}`)}</p>${bar ? `<div class="bar" aria-hidden="true">${bar}</div>` : ''}<ol>${tl.steps.map((s) => stepHtml(s, t)).join('')}</ol></article>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(heading)}</title><style>${STYLE}</style></head>
<body><main><h1>${html(heading)}</h1><p class="lede">${html(made)}</p>${articles.join('\n')}<footer>Saved from Conch on this computer. Nothing in this page loads from anywhere.</footer></main></body></html>
`;
}
