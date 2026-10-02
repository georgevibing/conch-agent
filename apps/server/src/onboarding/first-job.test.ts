import { FirstJobRequest, Task, type Capabilities } from '@conch/protocol';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { MockEngine } from '../engines/mock/engine';
import type { TaskService } from '../tasks/service';
import { FIRST_JOBS, FirstJobService, registerFirstJobRoutes } from './first-job';

const input = () =>
  FirstJobRequest.parse({
    requestId: 'request_abcdefghijkl',
    kind: 'document',
    engine: 'mock',
    model: 'default',
    source: 'Launch is Friday. Maya owns the checklist.',
  });
function fixture() {
  const engine = new MockEngine({ speed: 0 });
  const capabilities: Capabilities = {
    engine: 'mock',
    label: 'Test model',
    models: [
      {
        id: 'default',
        label: 'Default',
        description: '',
        efforts: [],
        supportsFastMode: false,
        supportsAutoMode: false,
        tools: true,
      },
    ],
    commands: [],
    permissionModes: ['default'],
    tools: { host: true, files: true, shell: false, approvals: true },
  };
  vi.spyOn(engine, 'capabilities').mockResolvedValue(capabilities);
  const saved: Task[] = [];
  const create = vi.fn<Pick<TaskService, 'create'>['create']>(async (body) => {
    const existing = saved.find((task) => task.requestKey === body.requestKey);
    if (existing) return existing;
    const task = Task.parse({
      ...body,
      id: `task_${saved.length}`,
      prompt: body.text,
      status: 'queued',
      createdAt: Date.now(),
    });
    saved.unshift(task);
    return task;
  });
  const accounts = [
    {
      id: 'google_personal',
      state: 'ready',
      capabilities: ['mail-read', 'calendar-read', 'mail-draft'],
    },
  ];
  const deps = {
    tasks: { create, list: async () => ({ tasks: saved, concurrent: 1 }) },
    providers: { load: async () => 'mock' as const, engineFor: () => engine },
    google: { status: async () => ({ accounts }) },
  };
  return { deps, jobs: new FirstJobService(deps), saved, create, capabilities, engine, accounts };
}

describe('first useful job', () => {
  it('requires a saved document with a server-defined scope, never shell or outbound email', async () => {
    const f = fixture();
    const task = await f.jobs.start(input());
    expect(task.expectations).toEqual([{ tool: 'artifact_create', minimum: 1 }]);
    expect(task.toolScope?.names).toEqual(['artifact_create']);
    expect(task.options.permissionMode).toBe('default');
    expect(task.options.model).toBe('default');
    expect(task.toolScope?.limits).toEqual({ artifact_create: 1 });
    expect(task.prompt).toContain('Maya owns the checklist');
    expect(task.workflow).toBe('document');
    expect(await f.jobs.latest()).toEqual({ task });
  });

  it('recovers a lost response without creating a second job, including concurrent calls', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.jobs.start(input()), f.jobs.start(input())]);
    expect(a.id).toBe(b.id);
    expect(f.saved).toHaveLength(1);
    await expect(f.jobs.start({ ...input(), requestId: 'different_request_id' })).rejects.toThrow(
      'already running',
    );
  });

  it('does not start or switch provider when the model cannot use tools', async () => {
    const f = fixture();
    const model = f.capabilities.models[0];
    if (!model) throw new Error('Fixture model missing');
    model.tools = false;
    await expect(f.jobs.start(input())).rejects.toThrow('cannot complete');
    expect(f.create).not.toHaveBeenCalled();
    await expect(f.jobs.start({ ...input(), engine: 'openrouter' })).rejects.toThrow(
      'not available',
    );
  });

  it('requires usable source material and the exact selected connected account/scopes', async () => {
    const f = fixture();
    await expect(f.jobs.start({ ...input(), source: ' ' })).rejects.toThrow('Add the notes');
    await expect(f.jobs.start({ ...input(), kind: 'today' })).rejects.toThrow(
      'Choose the Google account',
    );
    await expect(f.jobs.start({ ...input(), kind: 'today', accountId: 'work' })).rejects.toThrow(
      'Reconnect',
    );
    const account = f.accounts[0];
    if (!account) throw new Error('Fixture account missing');
    account.capabilities = ['mail-read'];
    await expect(
      f.jobs.start({ ...input(), kind: 'today', accountId: 'google_personal' }),
    ).rejects.toThrow('Reconnect');
    expect(f.create).not.toHaveBeenCalled();
  });

  it('binds follow-ups to one account and permits drafts but never send tools', async () => {
    const f = fixture();
    const task = await f.jobs.start({
      ...input(),
      kind: 'followups',
      accountId: 'google_personal',
    });
    expect(task.toolScope?.accountId).toBe('google_personal');
    expect(task.toolScope?.names).toContain('google_mail_create_draft');
    expect(task.toolScope?.limits?.google_mail_create_draft).toBe(3);
    expect(task.toolScope?.names.some((name) => /send|shell|browser|delegate/.test(name))).toBe(
      false,
    );
    expect(task.expectations).toContainEqual({ tool: 'google_mail_search', minimum: 1 });
    expect(FIRST_JOBS.today.capabilities).toEqual(['mail-read', 'calendar-read']);
  });

  it('validates before execution and refuses caller-supplied powers at the HTTP boundary', async () => {
    const f = fixture();
    const app = Fastify();
    registerFirstJobRoutes(app, f.deps);
    try {
      const extra = await app.inject({
        method: 'POST',
        url: '/api/first-job',
        payload: { ...input(), toolScope: { names: ['Bash'] } },
      });
      expect(extra.statusCode).toBe(400);
      const badZone = await app.inject({
        method: 'POST',
        url: '/api/first-job',
        payload: { ...input(), timezone: 'Not/AZone' },
      });
      expect(badZone.statusCode).toBe(400);
      expect(f.create).not.toHaveBeenCalled();
      const valid = await app.inject({ method: 'POST', url: '/api/first-job', payload: input() });
      expect(valid.statusCode).toBe(200);
      expect(valid.json().workflow).toBe('document');
    } finally {
      await app.close();
    }
  });
});
