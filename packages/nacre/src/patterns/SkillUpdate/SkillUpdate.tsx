import { Button } from '../../components/Button';
import { Card } from '../../components/Surface';
import { Collapsible } from '../../components/Collapsible';
import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import styles from './SkillUpdate.module.css';

export interface SkillUpdateProps {
  title: string;
  summary: string;
  before: string;
  instructions: string;
  warnings?: string[];
  state?: 'ready' | 'saving' | 'saved' | 'stale' | 'unavailable';
  error?: string;
  onUpdate: () => void;
  onDismiss: () => void;
}

/** A proposed change to lasting instructions. Only the person's press saves it. */
export function SkillUpdate({
  title,
  summary,
  before,
  instructions,
  warnings = [],
  state = 'ready',
  error,
  onUpdate,
  onDismiss,
}: SkillUpdateProps) {
  if (state === 'saved') return <Text role="status">Updated {title}</Text>;
  return (
    <Card as="article" aria-label={`Update ${title}`}>
      <Card.Header>
        <Card.Title>Update {title}</Card.Title>
        <Card.Description>{summary}</Card.Description>
      </Card.Header>
      <Stack gap={3}>
        <Collapsible>
          <Collapsible.Trigger>Current instructions</Collapsible.Trigger>
          <Collapsible.Content inset={false}>
            <pre className={styles.words}>{before}</pre>
          </Collapsible.Content>
        </Collapsible>
        <Collapsible defaultOpen>
          <Collapsible.Trigger>Proposed instructions</Collapsible.Trigger>
          <Collapsible.Content inset={false}>
            <pre className={styles.words}>{instructions}</pre>
          </Collapsible.Content>
        </Collapsible>
        {warnings.length > 0 && (
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <Text size="sm" tone="muted">
          Nothing changes until you update. The skill keeps its current on or off setting.
        </Text>
        {state === 'stale' && (
          <Text role="status">This skill changed since this proposal. Ask for a fresh update.</Text>
        )}
        {state === 'unavailable' && (
          <Text role="status">This skill can’t be updated here. Open Skills to check it.</Text>
        )}
        {error && <Text role="alert">{error}</Text>}
      </Stack>
      <Card.Footer>
        <Button loading={state === 'saving'} disabled={state !== 'ready'} onClick={onUpdate}>
          Update skill
        </Button>
        <Button variant="ghost" disabled={state === 'saving'} onClick={onDismiss}>
          Not now
        </Button>
      </Card.Footer>
    </Card>
  );
}
