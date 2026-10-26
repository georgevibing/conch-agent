/**
 * Why a question reached a person, as one kind of reason (ADR 0150): what Auto's ask rate is
 * counted by on a dashboard (`conch.auto.questions`) and what `pnpm auto:replay` groups the
 * person's answers by.
 *
 * Read only from what the question already carries (its words, the class Always allow would
 * lift, Explicit Ask, a price) and the step itself, judged again by the same pure rules. Never
 * a command, an argument or a word leaves this file: only the kind.
 */
import { breaksCircuit, assessRisk, type RiskContext, type RiskKind } from './risk';

/** Every kind of risk, once: a new kind doesn't compile until it's here. */
const RISK_KINDS: Record<RiskKind, true> = {
  'remote-code': true,
  credentials: true,
  exfiltration: true,
  wipe: true,
  history: true,
  privilege: true,
  persistence: true,
  'safety-off': true,
  infra: true,
  publish: true,
  egress: true,
  install: true,
  'app-delete': true,
  spend: true,
  disrupt: true,
};

/** What isn't a risk kind: why else a question reaches a person. */
const OTHER_REASONS = [
  /** Asked only because the chat read something: a second look, a way out, a sink. */
  'after-reading',
  /** What the chat did across steps: a crowd of recipients, a run of deletes, a loop. */
  'pattern',
  /** Deleting a whole folder or disk: asks in every mode. */
  'circuit',
  /** The person set this tool to Ask in Apps. */
  'explicit',
  /** Someone else's app's step, and nothing could judge it: its own question stood. */
  'unavailable-review',
  /** The browser's own questions: a site, buying, sending, a download or an upload. */
  'browser',
  'other',
] as const;

export type AskReason = RiskKind | (typeof OTHER_REASONS)[number];

/** Every reason, for the label's fixed list (`telemetry/labels.ts`). */
export const ASK_REASONS: readonly AskReason[] = [
  ...(Object.keys(RISK_KINDS) as RiskKind[]),
  ...OTHER_REASONS,
];

const isRiskKind = (kind: string): kind is RiskKind => Object.hasOwn(RISK_KINDS, kind);

/** A question, as `askUser` gets it or as the log keeps it (`permission.requested`). */
export interface AskShape {
  toolName: string;
  input: unknown;
  taint?: string;
  /** What Always allow would lift: `risk:<kind>:<reason>`, `read:<tool>`, `box:<tool>`. */
  waive?: string;
  explicit?: boolean;
  cost?: string;
  vault?: unknown;
  browser?: { kind?: string };
  appStep?: unknown;
}

/** The card's words for a risk or a pattern (`riskWords`, `patternWords`). */
const THIS_WOULD = /^This would .+ So I’m checking first\.$/s;
/** A command leaving the sealed box after reading (`legacyMustAsk`), as the log keeps it. */
const OUT_OF_THE_BOX = /outside the sealed box|can’t seal commands|Sealing is off/;

/** One kind of reason for a question that reached a person. */
export function askReason(
  request: AskShape,
  context: Pick<RiskContext, 'workspace' | 'home'>,
): AskReason {
  if (request.explicit) return 'explicit';
  if (request.cost) return 'spend';
  if (request.vault || request.browser?.kind === 'fill') return 'credentials';
  if (request.browser) return 'browser';
  const waive = request.waive ?? '';
  if (waive === 'risk:second-look') return 'after-reading';
  const lifted = /^risk:([a-z-]+)(?::|$)/.exec(waive)?.[1];
  if (lifted && isRiskKind(lifted)) return lifted;
  const taint = request.taint ?? '';
  if (!taint) return 'other';
  const critical = breaksCircuit(request.toolName, request.input, context);
  if (critical && taint.includes(critical.reason)) return 'circuit';
  // The same rule again, as the step's own tool would have been read: an app's change, a delete.
  for (const extra of [{}, { access: 'write' as const }, { destructive: true }]) {
    const risk = assessRisk(request.toolName, request.input, { ...context, ...extra });
    if (risk && taint.includes(risk.reason)) return risk.kind;
  }
  if (THIS_WOULD.test(taint)) return 'pattern';
  if (waive.startsWith('read:') && request.appStep) return 'unavailable-review';
  if (
    waive.startsWith('read:') ||
    waive.startsWith('box:') ||
    taint.includes('So I’m checking before I ') ||
    OUT_OF_THE_BOX.test(taint)
  )
    return 'after-reading';
  return 'other';
}
