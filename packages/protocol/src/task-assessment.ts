/** One assessment for tools, health and UI. Execution completion is not goal verification. */
import type { Task, TaskExpectation, TaskOperation } from './tasks';

export function uncertainEffect(op: TaskOperation): boolean {
  return (
    op.effect !== 'read' &&
    op.state !== 'confirmed' &&
    op.state !== 'not-run' &&
    (op.execution !== 'succeeded' || op.receiptExpected === true)
  );
}

export function assessTask(task: Task) {
  const operations = task.operations ?? [];
  const expectations = task.expectations ?? [];
  const current = operations.filter((op) => (op.goalRevision ?? 0) === (task.goalRevision ?? 0));
  const latestByKey = new Map(current.map((op) => [op.key, op]));
  const confirmed = current.filter(
    (op) =>
      op.state === 'confirmed' &&
      op.receipt &&
      (op.effect !== 'read' || latestByKey.get(op.key) === op),
  );
  // A count may require repeated observations (for example two clock samples).
  // A pending/failed newer read invalidates everything before it for that identity.
  const lastInvalidRead = new Map<string, number>();
  current.forEach((op, i) => {
    if (op.effect === 'read' && (op.state !== 'confirmed' || !op.receipt))
      lastInvalidRead.set(op.key, i);
  });
  const observations = current.filter(
    (op, i) =>
      op.state === 'confirmed' &&
      op.receipt &&
      (op.effect !== 'read' || i > (lastInvalidRead.get(op.key) ?? -1)),
  );
  const missing = expectations.filter((expected: TaskExpectation) => {
    if (
      // An exact receipt still requires the latest result, never an obsolete sample.
      (expected.receipt ? confirmed : observations).filter(
        (op) =>
          op.tool === expected.tool &&
          (!expected.inputHash || op.inputHash === expected.inputHash) &&
          (!expected.receipt ||
            (op.receipt?.provider === expected.receipt.provider &&
              op.receipt.id === expected.receipt.id)),
      ).length >= expected.minimum
    )
      return false;
    const sources = current.filter(
      (op) => op.tool === expected.unlessEmpty && op.effect === 'read',
    );
    const latest = sources.filter((op) => latestByKey.get(op.key) === op);
    return (
      !latest.length ||
      !latest.every((op) => op.state === 'confirmed' && op.receipt?.empty === true) ||
      sources.some((op) => op.state === 'confirmed' && op.receipt?.empty !== true)
    );
  });
  const response = task.completion === 'response' && !expectations.length;
  const delivered =
    response &&
    Boolean(task.summary?.trim()) &&
    task.delivery?.goalRevision === (task.goalRevision ?? 0) &&
    task.delivery?.attempt === (task.attempt ?? 0);
  const uncertain = operations.filter(uncertainEffect);
  const reasons = [
    ...uncertain.map((op) => ({
      code: 'effect-uncertain' as const,
      operationId: op.id,
      tool: op.tool,
    })),
    ...operations
      .filter(
        (op) =>
          op.effect !== 'read' &&
          op.state === 'unresolved' &&
          op.execution === 'succeeded' &&
          !op.receiptExpected,
      )
      .map((op) => ({ code: 'receipt-unavailable' as const, operationId: op.id, tool: op.tool })),
    ...missing.map((expectation) => ({
      code: 'required-evidence-missing' as const,
      tool: expectation.tool,
      minimum: expectation.minimum,
    })),
    ...(response && !delivered ? [{ code: 'response-missing' as const }] : []),
    ...(!expectations.length && !response ? [{ code: 'no-criteria' as const }] : []),
  ];
  const unsupported = reasons.some((reason) => reason.code === 'receipt-unavailable');
  const verdict = uncertain.length
    ? 'uncertain'
    : missing.length
      ? 'incomplete'
      : response && !delivered
        ? 'incomplete'
        : unsupported
          ? 'unsupported'
          : response
            ? 'delivered'
            : !expectations.length
              ? 'unchecked'
              : 'verified';
  return {
    verdict,
    reasons,
    confirmed: confirmed.length,
    failedReads: current.filter((op) => op.effect === 'read' && op.execution === 'failed').length,
  };
}

