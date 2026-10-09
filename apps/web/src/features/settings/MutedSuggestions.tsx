import { Button, IntegrationLogo, SkillIcon, Stack, Text } from '@conch/nacre';

import { useIntegrations } from '../integrations/queries';
import { useProviders } from '../providers/queries';
import { useSkills } from '../skills/queries';
import styles from './Settings.module.css';

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
export function MutedSuggestions({
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
    <Stack gap={2}>
      <Stack gap={0.5}>
        <Text as="span" size="sm" weight="medium">
          Offers in the chat
        </Text>
        <Text size="xs" tone="subtle">
          {assistant} offers an app or skill that would help, right in the chat.
        </Text>
      </Stack>
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
        <Text size="xs" tone="muted">
          On for everything. Say “Don’t suggest” to one in a chat, and it’s listed here.
        </Text>
      )}
    </Stack>
  );
}
