/** Write-ahead, fail-closed effect ledger. Model text is never evidence. */
import { createHash } from 'node:crypto';

import { assessTask, TaskReceipt, type Task, type TaskOperation } from '@conch/protocol';

import type { HostTool } from '../engines/types';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
/** Bound a structured action independently of object key order and omitted optional fields. */
export const taskArgumentText = (args: Record<string, unknown>) => canonical(args);
export const taskArgumentHash = (args: Record<string, unknown>) => hash(args);

const unresolved =
  'This action may already have happened. Conch cannot prove its result, so it will not repeat it. Inspect the original app before continuing.';

export class TaskOperations {
  readonly #locks = new Map<string, Promise<unknown>>();
  #prior?: Set<string>;
  readonly #observedInvocations = new Map<string, string>();
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
    await this.update((task) => {
      // Stop wins even if it arrives while reconciliation or persistence is awaiting I/O.
      if (
        this.stopped() &&
        (operation.state === 'confirmed' || operation.execution === 'succeeded')
      )
        return {};
      // Completion can arrive out of order. Preserve invocation order so an older
      // read cannot become the latest evidence just by finishing last.
      const operations = [...(task.operations ?? [])];
      const at = operations.findIndex((entry) => entry.id === operation.id);
      if (at < 0) operations.push(operation);
      else operations[at] = operation;
      return { operations };
    });
  }

  wrap(original: HostTool): HostTool {
    // A trusted host read needs an observation, not an external-effect reconciler.
    const observations = new Map<string, string>();
    const tool: HostTool =
      original.effect === 'read' && !original.verification
        ? {
            ...original,
            run: async (args, context) => {
              const result = await original.run(args, context);
              if (context && (typeof result === 'string' || !result.isError))
                observations.set(
                  context.operationId,
                  hash(typeof result === 'string' ? result : result.text),
                );
              return result;
            },
            verification: {
              effect: 'read',
              scope: async () => ({
                account: 'conch-host',
                authorization: 'read',
                expiresAt: Number.MAX_SAFE_INTEGER,
              }),
              reconcile: async (_args, id) => {
                const digest = observations.get(id);
                observations.delete(id);
                return digest
                  ? {
                      state: 'confirmed',
                      receipt: {
                        provider: 'conch-host',
                        id: digest,
                        label: `Read with ${original.name}`,
                      },
                    }
                  : { state: 'absent' };
              },
            },
          }
        : original;
    if (tool.name === 'report_result') return tool;
    return {
      ...tool,
      run: (args) => {
        const inputHash = hash(args);
        // Serialize effects across the task: different payloads must not race past uncertainty.
        return this.#serial('host-effects', async () => {
          if (this.stopped()) throw new Error('This task was stopped.');
          const contract = tool.verification;
          let recorded = false;
          try {
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
            this.#prior ??= new Set(task.operations?.map((op) => op.id));
            const authorizedArguments = task.toolScope?.argumentHashes?.[tool.name];
            if (authorizedArguments && authorizedArguments !== taskArgumentHash(args))
              throw new Error(
                'This task can save only the exact draft originally requested. Start a new draft from the original chat to change it.',
              );
            const key = hash({
              tool: tool.name,
              identity: contract?.identity?.(args) ?? args,
              goalRevision: task.goalRevision ?? 0,
            });
            const history = (task.operations ?? []).filter((entry) => entry.key === key);
            // Reads are observations, not deduplicated effects. Preserve nonempty and failed attempts.
            let operation = contract?.effect === 'read' ? undefined : history.at(-1);
            // A new turn may reissue its original steps. A later edit must not make
            // an earlier confirmed write look new and overwrite the saved progress.
            const prior =
              contract?.sequential && !task.restored
                ? history.findLast(
                    (op) =>
                      this.#prior?.has(op.id) &&
                      op.inputHash === inputHash &&
                      op.state === 'confirmed',
                  )
                : undefined;
            if (prior) operation = prior;
            if (
              operation?.state === 'confirmed' &&
              contract?.sequential &&
              !task.restored &&
              !prior
            ) {
              const current =
                operation.inputHash === inputHash
                  ? await contract.reconcile(args, operation.id, operation.checkpoint)
                  : undefined;
              if (current?.state !== 'confirmed') operation = undefined;
            }
            const limit = task.toolScope?.limits?.[tool.name];
            if (
              !operation &&
              limit !== undefined &&
              (task.operations ?? []).filter(
                (entry) =>
                  entry.tool === tool.name &&
                  (entry.goalRevision ?? 0) === (task.goalRevision ?? 0),
              ).length >= limit
            )
              throw new Error(
                'This task reached the approved number of actions for this tool. Review its results before adding a new instruction.',
              );
            // Old versions used an input-only key: preserve their evidence on upgrade.
            if (contract?.effect !== 'read')
              operation ??= task.operations?.find(
                (entry) => entry.key === hash({ tool: tool.name, args }),
              );
            if (
              task.operations?.some(
                (entry) =>
                  entry.tool === tool.name &&
                  entry.account !== scope.account &&
                  !(entry.effect === 'read' && entry.state === 'not-run'),
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
                  entry.effect !== 'read' &&
                  entry.state !== 'confirmed' &&
                  entry.state !== 'not-run' &&
                  (entry.execution !== 'succeeded' || entry.receiptExpected === true),
              )
            )
              throw new Error(unresolved);
            const changedAuthorization =
              operation && operation.authorization !== scope.authorization;
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
              id: `op_${hash({ task: task.id, key, account: scope.account, authorization: scope.authorization, ...(contract?.effect === 'read' || contract?.sequential ? { attempt: history.length } : {}) }).slice(0, 40)}`,
              key,
              tool: tool.name,
              inputHash,
              effect: contract?.effect ?? tool.effect ?? 'unknown',
              receiptExpected: contract !== undefined,
              ...scope,
              state: 'running',
              startedAt: this.now(),
            };
            const confirm = async () => {
              if (!contract || this.stopped()) return 'unknown' as const;
              const pending = operation;
              if (!pending) throw new Error('No durable operation record.');
              const checked = await contract.reconcile(args, pending.id, pending.checkpoint);
              if (this.stopped()) return 'unknown' as const;
              if (checked.state === 'confirmed') {
                const receipt = TaskReceipt.parse(checked.receipt);
                await this.#save({
                  ...pending,
                  state: 'confirmed',
                  execution: 'succeeded',
                  confirmedAt: this.now(),
                  receipt,
                  error: undefined,
                });
              }
              return this.stopped() ? ('unknown' as const) : checked.state;
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
              ...((!previous || operation.state === 'not-run') && contract?.prepare
                ? { checkpoint: await contract.prepare(args) }
                : {}),
              expiresAt: scope.expiresAt,
              goalRevision: task.goalRevision ?? 0,
            };
            recorded = true;
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
              const result = await tool.run(args, {
                operationId: operation.id,
                checkpoint: operation.checkpoint,
              });
              if (this.stopped()) throw new Error('This task was stopped.');
              if (
                typeof result !== 'string' &&
                result.effect === 'not-executed' &&
                contract?.effect !== 'read'
              ) {
                await this.#save({
                  ...operation,
                  state: 'not-run',
                  receipt: undefined,
                  error: 'No write was attempted. Resume safely to ask for a fresh approval.',
                });
                return result;
              }
              if (typeof result !== 'string' && result.isError) {
                // Structured errors are failures too. Reads have no uncertain side effects.
                await this.#save({
                  ...operation,
                  state: 'unresolved',
                  execution: 'failed',
                  receipt: undefined,
                  error:
                    contract?.effect === 'read'
                      ? 'This read failed; it provides no evidence for this attempt.'
                      : unresolved,
                });
                return result;
              }
              const checked = await confirm();
              if (checked !== 'confirmed')
                await this.#save({
                  ...operation,
                  state: 'unresolved',
                  execution: 'succeeded',
                  error: 'The tool returned, but no independent receipt is available.',
                });
              return result;
            } catch (error) {
              // The provider may have accepted a write before the response was lost.
              let recovered = false;
              try {
                recovered = contract?.effect !== 'read' && (await confirm()) === 'confirmed';
              } catch {
                /* keep uncertainty */
              }
              if (!recovered)
                await this.#save({
                  ...operation,
                  state: 'unresolved',
                  execution: 'failed',
                  receipt: undefined,
                  error:
                    contract?.effect === 'read'
                      ? 'This read failed; it provides no evidence for this attempt.'
                      : unresolved,
                });
              throw error;
            }
          } catch (error) {
            // Scope/path/approval checks may fail before dispatch. A rejected read is
            // still the newest attempt: it must invalidate an older successful read.
            // Never store unchecked arguments, paths, or provider error text here.
            if (!recorded && contract?.effect === 'read' && !this.stopped()) {
              const task = await this.get();
              const key = hash({
                tool: tool.name,
                identity: contract.identity?.(args) ?? args,
                goalRevision: task.goalRevision ?? 0,
              });
              await this.#save({
                id: `op_${hash({ task: task.id, key, rejected: task.operations?.length ?? 0 }).slice(0, 40)}`,
                key,
                tool: tool.name,
                inputHash,
                effect: 'read',
                receiptExpected: true,
                account: 'unavailable',
                authorization: 'none',
                expiresAt: 0,
                state: 'not-run',
                execution: 'failed',
                goalRevision: task.goalRevision ?? 0,
                startedAt: this.now(),
                error:
                  'This read failed before dispatch; it provides no evidence for this attempt.',
              });
            }
            throw error;
          }
        });
      },
    };
  }

  /** Record reported invocations even when a provider skips its approval hook.
   * This observes an event; it never authorizes a call or trusts MCP read-only hints.
   */
  observeNative(name: string, args: Record<string, unknown>, invocationId: string): Promise<void> {
    return this.#serial('host-effects', async () => {
      if (this.stopped()) return;
      const key = hash({ tool: name, args });
      const identity = `${invocationId}:${key}`;
      if (this.#nativeChecks.has(identity) || this.#observedInvocations.has(identity)) return;
      const task = await this.get();
      const id = `op_${hash({ task: task.id, key, observed: task.operations?.length ?? 0 }).slice(0, 40)}`;
      this.#observedInvocations.set(identity, id);
      await this.#save({
        id,
        key,
        invocationId,
        inputHash: hash(args),
        tool: name,
        effect: ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name)
          ? 'read'
          : 'unknown',
        account: 'native',
        authorization: 'observed-only',
        expiresAt: this.now(),
        state: 'unresolved',
        goalRevision: task.goalRevision ?? 0,
        startedAt: this.now(),
        error: 'This provider tool was observed without an independent receipt.',
      });
    });
  }

  /** Native/MCP tools without a receipt contract cannot silently escape the ledger. */
  beforeNative(
    name: string,
    args: Record<string, unknown>,
    invocationId?: string,
    phase = 'guard',
  ): Promise<string | undefined> {
    const read = ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name);
    const key = hash({ tool: name, args });
    return this.#serial('host-effects', async () => {
      if (this.stopped()) return 'This task was stopped.';
      const task = await this.get();
      if (task.restored && !['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name))
        return 'This restored task cannot issue unverified native writes.';
      const identity = `${invocationId ?? 'unknown'}:${key}`;
      const seen = invocationId ? this.#nativeChecks.get(identity) : undefined;
      const observed = invocationId ? this.#observedInvocations.get(identity) : undefined;
      if (seen && !seen.has(phase)) {
        seen.add(phase);
        return undefined;
      }
      if (!read && task.operations?.some((entry) => entry.key === key && entry.id !== observed))
        return ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name)
          ? undefined
          : unresolved;
      if (
        !['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(name) &&
        task.operations?.some(
          (entry) =>
            entry.id !== observed &&
            entry.effect !== 'read' &&
            entry.state !== 'confirmed' &&
            entry.state !== 'not-run' &&
            (entry.execution !== 'succeeded' || entry.receiptExpected === true),
        )
      )
        return unresolved;
      if (invocationId) this.#nativeChecks.set(identity, new Set([phase]));
      if (observed) return undefined;
      await this.#save({
        id: `op_${hash({ task: task.id, key, ...(read ? { attempt: task.operations?.length ?? 0 } : {}) }).slice(0, 40)}`,
        key,
        invocationId,
        inputHash: hash(args),
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
  /** Native read evidence comes from the engine's actual result event, never summary prose. */
  async afterNative(
    invocationId: string,
    status: 'success' | 'error',
    output?: string,
  ): Promise<void> {
    await this.#serial('host-effects', async () => {
      if (this.stopped()) return;
      const task = await this.get();
      const op = task.operations?.findLast(
        (entry) => entry.account === 'native' && entry.invocationId === invocationId,
      );
      if (!op) return;
      if (op.effect !== 'read') {
        await this.#save({ ...op, execution: status === 'success' ? 'succeeded' : 'failed' });
        return;
      }
      await this.#save(
        status === 'success'
          ? {
              ...op,
              state: 'confirmed',
              execution: 'succeeded',
              confirmedAt: this.now(),
              error: undefined,
              receipt: {
                provider: 'native-read',
                id: hash(output ?? ''),
                label: `Read with ${op.tool}`,
              },
            }
          : {
              ...op,
              state: 'unresolved',
              execution: 'failed',
              receipt: undefined,
              error: 'The native read failed.',
            },
      );
    });
  }
}

export function verifiedOutcome(task: Task): boolean {
  return assessTask(task).verdict === 'verified';
}