/** What one call is, in a word a person reads. */
function kindOf(tool: string): 'command' | 'file change' | 'action' {
  const name = tool.replace(/^mcp__conch__/, '');
  if (/^(?:Bash|PowerShell|process_start|process_write)$/.test(name)) return 'command';
  if (/^(?:Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) return 'file change';
  return 'action';
}

/** "one of its commands", "2 of its file changes", "3 of its actions". */
function ofIts(tools: string[]): string {
  const kinds = new Set(tools.map(kindOf));
  const kind = kinds.size === 1 ? [...kinds][0] : 'action';
  return `${tools.length === 1 ? 'one' : tools.length} of its ${kind}s`;
}

type Reasons = ReturnType<typeof assessTask>['reasons'];
const toolsFor = (reasons: Reasons, code: 'effect-uncertain' | 'receipt-unavailable') =>
  reasons.flatMap((r) => (r.code === code ? [r.tool] : []));

/**
 * Why a finished task is worth a look, in a few words a person reads, only
 * when there's a concrete reason: an action whose result it couldn't confirm,
 * or something it was asked for that isn't confirmed. Nothing to check it
 * against, or a tool that can't say what it did, is no reason: done is done.
 * A call Conch refused before it ran never counts: it didn't happen.
 */
export function taskWorth(task: Task): string | undefined {
  if (task.status !== 'unverified') return undefined;
  const { verdict, reasons } = assessTask(task);
  if (verdict === 'uncertain')
    return `Couldn’t confirm ${ofIts(toolsFor(reasons, 'effect-uncertain'))} worked.`;
  if (verdict === 'incomplete')
    return reasons.some((r) => r.code === 'response-missing')
      ? 'It finished without returning an answer.'
      : 'Some of what it was asked for isn’t confirmed.';
  return undefined;
}

/**
 * The actions whose result Conch couldn't confirm, in a sentence, however the
 * task ended: what its card's Details says. Nothing when there are none.
 */
export function taskDoubt(task: Task): string | undefined {
  const tools = (task.operations ?? []).filter(uncertainEffect).map((op) => op.tool);
  return tools.length
    ? `Conch couldn’t confirm whether ${ofIts(tools)} worked, so it won’t run that again by itself.`
    : undefined;
}

/**
 * How a finished task went, beyond "done", in a sentence for the chat it came
 * from: why Conch couldn't vouch for it, never as if the answer were wrong.
 * Nothing when it's simply done.
 */
export function taskOutcome(task: Task): string | undefined {
  const { verdict, reasons } = assessTask(task);
  switch (verdict) {
    case 'uncertain':
      return `It finished, but ${taskDoubt(task) ?? ''} Look at the result before trying again.`;
    case 'incomplete': {
      if (reasons.some((r) => r.code === 'response-missing'))
        return 'It finished without returning an answer.';
      const tools = new Set(
        reasons.flatMap((r) => (r.code === 'required-evidence-missing' ? [r.tool] : [])),
      );
      return `It finished, but these checks aren’t confirmed yet: ${[...tools].map((t) => `\`${t}\``).join(', ')}.`;
    }
    case 'unsupported': {
      const tools = toolsFor(reasons, 'receipt-unavailable');
      const none = task.expectations?.length ? '' : ', and no checks were set for this task';
      return `It finished. Conch can’t confirm what ${ofIts(tools)} did, since ${tools.length === 1 ? 'it gives' : 'they give'} no receipt${none}.`;
    }
    case 'unchecked':
      return 'It finished. No checks were set for this task, so Conch didn’t check the result.';
    default:
      return undefined;
  }
}
