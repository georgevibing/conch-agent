/**
 * Settings → Agents, below your own (ADR 0112): agents elsewhere you can
 * bring into a chat (one paste of their address), and other agents you let
 * talk to yours (off until you let one in; a pairing like Other apps',
 * owner-only and confirmed it's you, with a key shown once).
 */
import type { McpClient, McpScope, OutsidePreview } from '@conch/protocol';
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  Field,
  Input,
  OutsideAgentList,
  OutsideAgentPreview,
  PairedAppList,
  SecretReveal,
  Stack,
  Switch,
  Text,
  toast,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useVerify } from '../auth/useVerify';
import { otherAppsApi, otherAppsKeys, useOtherApps } from '../otherapps/api';
import { pairedWords } from '../otherapps/words';
import { Section } from '../settings/Section';
import { useAgents } from './api';
import { outsideApi, useAddOutsideAgent, useOutsideAgents, useRemoveOutsideAgent } from './outside';

const fail = (error: unknown) => toast.error((error as Error).message || 'That didn’t work.');

/** The agents a paired client may talk to, by id. */
const agentsOf = (client: McpClient) =>
  client.scopes.flatMap((s) => (s.startsWith('agent:') ? [s.slice('agent:'.length)] : []));

// ── Outside agents ───────────────────────────────────────────────────────

/** Agents elsewhere, added by pasting their address: the list, and the paste box. */
export function OutsideAgentsSection() {
  const { data } = useOutsideAgents();
  const add = useAddOutsideAgent();
  const remove = useRemoveOutsideAgent();
  const [paste, setPaste] = useState('');
  const [found, setFound] = useState<{ paste: string; preview: OutsidePreview }>();
  const [problem, setProblem] = useState<string>();
  const [looking, setLooking] = useState(false);
  const asked = useRef(0);

  /** Read the card of what was pasted, now: the last paste wins. */
  const look = async (text: string) => {
    const trimmed = text.trim();
    setFound(undefined);
    setProblem(undefined);
    if (!trimmed) return;
    const mine = ++asked.current;
    setLooking(true);
    try {
      const preview = await outsideApi.look(trimmed);
      if (mine === asked.current) setFound({ paste: trimmed, preview });
    } catch (error) {
      if (mine === asked.current) setProblem((error as Error).message);
    } finally {
      if (mine === asked.current) setLooking(false);
    }
  };

  const agents = data?.agents ?? [];
  return (
    <Section
      title="Outside agents"
      description="Agents elsewhere that speak A2A. Add one by pasting its address, then bring it into a chat with @ and its name."
    >
      <Stack gap={4}>
        <OutsideAgentList
          agents={agents.map((a) => ({
            id: a.id,
            name: a.name,
            ...(a.description && { description: a.description }),
            host: new URL(a.endpoint).host,
            ...(a.private && { private: true }),
            ...(a.problem && { problem: a.problem }),
          }))}
          {...(remove.isPending && remove.variables && { busy: remove.variables })}
          onRemove={(agent) =>
            remove.mutate(agent.id, {
              onSuccess: () => toast.success(`${agent.name} removed`),
              onError: fail,
            })
          }
        />
        <Field>
          <Field.Label>Add an outside agent</Field.Label>
          <Input
            value={paste}
            placeholder="Paste its address, and its key if it gave you one"
            onChange={(e) => setPaste(e.target.value)}
            // A paste is read at once: nothing to press.
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (!text) return;
              e.preventDefault();
              setPaste(text.replace(/\s+/g, ' ').trim());
              void look(text);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void look(paste);
              }
            }}
          />
          <Field.Description>
            {looking
              ? 'Reading its card…'
              : 'Another Conch gives you both in one copy: Settings → Agents → Let another agent in.'}
          </Field.Description>
        </Field>
        {problem && (
          <Callout tone="warning" live="polite">
            {problem}
          </Callout>
        )}
        {found && (
          <OutsideAgentPreview
            name={found.preview.name}
            description={found.preview.description}
            skills={found.preview.skills}
            {...(found.preview.by && { by: found.preview.by })}
            host={found.preview.host}
            private={found.preview.private}
            keyed={found.preview.keyed}
            known={Boolean(found.preview.known)}
            adding={add.isPending}
            {...(found.preview.needsKey
              ? { note: 'It wants a key. Paste its address and its key together.' }
              : {
                  onAdd: () =>
                    add.mutate(found.paste, {
                      onSuccess: (agent) => {
                        toast.success(`${agent.name} added. Mention @${agent.name} in a chat.`);
                        setFound(undefined);
                        setPaste('');
                      },
                      onError: fail,
                    }),
                })}
          />
        )}
      </Stack>
    </Section>
  );
}

// ── Letting other agents in ──────────────────────────────────────────────

