import type { EffortChoice, PermissionMode } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Field,
  IntegrationLogo,
  ModelPicker,
  RadioGroup,
  SegmentedControl,
  Skeleton,
  Stack,
  Switch,
  Text,
} from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useModels, useUpdateSettings } from '../../api/queries';
import { useIntegrations } from '../integrations/queries';
import { availableModes, effortOptions, pickerProviders } from '../models/catalog';
import { findModel, modelKey, parseModelKey } from '../models/useTurnOptions';
import { fuzzyMatch } from '../search/fuzzy';
import { FallbackSection } from './FallbackSection';
import { Section } from './Section';
import styles from './Settings.module.css';

/** Defaults for every new chat. Each chat can still change them from the composer. */
export function ModelsTab() {
  const { data: app } = useAppState();
  const { data: catalog, isLoading } = useModels(Boolean(app));
  const update = useUpdateSettings();
  const [confirmTrust, setConfirmTrust] = useState(false);
  const [picking, setPicking] = useState(false);

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
      <Section title="Models & modes" description="Connect a provider to choose models.">
        <Text tone="muted">
          Once a provider is connected (Settings → Providers), its models appear here.
        </Text>
      </Section>
    );
  }

  return (
    <Stack gap={8}>
      <Section
        title="Models & modes"
        description="What every new chat starts with. Any chat can switch to another model — from any connected provider — from the message box, or with /model."
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
                Every connected provider’s models, searchable. Choosing one from another provider
                makes that provider the default too.
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
                  More thinking gives better answers to hard problems, but takes longer.
                </Text>
              </Stack>
            )}

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
              description="A small, fast model from the chat’s own provider titles each new chat from its first message — usually a fraction of a cent."
            />
          </Stack>
        )}
      </Section>

      <FallbackSection />

      <Section
        title={`How much ${assistant} can do on its own`}
        description={`${assistant} always shows what it’s doing. This decides when it stops to ask you first.`}
      >
        <RadioGroup
          variant="card"
          aria-label="Default mode"
          value={prefs?.permissionMode ?? 'default'}
          onValueChange={(v) => {
            if (v === 'bypassPermissions') setConfirmTrust(true);
            else save({ permissionMode: v as PermissionMode });
          }}
          className={styles.modes}
        >
          {availableModes(caps?.permissionModes).map((m) => (
            <RadioGroup.Item
              key={m.value}
              value={m.value}
              label={m.label}
              description={m.description}
            />
          ))}
        </RadioGroup>
      </Section>

      <MutedSuggestions
        assistant={assistant}
        muted={prefs?.mutedSuggestions ?? []}
        onChange={(mutedSuggestions) => save({ mutedSuggestions })}
      />

      <AlertDialog.Root open={confirmTrust} onOpenChange={setConfirmTrust}>
        <AlertDialog.Content tone="danger">
          <AlertDialog.Title>Start every chat in Full trust?</AlertDialog.Title>
          <AlertDialog.Description>
            {assistant} will edit files and run commands on this computer without asking first. Only
            choose this if you’re comfortable with that for every new chat.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep asking</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                save({ permissionMode: 'bypassPermissions' });
                setConfirmTrust(false);
              }}
            >
              Turn on Full trust
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
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
 * Apps you asked the chat never to offer (“Don’t suggest Linear”), each with
 * a way to change your mind.
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
  return (
    <Section
      title="Offers to connect apps"
      description={`When you ask about an app that isn’t connected, ${assistant} offers to connect it right in the chat.`}
    >
      {muted.length ? (
        <ul className={styles.commandList} aria-label="Apps not suggested">
          {muted.map((id) => {
            const entry = data?.catalog.find((c) => c.id === id);
            const name = entry?.name ?? titleCase(id);
            return (
              <li key={id} className={styles.commandRow}>
                <Stack direction="row" gap={3} align="center" className={styles.commandText}>
                  <IntegrationLogo
                    brand={id}
                    name={name}
                    color={entry?.color}
                    size="sm"
                    decorative
                  />
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
          On for every app. Choose “Don’t suggest” on one in a chat, and it shows up here.
        </Text>
      )}
    </Section>
  );
}
