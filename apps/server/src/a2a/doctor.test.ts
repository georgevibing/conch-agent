import type { OutsideAgent } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { outsideCheck } from './doctor';
import type { OutsideAgents } from './outside';

const agent = (patch: Partial<OutsideAgent>): OutsideAgent => ({
  id: 'oa_travel1',
  name: 'Travel',
  description: '',
  card: 'https://203.0.113.5/.well-known/agent-card.json',
  endpoint: 'https://203.0.113.5/a2a',
  protocol: '1.0',
  skills: [],
  keyed: false,
  private: false,
  addedAt: 1,
  ...patch,
});

const run = (outside: Partial<OutsideAgents>, repair: boolean) =>
  outsideCheck(outside as OutsideAgents).run({ repair, signal: new AbortController().signal });

describe('Repair everything: outside agents', () => {
  it('says nothing with none, and ok when they answer', async () => {
    expect(await run({ list: async () => [] }, false)).toEqual([]);
    expect((await run({ list: async () => [agent({})] }, false))[0]).toMatchObject({ state: 'ok' });
  });

  it('looks without changing, then reads the card again and says it’s fixed', async () => {
    const troubled = agent({ problem: 'Couldn’t reach Travel.' });
    const refresh = vi.fn(async () => true);
    expect((await run({ list: async () => [troubled], refresh }, false))[0]).toMatchObject({
      state: 'warning',
      repairable: true,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect((await run({ list: async () => [troubled], refresh }, true))[0]).toMatchObject({
      state: 'fixed',
    });
  });

  it('points at Agents when it still can’t be reached, and never removes one', async () => {
    const remove = vi.fn();
    const item = (
      await run(
        {
          list: async () => [agent({ problem: 'down' })],
          refresh: async () => false,
          remove,
        },
        true,
      )
    )[0];
    expect(item).toMatchObject({
      state: 'warning',
      action: { kind: 'open', place: 'agents' },
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
