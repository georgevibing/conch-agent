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
  const missing = expectations.filter((expected: TaskExpectation) => {
    if (
      confirmed.filter(
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
    ...(!expectations.length ? [{ code: 'no-criteria' as const }] : []),
  ];
  const unsupported = reasons.some((reason) => reason.code === 'receipt-unavailable');
  const verdict = uncertain.length
    ? 'uncertain'
    : missing.length
      ? 'incomplete'
      : !expectations.length
        ? 'unchecked'
        : unsupported
          ? 'unsupported'
          : 'verified';
  return {
    verdict,
    reasons,
    confirmed: confirmed.length,
    failedReads: current.filter((op) => op.effect === 'read' && op.execution === 'failed').length,
  };
}
