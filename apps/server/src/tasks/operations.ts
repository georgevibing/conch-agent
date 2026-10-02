/** Write-ahead, fail-closed effect ledger. Model text is never evidence. */
import { createHash } from 'node:crypto';

import { TaskReceipt, type Task, type TaskOperation } from '@conch/protocol';

import type { HostTool } from '../engines/types';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const unresolved =
  'This action may already have happened. Conch cannot prove its result, so it will not repeat it. Inspect the original app before continuing.';

export class TaskOperations {
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #nativeChecks = new Map<string, Set<string>>();
  constructor(
    private readonly get: () => Promise<Task>,
    private readonly update: (change: (task: Task) => Partial<Task>) => Promise<Task>,
    private readonly stopped: () => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  #serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (this.#locks.get(key) ?? Promise.resolve()).then(run);
    this.#locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  async #save(operation: TaskOperation): Promise<void> {
    await this.update((task) => ({
      operations: [
        ...(task.operations ?? []).filter((entry) => entry.id !== operation.id),
        operation,
      ],
    }));
  }

  wrap(tool: HostTool): HostTool {
    if (tool.name === 'report_result') return tool;
    return {
      ...tool,
      run: (args) => {
        const inputHash = hash(args);
        // Serialize effects across the task: different payloads must not race past uncertainty.
        return this.#serial('host-effects', async () => {
          if (this.stopped()) throw new Error('This task was stopped.');
          const contract = tool.verification;
          const scope = contract
            ? await contract.scope(args)
            : {
                account: 'unverified',
                authorization: 'none',
                expiresAt: Number.MAX_SAFE_INTEGER,
              };
          if (scope.expiresAt <= this.now())
            throw new Error(
              'This approval expired. Reconnect the account or approve the action again.',
            );
          const task = await this.get();
          const key = hash({
            tool: tool.name,
            identity: contract?.identity?.(args) ?? args,
            goalRevision: task.goalRevision ?? 0,
          });
          let operation = task.operations?.find((entry) => entry.key === key);
          const limit = task.toolScope?.limits?.[tool.name];
          if (
            !operation &&
            limit !== undefined &&
            (task.operations ?? []).filter(
              (entry) =>
                entry.tool === tool.name && (entry.goalRevision ?? 0) === (task.goalRevision ?? 0),
            ).length >= limit
          )
            throw new Error(
              'This task reached the approved number of actions for this tool. Review its results before adding a new instruction.',
            );
          // Old versions used an input-only key: preserve their evidence on upgrade.
          operation ??= task.operations?.find(
            (entry) => entry.key === hash({ tool: tool.name, args }),
          );
          if (
            task.operations?.some(
              (entry) => entry.tool === tool.name && entry.account !== scope.account,
            )
          )
            throw new Error(
              'The connected account or approval changed. This task cannot reuse progress from a different account or approval.',
            );
          if (
            operation?.inputHash &&
            operation.inputHash !== inputHash &&
            contract?.effect !== 'read'
          )
            throw new Error(
              'The contents for this action changed after it was recorded. Review its existing result, then add a new user instruction to revise it.',
            );
          if (
            !operation &&
            contract?.effect !== 'read' &&
            task.operations?.some(
              (entry) =>
                entry.effect !== 'read' && entry.state !== 'confirmed' && entry.state !== 'not-run',
            )
          )
            throw new Error(unresolved);
          const changedAuthorization = operation && operation.authorization !== scope.authorization;
          if (operation && operation.account !== scope.account)
            throw new Error(
              'The connected account changed. This task cannot replay another account’s actions.',
            );
          if (
            operation &&
            changedAuthorization &&
            (contract?.effect === 'read' || operation.state === 'not-run')
          )
            operation = {
              ...operation,
              authorization: scope.authorization,
              expiresAt: scope.expiresAt,
            };
          // Reconsent never authorizes replay of an old write. It permits read-only
          // reconciliation under the new grant, retaining the original effect ID.
          if (
            operation?.state === 'confirmed' &&
            contract?.effect !== 'read' &&
            !task.restored &&
            !changedAuthorization
          )
            return `Already confirmed: ${operation.receipt?.label ?? tool.name}. Operation ${operation.id}. Do not repeat this action.`;
          if (!operation && task.restored && contract?.effect !== 'read')
            throw new Error(
              'This task came from a historical backup. Conch cannot prove which later writes happened. Inspect its results in the original app before starting a new job.',
            );
          const previous = operation !== undefined;
          operation ??= {
            id: `op_${hash({ task: task.id, key, account: scope.account, authorization: scope.authorization }).slice(0, 40)}`,
            key,
            tool: tool.name,
            inputHash,
            effect: contract?.effect ?? 'unknown',
            ...scope,
            state: 'running',
            startedAt: this.now(),
          };
          const confirm = async () => {
            if (!contract) return 'unknown' as const;
            const pending = operation;
            if (!pending) throw new Error('No durable operation record.');
            const checked = await contract.reconcile(args, pending.id);
            if (checked.state === 'confirmed') {
              const receipt = TaskReceipt.parse(checked.receipt);
              await this.#save({
                ...pending,
                state: 'confirmed',
                confirmedAt: this.now(),
                receipt,
                error: undefined,
              });
            }
            return checked.state;
          };
          if (previous && operation.state !== 'not-run' && contract?.effect !== 'read') {
            let recovered: 'confirmed' | 'absent' | 'unknown';
            try {
              recovered = await confirm();
            } catch {
              recovered = 'unknown';
            }
            if (recovered === 'confirmed')
              return `Recovered the confirmed result of ${tool.name}. Operation ${operation.id}. Nothing repeated.`;
            // An absent result is NOT proof a timed-out non-idempotent write cannot arrive later.
            // Read-only calls can be retried; ambiguous writes require inspection, never guessing.
            throw new Error(unresolved);
          }
          operation = {
            ...operation,
            expiresAt: scope.expiresAt,
            goalRevision: task.goalRevision ?? 0,
          };
          await this.#save({ ...operation, state: 'running', error: undefined });
          if (this.stopped()) {
            await this.#save({
              ...operation,
              state: 'not-run',
              error: 'Stopped before calling the tool; no action was attempted.',
            });
            throw new Error('This task was stopped.');
          }
          try {
            const result = await tool.run(args, { operationId: operation.id });
            if (
              typeof result !== 'string' &&
              result.effect === 'not-executed' &&
              contract?.effect === 'write'
            ) {
              await this.#save({
                ...operation,
                state: 'not-run',
                receipt: undefined,
                error: 'No write was attempted. Resume safely to ask for a fresh approval.',
              });
              return result;
            }
            const checked = await confirm();
            if (checked !== 'confirmed')
              await this.#save({ ...operation, state: 'unresolved', error: unresolved });
            return result;
          } catch (error) {
            // The provider may have accepted a write before the response was lost.
            let recovered = false;
            try {
              recovered = (await confirm()) === 'confirmed';
            } catch {
              /* keep uncertainty */
            }
            if (!recovered)
              await this.#save({ ...operation, state: 'unresolved', error: unresolved });
            throw error;
          }
        });
      },
    };
  }

  /** Native/MCP tools without a receipt contract cannot silently escape the ledger. */
  beforeNative(
    name: string,
    args: Record<string, unknown>,
    invocationId?: string,
    phase = 'guard',
  ): Promise<string | undefined> {
    const key = hash({ tool: name, args });
    return this.#serial('host-effects', async () => {
      if (this.stopped()) return 'This task was stopped.';
      const task = await this.get();
      if (task.restored && !['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name))
        return 'This restored task cannot issue unverified native writes.';
      const identity = `${invocationId ?? 'unknown'}:${key}`;
      const seen = this.#nativeChecks.get(identity);
      if (seen && !seen.has(phase)) {
        seen.add(phase);
        return undefined;
      }
      if (task.operations?.some((entry) => entry.key === key))
        return ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name)
          ? undefined
          : unresolved;
      if (
        !['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name) &&
        task.operations?.some(
          (entry) =>
            entry.effect !== 'read' && entry.state !== 'confirmed' && entry.state !== 'not-run',
        )
      )
        return unresolved;
      this.#nativeChecks.set(identity, new Set([phase]));
      await this.#save({
        id: `op_${hash({ task: task.id, key }).slice(0, 40)}`,
        key,
        tool: name,
        effect: ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name)
          ? 'read'
          : 'unknown',
        account: 'native',
        authorization: 'per-turn',
        expiresAt: this.now(),
        state: 'unresolved',
        goalRevision: task.goalRevision ?? 0,
        startedAt: this.now(),
        error: 'This tool does not provide independently verifiable receipts.',
      });
      return undefined;
    });
  }
}

export function verifiedOutcome(task: Task): boolean {
  const ops = task.operations ?? [];
  const expectations = task.expectations ?? [];
  return (
    expectations.length > 0 &&
    ops.every(
      (op) =>
        op.state === 'confirmed' ||
        ((op.goalRevision ?? 0) !== (task.goalRevision ?? 0) &&
          (op.state === 'not-run' || op.effect === 'read')),
    ) &&
    expectations.every((expected) => {
      const current = ops.filter(
        (op) => op.state === 'confirmed' && (op.goalRevision ?? 0) === (task.goalRevision ?? 0),
      );
      if (current.filter((op) => op.tool === expected.tool).length >= expected.minimum) return true;
      const sources = current.filter(
        (op) => op.tool === expected.unlessEmpty && op.effect === 'read',
      );
      return sources.length > 0 && sources.every((op) => op.receipt?.empty === true);
    })
  );
}
