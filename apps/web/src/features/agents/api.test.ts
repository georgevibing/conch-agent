import { FIRST_AGENT_ID, type Agent, type AgentList } from '@conch/protocol';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { keys } from '../../api/queries';
import { agentKeys, agentsApi, applyAgentsEvent } from './api';

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: FIRST_AGENT_ID,
  name: 'Conch',
  role: '',
  avatar: { kind: 'preset', id: 'shell' },
  persona: { tone: 'warm', personality: '' },
  instructions: '',
  isDefault: true,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

function answer(body: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('the agents client', () => {
  it('reads the list and checks it against the protocol', async () => {
    const list: AgentList = { agents: [agent()], defaultId: FIRST_AGENT_ID };
    const fetch = answer(list);
    expect(await agentsApi.list()).toEqual(list);
    expect(fetch).toHaveBeenCalledWith('/api/agents', expect.objectContaining({ method: 'GET' }));
    answer({ agents: [], defaultId: 'nope' });
    await expect(agentsApi.list()).rejects.toThrow();
  });

  it('sends a picture as base64, and a chat’s new agent as a change to the chat', async () => {
    const fetch = answer(agent());
    await agentsApi.setAvatar(FIRST_AGENT_ID, new Blob([new Uint8Array([1, 2, 3])]));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/agents/${FIRST_AGENT_ID}/avatar`);
    expect(JSON.parse(String(init.body))).toEqual({ data: 'AQID' });

    const chat = answer({ ok: true });
    await agentsApi.setChatAgent('c_123', 'ag_sage01');
    const [chatUrl, chatInit] = chat.mock.calls[0] as unknown as [string, RequestInit];
    expect(chatUrl).toBe('/api/conversations/c_123');
    expect(chatInit.method).toBe('PATCH');
    expect(JSON.parse(String(chatInit.body))).toEqual({ agentId: 'ag_sage01' });
  });

  it('says what went wrong in the gateway’s words', async () => {
    answer({ error: 'name-taken', message: 'There’s already an agent called “Sage”.' }, 409);
    await expect(agentsApi.create({ name: 'Sage' })).rejects.toMatchObject({
      status: 409,
      code: 'name-taken',
    });
  });
});

describe('agents.changed', () => {
  it('puts the new list everywhere, and refreshes the app’s state, which names the default', () => {
    const client = new QueryClient();
    client.setQueryData(keys.state, { persona: { name: 'Conch' } });
    const list: AgentList = {
      agents: [agent({ isDefault: false }), agent({ id: 'ag_sage01', name: 'Sage', order: 1 })],
      defaultId: 'ag_sage01',
    };
    applyAgentsEvent(client, { type: 'agents.changed', list });
    expect(client.getQueryData(agentKeys.list)).toEqual(list);
    expect(client.getQueryState(keys.state)?.isInvalidated).toBe(true);
  });
});