/** Other agents you let talk to yours: who, which of yours, and a way to let one in. */
export function LetAgentsInSection() {
  const overview = useOtherApps();
  const { data: list } = useAgents();
  const access = useQuery({ queryKey: keys.access, queryFn: api.access, staleTime: 10_000 });
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  const client = useQueryClient();
  const navigate = useNavigate();
  const closeSettings = useUi((s) => s.closeSettings);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const peers = (overview.data?.clients ?? []).filter((c) => agentsOf(c).length > 0);
  const nameOf = (id: string) =>
    list?.agents.find((a) => a.id === id)?.name ?? 'an agent that’s gone';
  const refresh = () => void client.invalidateQueries({ queryKey: otherAppsKeys.overview });

  return (
    <Section
      title="Agents that can talk to yours"
      description="Off until you let one in. They get your agent’s voice, in words only: no tools, nothing you told it, nothing it knows about you."
    >
      <Stack gap={3}>
        {peers.length > 0 && (
          <PairedAppList
            apps={peers.map((c) => ({
              id: c.id,
              name: c.name,
              uses: `Talks to ${agentsOf(c).map(nameOf).join(', ')}`,
              meta: pairedWords(c),
              remote: Boolean(overview.data?.remote && c.remote),
            }))}
            busy={removing}
            onOpen={(app) => {
              const chat = peers.find((p) => p.id === app.id)?.conversationId;
              if (!chat) return toast('It hasn’t said anything yet.');
              closeSettings();
              void navigate(`/c/${chat}`);
            }}
            onRemove={(app) => {
              setRemoving(app.id);
              void otherAppsApi
                .remove(app.id)
                .then(() => {
                  refresh();
                  toast.success(`${app.name} can’t talk to your agents any more`);
                }, fail)
                .finally(() => setRemoving(undefined));
            }}
          />
        )}
        <div>
          <Button variant="surface" leadingIcon={<DoorOpen />} onClick={() => setOpen(true)}>
            Let another agent in
          </Button>
        </div>
      </Stack>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content size="md" aria-describedby={undefined}>
          {open && (
            <LetInFlow
              address={overview.data?.address}
              endpoint={overview.data?.endpoint}
              remoteOn={Boolean(overview.data?.remote)}
              guard={guard}
              onDone={refresh}
              onClose={() => setOpen(false)}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
      {dialog}
    </Section>
  );
}

function LetInFlow({
  address,
  endpoint,
  remoteOn,
  guard,
  onDone,
  onClose,
}: {
  address?: string;
  endpoint?: string;
  remoteOn: boolean;
  guard: ReturnType<typeof useVerify>['guard'];
  onDone: () => void;
  onClose: () => void;
}) {
  const { data: list } = useAgents();
  const agents = list?.agents ?? [];
  const [chosen, setChosen] = useState<string[]>(() => (list ? [list.defaultId] : []));
  const [name, setName] = useState('');
  const [elsewhere, setElsewhere] = useState(Boolean(address));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ copy: string; name: string }>();
  const formId = useId();

  // Where the other agent will find yours: your own address, or this computer.
  const base = (elsewhere && address ? address : endpoint ? new URL(endpoint).origin : '').replace(
    /\/+$/,
    '',
  );
  const first = chosen[0];

  const submit = async () => {
    setBusy(true);
    try {
      await guard(async () => {
        if (elsewhere && !remoteOn) await otherAppsApi.remote(true);
        const paired = await otherAppsApi.pair({
          app: 'other',
          name: name.trim() || 'Another agent',
          scopes: chosen.map((id) => `agent:${id}` as McpScope),
          http: true,
          remote: elsewhere,
        });
        onDone();
        const key = paired.setup?.key ?? '';
        setDone({
          name: paired.client.name,
          copy: `Address: ${base}/a2a/${first ?? ''}\nKey: ${key}`,
        });
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>
          {done ? `${done.name} can talk to yours` : 'Let another agent in'}
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {done ? (
          <Stack gap={3}>
            <Text>
              Give this to the other agent. Another Conch takes it in one paste, in Settings →
              Agents → Outside agents. It’s shown once.
            </Text>
            <SecretReveal secret={done.copy} title="Its address and key" />
          </Stack>
        ) : (
          <Stack gap={5}>
            <Text tone="muted">
              It can ask the agents you tick and get their answers, in words only. It can’t use
              tools, your apps or anything Conch knows about you, and its messages can’t give your
              agent permission for anything.
            </Text>
            <Field>
              <Field.Label>Whose agent is it?</Field.Label>
              <Input
                value={name}
                maxLength={60}
                placeholder="Ana’s assistant"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div role="group" aria-labelledby={`${formId}-who`}>
              <Stack gap={2}>
                <Text id={`${formId}-who`} size="sm" weight="medium">
                  It may talk to
                </Text>
                {agents.map((agent) => (
                  <Checkbox
                    key={agent.id}
                    checked={chosen.includes(agent.id)}
                    onCheckedChange={(on) =>
                      setChosen((now) =>
                        on === true
                          ? [...now.filter((id) => id !== agent.id), agent.id]
                          : now.filter((id) => id !== agent.id),
                      )
                    }
                    label={agent.name}
                    {...(agent.role && { description: agent.role })}
                  />
                ))}
              </Stack>
            </div>
            {address ? (
              <Switch
                checked={elsewhere}
                onCheckedChange={setElsewhere}
                label="It’s on another computer"
                description={`It reaches yours at ${address}, over HTTPS, with its key.${remoteOn ? '' : ' This turns on “From your own address” for other apps too.'}`}
              />
            ) : (
              <Text size="sm" tone="subtle">
                Only agents on this computer can reach yours until Conch has an address of its own
                (Settings → Your address).
              </Text>
            )}
          </Stack>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        {done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!chosen.length} onClick={() => void submit()}>
              Let it in
            </Button>
          </>
        )}
      </Dialog.Footer>
    </>
  );
}
