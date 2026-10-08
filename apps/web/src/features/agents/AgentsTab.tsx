import {
  AGENT_LIMITS,
  fuzzyMatch,
  type Agent,
  type AgentDefaults,
  type EffortChoice,
  type PermissionMode,
  type Tone,
  type UpdateAgentBody,
} from '@conch/protocol';
import {
  AgentAvatar,
  AgentFacePicker,
  AgentGallery,
  Button,
  Callout,
  DropdownMenu,
  Field,
  Input,
  ModePicker,
  ModelPicker,
  Stack,
  Switch,
  Text,
  Textarea,
  ToneChips,
  WelcomeVoice,
  toast,
  useMediaQuery,
} from '@conch/nacre';
import { ChevronDown, MessageSquarePlus, Star, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useAppState, useModels } from '../../api/queries';
import { useUi } from '../../app/ui';
import { PHONE } from '../../app/widths';
import { COME_HOME_FOCUS, importApi, importKeys, useImportRest } from '../import/api';
import { availableModes, effortOptions, pickerProviders } from '../models/catalog';
import { findModel, modelKey, parseModelKey } from '../models/useTurnOptions';
import { SaveStatus, Section } from '../settings/Section';
import { useAutosave } from '../settings/useAutosave';
import {
  useAgents,
  useReorderAgents,
  useSetAgentAvatar,
  useSetDefaultAgent,
  useUpdateAgent,
} from './api';
import { asPreset } from './face';
import { FaceSources } from './FaceSources';
import { LetAgentsInSection, OutsideAgentsSection } from './OtherAgents';
import styles from './Agents.module.css';
import { useRemoveAgent } from './remove';
import { STARTERS, TONE_CHOICES, agentHello, instructionsNote } from './words';

/**
 * Settings → Agents (ADR 0101): everyone you talk to, as a wall of faces.
 * Press one to change it, the + to make another, drag to change the order the
 * pickers show; its ⋯ makes it the default or deletes it, with Undo. An
 * agent's own page is a page inside: Agents › Atlas.
 */
export function AgentsTab({ item }: { item?: string }) {
  const { data: list } = useAgents();
  const openSettings = useUi((s) => s.openSettings);
  const openNewAgent = useUi((s) => s.openNewAgent);
  const reorder = useReorderAgents();
  const setDefault = useSetDefaultAgent();
  const remove = useRemoveAgent();

  const agent = item ? list?.agents.find((a) => a.id === item) : undefined;
  if (item && list && !agent) {
    // Gone (deleted elsewhere, or a link from before): back to everyone.
    return <Gone onBack={() => openSettings('agents')} />;
  }
  if (agent) return <AgentEditor key={agent.id} agent={agent} all={list?.agents ?? []} />;

  const agents = list?.agents ?? [];
  const full = agents.length >= AGENT_LIMITS.count;
  return (
    <Stack gap={6}>
      <Section title="Agents" description="Who you talk to. Each has its own name, face and voice.">
        <AgentGallery
          label="Your agents"
          agents={agents}
          onOpen={(id) => openSettings('agents', id)}
          {...(!full && { onCreate: () => openNewAgent() })}
          onReorder={(ids) =>
            reorder.mutate(ids, {
              onError: (error) => toast.error(error.message || 'The order didn’t change.'),
            })
          }
          onMakeDefault={(id) =>
            setDefault.mutate(id, {
              onSuccess: (next) => {
                const named = next.agents.find((a) => a.id === id)?.name;
                toast.success(`New chats start with ${named ?? 'it'}`);
              },
              onError: (error) => toast.error(error.message || 'That didn’t change.'),
            })
          }
          onDelete={(id) => {
            const gone = agents.find((a) => a.id === id);
            if (gone) remove(gone);
          }}
        />
      </Section>
      {/* Agents talking to each other (ADR 0112): agents elsewhere, and other agents let in. */}
      <OutsideAgentsSection />
      <LetAgentsInSection />
    </Stack>
  );
}

function Gone({ onBack }: { onBack: () => void }) {
  return (
    <Section title="Not here any more" description="That agent was deleted.">
      <div>
        <Button variant="surface" onClick={onBack}>
          See your agents
        </Button>
      </div>
    </Section>
  );
}

/** The parts of an agent's page, each saying "Saved" for itself. */
type Part = 'head' | 'face' | 'personality' | 'instructions' | 'defaults';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Form {
  name: string;
  role: string;
  tone: Tone;
  personality: string;
  instructions: string;
}

