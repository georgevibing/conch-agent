import { chatAgentId, type Agent, type ConversationSummary } from '@conch/protocol';
import { AgentAvatar, AgentPicker, DropdownMenu, toast } from '@conch/nacre';
import { Plus, UsersRound } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useAppState, useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useAgents, useSetChatAgent } from './api';

const pickable = (agents: readonly Agent[]) =>
  agents.map((a) => ({
    id: a.id,
    name: a.name,
    ...(a.role && { role: a.role }),
    avatar: a.avatar,
  }));

/**
 * Who a new chat is with, where it starts: the agent's face large with its
 * name, a press to choose another (or make one). Choosing one brings its own
 * model and mode, when it has them, into the message box.
 */
export function NewChatAgent() {
  const { data: list } = useAgents();
  const { data: app } = useAppState();
  const draftAgent = useUi((s) => s.draftAgent);
  const setDraftAgent = useUi((s) => s.setDraftAgent);
  const openNewAgent = useUi((s) => s.openNewAgent);
  const openSettings = useUi((s) => s.openSettings);
  const current =
    list?.agents.find((a) => a.id === draftAgent) ??
    list?.agents.find((a) => a.id === list.defaultId);

  // An agent with a model of its own starts the chat with it: shown in the box before it's sent.
  const applied = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!current || applied.current === current.id) return;
    const before = list?.agents.find((a) => a.id === applied.current);
    applied.current = current.id;
    const { draftOptions, setDraftOptions } = useUi.getState();
    if (current.defaults) setDraftOptions({ ...draftOptions, ...current.defaults });
    else if (before?.defaults) setDraftOptions({});
  }, [current, list]);

  if (!list || !current)
    return <AgentAvatar name={app?.persona.name ?? 'Conch'} size="xl" decorative />;
  return (
    <AgentPicker
      variant="hello"
      agents={pickable(list.agents)}
      value={current.id}
      label={(name) => `Talking to ${name}. Choose another agent`}
      onValueChange={(id) => {
        const agent = list.agents.find((a) => a.id === id);
        if (agent) setDraftAgent(agent.isDefault ? null : agent.id);
      }}
      actions={[
        { label: 'New agent', icon: <Plus />, onSelect: () => openNewAgent({ chat: true }) },
        { label: 'Agents', icon: <UsersRound />, onSelect: () => openSettings('agents') },
      ]}
    />
  );
}

/** Another agent answers this chat from the next message on; the chat shows where. */
export function useSwitchChatAgent(conversationId: string) {
  const change = useSetChatAgent();
  return (agent: Pick<Agent, 'id' | 'name'>) =>
    change.mutate(
      { conversationId, agentId: agent.id },
      {
        onSuccess: () => toast.success(`${agent.name} answers from your next message`),
        onError: (error) =>
          toast.error(error.message || 'That didn’t change who answers. Try again.'),
      },
    );
}

function useChat(conversationId: string): ConversationSummary | undefined {
  return useConversations().data?.find((c) => c.id === conversationId);
}

/** Who answers this chat, in the header: its face and name, a press to hand it to another. */
export function ChatAgentSwitch({ conversationId }: { conversationId: string }) {
  const { data: list } = useAgents();
  const chat = useChat(conversationId);
  const switchTo = useSwitchChatAgent(conversationId);
  // Another app's chat (ADR 0073) is that app's log; a task's is its own.
  if (!list || list.agents.length < 2 || !chat || chat.origin?.kind === 'client') return null;
  const answering = chatAgentId(chat, list);
  return (
    <AgentPicker
      variant="chip"
      heading="Answer with"
      agents={pickable(list.agents)}
      value={answering}
      label={(name) => `${name} answers this chat. Choose another agent`}
      onValueChange={(id) => {
        const agent = list.agents.find((a) => a.id === id);
        if (agent && id !== answering) switchTo(agent);
      }}
    />
  );
}

/** The same, inside a phone's ⋯ menu: who answers, and the others to hand it to. */
export function ChatAgentMenu({ conversationId }: { conversationId: string }) {
  const { data: list } = useAgents();
  const chat = useChat(conversationId);
  const switchTo = useSwitchChatAgent(conversationId);
  if (!list || list.agents.length < 2 || !chat || chat.origin?.kind === 'client') return null;
  const answering = chatAgentId(chat, list);
  const now = list.agents.find((a) => a.id === answering);
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        icon={<AgentAvatar name={now?.name ?? ''} avatar={now?.avatar} size="xs" decorative />}
      >
        Answering: {now?.name}
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>
        <DropdownMenu.RadioGroup
          value={answering}
          onValueChange={(id) => {
            const agent = list.agents.find((a) => a.id === id);
            if (agent && id !== answering) switchTo(agent);
          }}
        >
          {list.agents.map((agent) => (
            <DropdownMenu.RadioItem
              key={agent.id}
              value={agent.id}
              trailing={
                <AgentAvatar name={agent.name} avatar={agent.avatar} size="xs" decorative />
              }
            >
              {agent.name}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  );
}

/**
 * A chat's agent on its row in the chat list, small, and only where it says
 * something: a chat with anyone but the default agent. The default's chats
 * stay as they were, so one agent (most people) changes nothing.
 */
export function ChatRowAgent({ chat }: { chat: Pick<ConversationSummary, 'agentId'> }) {
  const { data: list } = useAgents();
  if (!list || list.agents.length < 2) return null;
  const id = chatAgentId(chat, list);
  if (id === list.defaultId) return null;
  const agent = list.agents.find((a) => a.id === id);
  if (!agent) return null;
  return <AgentAvatar name={agent.name} avatar={agent.avatar} size="xs" />;
}
