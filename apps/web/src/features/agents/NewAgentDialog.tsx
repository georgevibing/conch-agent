import { AGENT_LIMITS, type AgentId, type Tone } from '@conch/protocol';
import {
  AgentAvatar,
  AgentCard,
  AgentFacePicker,
  Button,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  Stack,
  Text,
  ToneChips,
  WelcomeVoice,
  toast,
  useMediaQuery,
  type AgentFace,
  type AgentPresetFace,
} from '@conch/nacre';
import { ArrowRight, Dices, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { useUi } from '../../app/ui';
import { PHONE } from '../../app/widths';
import { agentKeys, agentsApi, useAgents, useCreateAgent } from './api';
import { asPreset } from './face';
import { FaceSources } from './FaceSources';
import styles from './Agents.module.css';
import { TONE_CHOICES, agentHello, nextIdea } from './words';
import { useQueryClient } from '@tanstack/react-query';

/** What's said, a moment after typing stops, so the hello isn't retyped at every key. */
function useSettled<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Making an agent (ADR 0101), from anywhere: one screen with what it needs —
 * a name (one to start from, and the dice for another), a face and how it
 * sounds — and everything else for later. The card at the top is the agent:
 * its name writes itself in as you type, its face lands as you choose, and it
 * says hello in its voice. Made, it says so, and offers a chat with it.
 */
export function NewAgentDialog() {
  const request = useUi((s) => s.newAgent);
  const close = useUi((s) => s.closeNewAgent);
  return (
    <Dialog.Root open={Boolean(request)} onOpenChange={(open) => !open && close()}>
      {request && <Maker key="maker" fromChat={Boolean(request.chat)} onDone={close} />}
    </Dialog.Root>
  );
}

function Maker({ fromChat, onDone }: { fromChat: boolean; onDone: () => void }) {
  const { data: list } = useAgents();
  const { data: app } = useAppState();
  const navigate = useNavigate();
  const phone = useMediaQuery(PHONE);
  const client = useQueryClient();
  const openSettings = useUi((s) => s.openSettings);
  const setDraftAgent = useUi((s) => s.setDraftAgent);
  const create = useCreateAgent();
  const taken = useMemo(() => list?.agents.map((a) => a.name) ?? [], [list]);
  const [idea, setIdea] = useState(() => nextIdea(taken));
  const [name, setName] = useState(idea.name);
  const [face, setFace] = useState<AgentPresetFace>({ kind: 'preset', id: idea.face });
  const [picture, setPicture] = useState<{ blob: Blob; url: string }>();
  const [tone, setTone] = useState<Tone>('warm');
  const [made, setMade] = useState<AgentId>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => () => picture && URL.revokeObjectURL(picture.url), [picture]);

  const shown: AgentFace = picture ? { kind: 'image', url: picture.url } : face;
  const trimmed = name.trim();
  const clash = taken.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const hello = useSettled(agentHello(tone, trimmed, app?.profile.name));
  const full = (list?.agents.length ?? 0) >= AGENT_LIMITS.count;

  const shuffle = () => {
    const next = nextIdea(taken, idea.name);
    setIdea(next);
    setName(next.name);
    if (!picture)
      setFace({ kind: 'preset', id: next.face, ...(face.color && { color: face.color }) });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || clash || create.isPending) return;
    setProblem(undefined);
    try {
      const agent = await create.mutateAsync({
        name: trimmed,
        avatar: asPreset(face),
        persona: { tone, personality: '' },
      });
      if (picture)
        await agentsApi.setAvatar(agent.id, picture.blob).then(
          () => client.invalidateQueries({ queryKey: agentKeys.list }),
          () => toast.error('The picture couldn’t be kept. Choose it again in its settings.'),
        );
      if (fromChat) {
        setDraftAgent(agent.id);
        onDone();
        toast.success(`${agent.name} answers this chat`);
        return;
      }
      setMade(agent.id);
    } catch (error) {
      setProblem((error as Error).message || 'That didn’t work. Try again.');
    }
  };

  if (made) {
    const agent = list?.agents.find((a) => a.id === made);
    const madeName = agent?.name ?? trimmed;
    return (
      <Dialog.Content size="sm" className={styles.maker}>
        <Dialog.Body className={styles.makerBody}>
          <AgentCard name={madeName} avatar={agent?.avatar ?? shown} size="3xl" arrived />
          <Dialog.Title asChild>
            <Heading level={2} display size="3xl" align="center">
              {madeName} is ready
            </Heading>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text tone="muted" align="center">
              Say hello, or give it instructions first.
            </Text>
          </Dialog.Description>
        </Dialog.Body>
        <Dialog.Footer className={styles.makerFooter}>
          <Button
            variant="ghost"
            leadingIcon={<SlidersHorizontal />}
            onClick={() => {
              onDone();
              openSettings('agents', made);
            }}
          >
            Add instructions
          </Button>
          <Button
            trailingIcon={<ArrowRight />}
            onClick={() => {
              setDraftAgent(made);
              onDone();
              void navigate('/');
            }}
          >
            Chat with {madeName}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    );
  }

  return (
    <Dialog.Content size="xl" className={styles.maker}>
      <form onSubmit={(e) => void submit(e)} className={styles.makerForm}>
        <Dialog.Header className="nc-visually-hidden">
          <Dialog.Title>New agent</Dialog.Title>
          <Dialog.Description>
            A name, a face and how it sounds. The rest can wait.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body className={styles.makerTwo}>
          {/* The agent as it's made: its face, its name as it's typed, its hello. */}
          <div className={styles.makerPreview}>
            <AgentCard
              name={name}
              avatar={shown}
              size={phone ? '2xl' : '3xl'}
              placeholder="Your agent"
            />
            <WelcomeVoice
              from={trimmed || 'Your agent'}
              face={
                <AgentAvatar name={trimmed || 'Your agent'} avatar={shown} size="xs" decorative />
              }
              text={hello}
              className={styles.makerHello}
            />
          </div>
          <Stack gap={5} className={styles.makerFields}>
            <Field invalid={clash}>
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                maxLength={AGENT_LIMITS.name}
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                onChange={(e) => setName(e.target.value)}
                trailing={
                  <IconButton size="sm" variant="ghost" label="Another name" onClick={shuffle}>
                    <Dices />
                  </IconButton>
                }
              />
              {clash && <Field.Error>You already have an agent called {trimmed}.</Field.Error>}
            </Field>
            <Stack gap={2}>
              <Text as="span" size="sm" weight="medium">
                Face
              </Text>
              <AgentFacePicker
                name={trimmed || 'Your agent'}
                value={shown}
                size="lg"
                onValueChange={(next) => {
                  setPicture(undefined);
                  setFace(next);
                }}
                actions={
                  <FaceSources
                    name={trimmed}
                    tone={tone}
                    onPicture={(blob) => setPicture({ blob, url: URL.createObjectURL(blob) })}
                  />
                }
              />
            </Stack>
            <Stack gap={2}>
              <Text as="span" size="sm" weight="medium" id="new-agent-tone">
                How it sounds
              </Text>
              <ToneChips
                aria-labelledby="new-agent-tone"
                choices={TONE_CHOICES}
                value={tone}
                onValueChange={(next) => setTone(next as Tone)}
              />
            </Stack>
            {problem && (
              <Text role="alert" size="sm" tone="danger">
                {problem}
              </Text>
            )}
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button type="submit" loading={create.isPending} disabled={!trimmed || clash || full}>
            Create {trimmed || 'agent'}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  );
}
