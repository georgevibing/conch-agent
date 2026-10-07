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

/**
 * Why a finished task is worth a look, in a few words a person reads, only
 * when there's a concrete reason: an action whose result it couldn't confirm,
 * or something it was asked for that isn't confirmed. Nothing to check it
 * against, or a tool that can't say what it did, is no reason: done is done.
 */
export function taskWorth(task: Task): string | undefined {
  if (task.status !== 'unverified') return undefined;
  const { verdict, reasons } = assessTask(task);
  if (verdict === 'uncertain') {
    const n = reasons.filter((r) => r.code === 'effect-uncertain').length;
    return n === 1
      ? 'Couldn’t confirm one of its actions worked.'
      : `Couldn’t confirm ${n} of its actions worked.`;
  }
  if (verdict === 'incomplete')
    return reasons.some((r) => r.code === 'response-missing')
      ? 'It finished without returning an answer.'
      : 'Some of what it was asked for isn’t confirmed.';
  return undefined;
}
