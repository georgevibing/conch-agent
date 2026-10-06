import { fuzzyMatch, type EffortChoice, type PermissionMode } from '@conch/protocol';
import {
  Button,
  Field,
  IntegrationLogo,
  ModeChoice,
  ModelPicker,
  SegmentedControl,
  SettingsAdvanced,
  Skeleton,
  SkillIcon,
  Stack,
  Switch,
  Text,
} from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useModels, useUpdateSettings } from '../../api/queries';
import { useIntegrations } from '../integrations/queries';
import { useProviders } from '../providers/queries';
import { useSkills } from '../skills/queries';
import { availableModes, effortOptions, pickerProviders } from '../models/catalog';
import { findModel, modelKey, parseModelKey } from '../models/useTurnOptions';
import { FallbackSection, FALLBACK_FOCUS } from './FallbackSection';
import { Section } from './Section';
import styles from './Settings.module.css';
import { useAdvanced } from './useAdvanced';

/** Defaults for every new chat. Each chat can still change them from the composer. */
export function ModelsTab() {
  const { data: app } = useAppState();
  const { data: catalog, isLoading } = useModels(Boolean(app));
  const update = useUpdateSettings();
  const [picking, setPicking] = useState(false);
  const [advanced, setAdvanced] = useAdvanced(FALLBACK_FOCUS);

  const prefs = app?.preferences;
  const assistant = app?.persona.name ?? 'Conch';
  // The default provider's offer; the default model is one of its models.
  const caps =
    catalog?.providers.find((p) => p.engine === catalog.default) ?? catalog?.providers[0];
  const ready = Boolean(caps);
  const model = findModel(caps, prefs?.model ?? 'default');
  const efforts = effortOptions(model);
  const save = (preferences: Parameters<typeof update.mutate>[0]['preferences']) =>
    update.mutate({ preferences });

  if (!ready && !isLoading) {
    return (
      <Section title="Models" description="Connect a provider to choose models.">
        <Text tone="muted">Its models appear here as soon as one is connected.</Text>
      </Section>
    );
  }

  return (
    <Stack gap={8}>
      <Section
        title="Models"
        description="What every new chat starts with. Any chat can change its own, from the message box or with /model."
      >
        {isLoading || !caps ? (
          <Stack gap={3}>
            <Skeleton shape="block" height="2.25rem" />
            <Skeleton shape="block" height="2.25rem" />
          </Stack>
        ) : (
          <Stack gap={6}>
            <Field>
              <Field.Label id="default-model">Default model</Field.Label>
              <div>
                <ModelPicker
                  modelOnly
                  side="bottom"
                  providers={pickerProviders(catalog?.providers ?? [], catalog?.default, modelKey)}
                  model={caps && model ? modelKey(caps.engine, model.id) : ''}
                  onModelChange={(key) => {
                    const choice = parseModelKey(key);
                    if (choice) save({ engine: choice.engine, model: choice.model });
                    setPicking(false);
                  }}
                  match={fuzzyMatch}
                  open={picking}
                  onOpenChange={setPicking}
                  effort="auto"
                  efforts={[]}
                  onEffortChange={() => {}}
                  fastMode={false}
                  fastModeAvailable={false}
                  onFastModeChange={() => {}}
                  isDefault
                />
              </div>
              <Field.Description>
                Every connected provider’s models. Choosing one makes its provider your default.
              </Field.Description>
            </Field>

            {efforts.length > 0 && (
              <Stack gap={2}>
                <Text as="span" size="sm" weight="medium" id="default-effort">
                  Thinking
                </Text>
                <SegmentedControl
                  aria-labelledby="default-effort"
                  value={prefs?.effort ?? 'auto'}
                  onValueChange={(v) => v && save({ effort: v as EffortChoice })}
                  block
                >
                  {efforts.map((e) => (
                    <SegmentedControl.Item key={e.value} value={e.value}>
                      {e.label}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl>
                <Text size="xs" tone="subtle">
                  More thinking answers harder questions, and takes longer.
                </Text>
              </Stack>
            )}
          </Stack>
        )}
      </Section>

      <Section
        title={`How much ${assistant} can do on its own`}
        description="Where every new chat starts. Each chat can change its own from the message box."
      >
        {/* The chat's picker and this list share one definition: the same icons, names and lines. */}
        <ModeChoice
          aria-label="Default mode"
          options={availableModes(caps?.permissionModes).map((m) => ({
            value: m.value,
            label: m.label,
            description: m.description,
            icon: m.icon,
            tone: m.tone,
          }))}
          value={prefs?.permissionMode ?? 'default'}
          onValueChange={(v) => save({ permissionMode: v as PermissionMode })}
          name={assistant}
        />
      </Section>

      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <Section title="Every new chat">
          <Stack gap={5}>
            <Switch
              checked={Boolean(prefs?.fastMode) && Boolean(model?.supportsFastMode)}
              disabled={!model?.supportsFastMode}
              onCheckedChange={(fastMode) => save({ fastMode })}
              label="Fast mode"
              description={
                model?.supportsFastMode
                  ? 'Faster replies. Uses more of your plan.'
                  : 'Not available for this model or account.'
              }
            />
            <Switch
              checked={prefs?.autoTitle ?? true}
              onCheckedChange={(autoTitle) => save({ autoTitle })}
              label="Name new chats automatically"
              description="From its first message, for a fraction of a cent."
            />
          </Stack>
        </Section>

        <FallbackSection />

        <MutedSuggestions
          assistant={assistant}
          muted={prefs?.mutedSuggestions ?? []}
          onChange={(mutedSuggestions) => save({ mutedSuggestions })}
        />
      </SettingsAdvanced>
    </Stack>
  );
}

/** “google-calendar” → “Google Calendar”, for an app the catalog here doesn't list. */
const titleCase = (id: string) =>
  id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Apps and skills you asked the chat never to offer (“Don’t suggest Linear”),
 * each with a way to change your mind. Skills are kept as `skill:<id>`.
 */
function MutedSuggestions({
  assistant,
  muted,
  onChange,
}: {
  assistant: string;
  muted: readonly string[];
  onChange: (muted: string[]) => void;
}) {
  const { data } = useIntegrations();
  const { data: skills } = useSkills();
  const { data: providers } = useProviders();
  return (
    <Section
      title="Offers in the chat"
      description={`${assistant} offers an app or skill that would help, right in the chat.`}
    >
      {muted.length ? (
        <ul className={styles.commandList} aria-label="Not suggested">
          {muted.map((id) => {
            const providerId = id.startsWith('provider:')
              ? id.slice('provider:'.length)
              : undefined;
            const provider = providers?.providers.find((p) => p.id === providerId);
            const skillId = id.startsWith('skill:') ? id.slice('skill:'.length) : undefined;
            const skill = skillId ? skills?.skills.find((s) => s.id === skillId) : undefined;
            const entry = skillId ? undefined : data?.catalog.find((c) => c.id === id);
            const name = providerId
              ? (provider?.name ?? titleCase(providerId))
              : skillId
                ? (skill?.title ?? titleCase(skillId))
                : (entry?.name ?? titleCase(id));
            return (
              <li key={id} className={styles.commandRow}>
                <Stack direction="row" gap={3} align="center" className={styles.commandText}>
                  {skillId ? (
                    <SkillIcon name={skill?.name ?? skillId} title={name} size="md" />
                  ) : (
                    <IntegrationLogo
                      brand={providerId ?? id}
                      name={name}
                      color={entry?.color}
                      size="sm"
                      decorative
                    />
                  )}
                  <Stack gap={0.5}>
                    <Text size="sm" weight="medium">
                      {name}
                    </Text>
                    <Text size="xs" tone="subtle">
                      Not suggested
                    </Text>
                  </Stack>
                </Stack>
                <Button
                  size="sm"
                  variant="surface"
                  aria-label={`Suggest ${name} again`}
                  onClick={() => onChange(muted.filter((other) => other !== id))}
                >
                  Suggest again
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Text size="sm" tone="muted">
          On for everything. Say “Don’t suggest” to one in a chat, and it’s listed here.
        </Text>
      )}
    </Section>
  );
}