const formOf = (agent: Agent): Form => ({
  name: agent.name,
  role: agent.role,
  tone: agent.persona.tone,
  personality: agent.persona.personality,
  instructions: agent.instructions,
});

/**
 * One agent's page: its face and name at the top, then how it sounds (and a
 * hello in that voice), what it always does, and what its chats start with.
 * Every change saves itself a moment later, and says so quietly.
 */
function AgentEditor({ agent, all }: { agent: Agent; all: readonly Agent[] }) {
  const { data: app } = useAppState();
  const navigate = useNavigate();
  const openSettings = useUi((s) => s.openSettings);
  const setDraftAgent = useUi((s) => s.setDraftAgent);
  const update = useUpdateAgent();
  const setAvatar = useSetAgentAvatar();
  const setDefault = useSetDefaultAgent();
  const remove = useRemoveAgent();
  const phone = useMediaQuery(PHONE);
  const [form, setForm] = useState(() => formOf(agent));
  // Where the last change was made: its "Saved" is said there, in sight.
  const [where, setWhere] = useState<Part>('head');
  const set = (patch: Partial<Form>, part: Part) => {
    setWhere(part);
    setForm((f) => ({ ...f, ...patch }));
  };

  const name = form.name.trim();
  const clash = all.some((a) => a.id !== agent.id && a.name.toLowerCase() === name.toLowerCase());
  const valid = Boolean(name) && !clash;
  // A name being retyped (empty, or another agent's) waits; the rest is kept as it was.
  const [kept, setKept] = useState(form);
  if (valid && kept !== form) setKept(form);
  const typed = useAutosave(valid ? form : kept, async (value) => {
    await update.mutateAsync({
      id: agent.id,
      body: {
        name: value.name.trim(),
        role: value.role.trim(),
        persona: { tone: value.tone, personality: value.personality.trim() },
        instructions: value.instructions.trim(),
      },
    });
  });

  // A face or a default is saved at once, and says so where it was chosen.
  const [pressed, setPressed] = useState<SaveState>('idle');
  const patch = (body: UpdateAgentBody, part: Part) => {
    setWhere(part);
    setPressed('saving');
    update.mutate(
      { id: agent.id, body },
      {
        onSuccess: () => setPressed('saved'),
        onError: (error) => {
          setPressed('error');
          toast.error(error.message || 'That didn’t save. Try again.');
        },
      },
    );
  };
  const saved = (part: Part) =>
    where === part ? (
      <SaveStatus status={part === 'face' || part === 'defaults' ? pressed : typed} />
    ) : undefined;

  const shownName = name || agent.name;
  const starter = (id: string) => {
    const chosen = STARTERS.find((s) => s.id === id);
    if (!chosen) return;
    set(
      { instructions: chosen.text, ...(!form.role.trim() && { role: chosen.role }) },
      'instructions',
    );
  };

  return (
    <Stack gap={10}>
      <Section title={shownName} status={saved('head')}>
        <div className={styles.head}>
          <AgentAvatar
            key={JSON.stringify(agent.avatar)}
            name={shownName}
            avatar={agent.avatar}
            size="3xl"
          />
          <div className={styles.headFields}>
            <Field invalid={clash || !name}>
              <Field.Label>Name</Field.Label>
              <Input
                value={form.name}
                maxLength={AGENT_LIMITS.name}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set({ name: e.target.value }, 'head')}
              />
              {clash && <Field.Error>You already have an agent called {name}.</Field.Error>}
              {!name && <Field.Error>It needs a name.</Field.Error>}
            </Field>
            <Field>
              <Field.Label optional>What it’s for</Field.Label>
              <Input
                value={form.role}
                maxLength={AGENT_LIMITS.role}
                placeholder="Plans trips and keeps the bookings"
                onChange={(e) => set({ role: e.target.value }, 'head')}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Face" status={saved('face')}>
        <AgentFacePicker
          name={shownName}
          value={agent.avatar}
          size={phone ? 'lg' : 'xl'}
          onValueChange={(face) => patch({ avatar: asPreset(face) }, 'face')}
          actions={
            <FaceSources
              name={shownName}
              tone={form.tone}
              onPicture={async (picture) => {
                setWhere('face');
                setPressed('saving');
                await setAvatar.mutateAsync({ id: agent.id, picture }).catch((error: unknown) => {
                  setPressed('error');
                  throw error;
                });
                setPressed('saved');
              }}
            />
          }
        />
      </Section>

      <Section title="Personality" status={saved('personality')}>
        <Stack gap={5}>
          <ToneChips
            aria-label="How it sounds"
            choices={TONE_CHOICES}
            value={form.tone}
            onValueChange={(tone) => set({ tone: tone as Tone }, 'personality')}
          />
          <WelcomeVoice
            from={shownName}
            face={<AgentAvatar name={shownName} avatar={agent.avatar} size="xs" decorative />}
            text={agentHello(form.tone, shownName, app?.profile.name)}
          />
          <Field>
            <Field.Label optional>In your own words</Field.Label>
            <Textarea
              autosize
              minRows={2}
              maxRows={8}
              maxLength={AGENT_LIMITS.personality}
              value={form.personality}
              placeholder="Dry humour, never gushes. Loves a good metaphor."
              onChange={(e) => set({ personality: e.target.value }, 'personality')}
            />
          </Field>
        </Stack>
      </Section>

      <Section
        title="Instructions"
        description={`What ${shownName} always does, in every chat.`}
        status={saved('instructions')}
      >
        <Stack gap={3}>
          <div className={styles.starters}>
            {form.instructions.trim() ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button size="sm" variant="ghost" trailingIcon={<ChevronDown />}>
                    Start again from…
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  {STARTERS.map((s) => (
                    <DropdownMenu.Item key={s.id} onSelect={() => starter(s.id)}>
                      {s.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            ) : (
              <>
                <Text as="span" size="sm" tone="muted">
                  Start from
                </Text>
                {STARTERS.map((s) => (
                  <Button key={s.id} size="sm" variant="surface" onClick={() => starter(s.id)}>
                    {s.label}
                  </Button>
                ))}
              </>
            )}
          </div>
          <Field>
            <Field.Label className="nc-visually-hidden">Instructions</Field.Label>
            <Textarea
              autosize
              minRows={4}
              maxRows={18}
              maxLength={AGENT_LIMITS.instructions}
              value={form.instructions}
              placeholder="Always use British spelling. Suggest a test when I share code."
              onChange={(e) => set({ instructions: e.target.value }, 'instructions')}
            />
            <InstructionsNote agent={agent} text={form.instructions} />
          </Field>
          <RestOfInstructions
            agent={agent}
            onBrought={(whole) => set({ instructions: whole }, 'instructions')}
          />
        </Stack>
      </Section>

      <StartsWith
        agent={agent}
        name={shownName}
        status={saved('defaults')}
        onChange={(defaults) => patch({ defaults }, 'defaults')}
      />

      <div className={styles.foot}>
        <Button
          variant="surface"
          leadingIcon={<MessageSquarePlus />}
          onClick={() => {
            setDraftAgent(agent.id);
            void navigate('/');
          }}
        >
          Chat with {shownName}
        </Button>
        {!agent.isDefault && (
          <Button
            variant="ghost"
            leadingIcon={<Star />}
            onClick={() =>
              setDefault.mutate(agent.id, {
                onSuccess: () => toast.success(`New chats start with ${shownName}`),
                onError: (error) => toast.error(error.message || 'That didn’t change.'),
              })
            }
          >
            Make default
          </Button>
        )}
        {all.length > 1 && (
          <Button
            variant="ghost"
            tone="danger"
            leadingIcon={<Trash2 />}
            onClick={() => {
              openSettings('agents');
              remove(agent);
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </Stack>
  );
}

/** The model an agent's chats start with: its own, else everyone's. */
function useStartingModel(agent: Agent) {
  const { data: app } = useAppState();
  const { data: catalog } = useModels(Boolean(app));
  const own = agent.defaults;
  const prefs = app?.preferences;
  const engine = own?.engine ?? catalog?.default ?? prefs?.engine;
  const provider = catalog?.providers.find((p) => p.engine === engine) ?? catalog?.providers[0];
  return findModel(provider, own?.model ?? prefs?.model);
}

/**
 * A quiet word when its instructions are long enough to weigh on every reply,
 * about the model its chats start with when that's the one that would feel
 * it (ADR 0101). Only a note: they're kept whole, and saving never waits on it.
 */
function InstructionsNote({ agent, text }: { agent: Agent; text: string }) {
  const model = useStartingModel(agent);
  const note = instructionsNote(
    text,
    model && { label: model.label, ...(model.context && { context: model.context }) },
  );
  if (!note) return null;
  return <Field.Description>{note}</Field.Description>;
}

/**
 * An agent an older Conch brought with the end of its instructions cut off,
 * when the app it came from still has the rest: one press brings it in. Words
 * that read like orders are read in Come home first.
 */
function RestOfInstructions({
  agent,
  onBrought,
}: {
  agent: Agent;
  /** Its whole instructions now, for the page's own copy. */
  onBrought: (instructions: string) => void;
}) {
  const { data } = useImportRest(Boolean(agent.imported));
  const openSettings = useUi((s) => s.openSettings);
  const queryClient = useQueryClient();
  const [bringing, setBringing] = useState(false);
  const rest = data?.agents.find((a) => a.agentId === agent.id);
  if (!rest) return null;
  const bring = () => {
    setBringing(true);
    importApi
      .bringRest(agent.id)
      .then((next) => {
        onBrought(next.instructions);
        toast.success(`The rest of ${agent.name}’s instructions came in`);
        return queryClient.invalidateQueries({ queryKey: importKeys.rest });
      })
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error && error.message ? error.message : 'That didn’t come in.',
        ),
      )
      .finally(() => setBringing(false));
  };
  return (
    <Callout
      tone="info"
      title={`The end of its instructions stayed in ${rest.label}`}
      action={
        rest.review ? (
          <Button
            size="sm"
            variant="surface"
            onClick={() => openSettings('memory', COME_HOME_FOCUS)}
          >
            Take a look
          </Button>
        ) : (
          <Button size="sm" variant="surface" loading={bringing} onClick={bring}>
            Bring the rest in
          </Button>
        )
      }
    >
      {rest.review
        ? `Some of it reads like orders to the assistant, so read it in Come home before bringing it.`
        : `An earlier Conch kept only the start. ${rest.label} still has the rest, about ${rest.chars.toLocaleString()} characters.`}
    </Callout>
  );
}

/**
 * What its new chats start with: everyone's defaults unless it has its own —
 * a model (with how hard it thinks) and a mode. Never Full trust: that's for
 * a person to choose, for a chat (ADR 0100).
 */
function StartsWith({
  agent,
  name,
  status,
  onChange,
}: {
  agent: Agent;
  name: string;
  status?: ReactNode;
  onChange: (defaults: AgentDefaults | null) => void;
}) {
  const { data: app } = useAppState();
  const { data: catalog } = useModels(Boolean(app));
  const [picking, setPicking] = useState(false);
  const own = agent.defaults;
  const prefs = app?.preferences;
  const engine = own?.engine ?? catalog?.default ?? prefs?.engine;
  const provider = catalog?.providers.find((p) => p.engine === engine) ?? catalog?.providers[0];
  const model = findModel(provider, own?.model ?? prefs?.model);
  const mode = own?.permissionMode ?? prefs?.permissionMode ?? 'default';
  const modes = useMemo(
    () =>
      availableModes(provider?.permissionModes)
        .filter((m) => m.value !== 'bypassPermissions')
        .map((m) => ({
          value: m.value,
          label: m.label,
          description: m.description,
          icon: m.icon,
          tone: m.tone,
        })),
    [provider],
  );
  const everyone = (): AgentDefaults => ({
    ...(provider && { engine: provider.engine }),
    ...(provider && model && { model: model.id }),
    ...(prefs?.effort && prefs.effort !== 'auto' && { effort: prefs.effort }),
    ...(mode !== 'bypassPermissions' && { permissionMode: mode }),
  });

  return (
    <Section
      title="Its chats start with"
      description={own ? undefined : 'The model and mode every new chat starts with.'}
      status={status}
    >
      <Stack gap={4}>
        <Switch
          checked={Boolean(own)}
          disabled={!provider}
          onCheckedChange={(on) => onChange(on ? everyone() : null)}
          label={`A model and mode of ${name}’s own`}
        />
        {own && provider && (
          <div className={styles.defaults}>
            <ModelPicker
              side="bottom"
              providers={pickerProviders(catalog?.providers ?? [], catalog?.default, modelKey)}
              model={model ? modelKey(provider.engine, model.id) : ''}
              onModelChange={(key) => {
                const choice = parseModelKey(key);
                if (choice) onChange({ ...own, engine: choice.engine, model: choice.model });
                setPicking(false);
              }}
              match={fuzzyMatch}
              open={picking}
              onOpenChange={setPicking}
              effort={own.effort ?? 'auto'}
              efforts={effortOptions(model)}
              onEffortChange={(effort) => onChange({ ...own, effort: effort as EffortChoice })}
              fastMode={false}
              fastModeAvailable={false}
              onFastModeChange={() => {}}
              isDefault
            />
            <ModePicker
              side="bottom"
              options={modes}
              value={mode}
              onValueChange={(next) =>
                onChange({
                  ...own,
                  permissionMode: next as Exclude<PermissionMode, 'bypassPermissions'>,
                })
              }
              isDefault
              name={name}
            />
          </div>
        )}
      </Stack>
    </Section>
  );
}
