import type { EffortChoice, PermissionMode } from '@conch/protocol';
import {
  AlertDialog,
  Field,
  RadioGroup,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
} from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useCapabilities, useUpdateSettings } from '../../api/queries';
import { availableModes, effortOptions, isSecondaryModel } from '../models/catalog';
import { findModel } from '../models/useTurnOptions';
import { Section } from './Section';
import styles from './Settings.module.css';

/** Defaults for every new chat. Each chat can still change them from the composer. */
export function ModelsTab() {
  const { data: app } = useAppState();
  const ready = app?.engine.state === 'ready';
  const { data: caps, isLoading } = useCapabilities(ready);
  const update = useUpdateSettings();
  const [confirmTrust, setConfirmTrust] = useState(false);

  const prefs = app?.preferences;
  const modelId = prefs?.model ?? 'default';
  const model = findModel(caps, modelId);
  const efforts = effortOptions(model);
  const save = (preferences: Parameters<typeof update.mutate>[0]['preferences']) =>
    update.mutate({ preferences });

  if (!ready) {
    return (
      <Section title="Models & modes" description="Connect Claude Code to choose models.">
        <Text tone="muted">Once Claude Code is connected, its models appear here.</Text>
      </Section>
    );
  }

  const primary = caps?.models.filter((m) => !isSecondaryModel(m)) ?? [];
  const secondary = caps?.models.filter(isSecondaryModel) ?? [];

  return (
    <Stack gap={8}>
      <Section
        title="Models & modes"
        description="What every new chat starts with. You can change them for a single chat from the message box, or type /model."
      >
        {isLoading || !caps ? (
          <Stack gap={3}>
            <Skeleton shape="block" height="2.25rem" />
            <Skeleton shape="block" height="2.25rem" />
          </Stack>
        ) : (
          <Stack gap={6}>
            <Field>
              <Field.Label>Default model</Field.Label>
              <Select
                value={modelId}
                onValueChange={(id) => save({ model: id })}
                aria-label="Default model"
              >
                <Select.Group label="Claude Code">
                  {primary.map((m) => (
                    <Select.Item key={m.id} value={m.id} description={m.description}>
                      {m.label}
                    </Select.Item>
                  ))}
                </Select.Group>
                {secondary.length > 0 && (
                  <Select.Group label="More models">
                    {secondary.map((m) => (
                      <Select.Item key={m.id} value={m.id} description={m.description}>
                        {m.label}
                      </Select.Item>
                    ))}
                  </Select.Group>
                )}
              </Select>
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
              description="A small, fast model (Haiku where your account has it) titles each new chat from its first message — usually a fraction of a cent."
            />
          </Stack>
        )}
      </Section>

      <Section
        title="How much Claude can do on its own"
        description="Claude always shows what it’s doing. This decides when it stops to ask you first."
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

      <AlertDialog.Root open={confirmTrust} onOpenChange={setConfirmTrust}>
        <AlertDialog.Content tone="danger">
          <AlertDialog.Title>Start every chat in Full trust?</AlertDialog.Title>
          <AlertDialog.Description>
            Claude will edit files and run commands on this computer without asking first. Only
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
