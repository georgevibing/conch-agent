import { expect, it } from 'vitest';
import { assessTask, Task } from '@conch/protocol';
import { TaskOperations } from '../tasks/operations';
import { currentTimeTool } from './time-tool';

it('receipts the actual clock sample, including two reads as separate observations', async () => {
  let task = Task.parse({
    id: 'clock',
    kind: 'helper',
    title: 'Clock',
    prompt: 'Read time',
    status: 'running',
    createdAt: 1,
    expectations: [{ tool: 'current_time', minimum: 2 }],
  });
  let now = Date.parse('2026-10-07T16:00:00.999Z');
  const ledger = new TaskOperations(
    async () => task,
    async (change) => (task = { ...task, ...change(task) }),
    () => false,
  );
  const tool = ledger.wrap(currentTimeTool(() => now));
  expect(JSON.parse(String(await tool.run({})))).toEqual({
    current_time: '2026-10-07 16:00:00 UTC',
    current_time_at: 1791388800,
  });
  expect(assessTask(task).verdict).toBe('incomplete');
  now += 1000;
  expect(JSON.parse(String(await tool.run({}))).current_time).toBe('2026-10-07 16:00:01 UTC');
  expect(task.operations).toHaveLength(2);
  expect(assessTask(task).verdict).toBe('verified');
  expect(
    task.operations?.every((op) => op.effect === 'read' && op.state === 'confirmed' && op.receipt),
  ).toBe(true);
  expect(task.operations?.[0]?.receipt?.id).not.toBe(task.operations?.[1]?.receipt?.id);
});
