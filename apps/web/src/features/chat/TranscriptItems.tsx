import {
  Button,
  Callout,
  Collapsible,
  CopyButton,
  Diff,
  InlineCode,
  Message,
  Stack,
  Surface,
  Text,
  ToolCall,
  toast,
  type ToolCallStatus,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, Check, ShieldQuestion, Undo2, X } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { Markdown } from './Markdown';
import { formatInput, toolDiff, toolSummary } from './tools';
import styles from './Transcript.module.css';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

export function UserMessage({ item }: { item: Of<'user'> }) {
  return (
    <Message
      from="user"
      timestamp={new Date(item.at)}
      data-pending={item.pending || undefined}
      className={styles.user}
    >
      <span className={styles.userText}>{item.text}</span>
    </Message>
  );
}

function thoughtFor(item: Of<'assistant'>): string {
  const end = item.textAt ?? item.thoughtEndedAt ?? item.endedAt;
  if (!end) return 'Thinking…';
  const s = Math.max(1, Math.round((end - item.startedAt) / 1000));
  return `Thought for ${s}s`;
}

export function AssistantMessage({ item, name }: { item: Of<'assistant'>; name: string }) {
  const streaming = !item.done;
  if (!item.text && !item.thinking) return null;
  if (item.continuation) {
    return (
      <div className={styles.continuation} data-streaming={streaming || undefined}>
        {item.thinking && !item.text && (
          <Text size="sm" tone="subtle">
            {thoughtFor(item)}
          </Text>
        )}
        {item.text && <Markdown text={item.text} />}
      </div>
    );
  }
  return (
    <Message
      from="assistant"
      author={name}
      timestamp={new Date(item.startedAt)}
      status={streaming ? 'streaming' : 'complete'}
      actions={
        item.done && item.text ? <CopyButton value={item.text} label="Copy reply" /> : undefined
      }
    >
      <Stack gap={2}>
        {item.thinking && (
          <Collapsible>
            <Collapsible.Trigger className={styles.thought}>{thoughtFor(item)}</Collapsible.Trigger>
            <Collapsible.Content>
              <Text size="sm" tone="muted" className={styles.thinking}>
                {item.thinking}
              </Text>
            </Collapsible.Content>
          </Collapsible>
        )}
        {item.text && <Markdown text={item.text} />}
      </Stack>
    </Message>
  );
}

const toolStatus: Record<Of<'tool'>['status'], ToolCallStatus> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  error: 'error',
};

export function ToolItem({ item }: { item: Of<'tool'> }) {
  const diff = toolDiff(item.name, item.input);
  const stopped = item.status === 'error' && item.output === 'Stopped.';
  return (
    <ToolCall
      name={item.name}
      summary={toolSummary(item.name, item.input)}
      status={stopped ? 'cancelled' : toolStatus[item.status]}
      duration={item.durationMs}
      input={diff ? undefined : formatInput(item.input)}
      inputLanguage="json"
      output={item.output || undefined}
    >
      {diff && <Diff diff={diff} header={false} lineNumbers={false} />}
    </ToolCall>
  );
}

/** Render `backticked` spans of a summary as inline code. */
function withCode(text: string) {
  return text
    .split(/(`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') ? (
        <InlineCode key={i}>{part.slice(1, -1)}</InlineCode>
      ) : (
        part
      ),
    );
}

export function PermissionCard({
  item,
  name,
  onRespond,
}: {
  item: Of<'permission'>;
  name: string;
  onRespond: (decision: 'allow' | 'allow-always' | 'deny') => void;
}) {
  const [sent, setSent] = useState<string>();
  const allowRef = useAutoFocus<HTMLButtonElement>();
  if (item.decision) {
    const allowed = item.decision === 'allow' || item.decision === 'allow-always';
    return (
      <div className={styles.resolved} data-allowed={allowed || undefined}>
        {allowed ? <Check aria-hidden /> : <X aria-hidden />}
        <span>
          {item.decision === 'expired'
            ? 'Request expired'
            : allowed
              ? item.decision === 'allow-always'
                ? 'Always allowed'
                : 'Allowed'
              : 'Declined'}
          {' · '}
          {withCode(item.summary)}
        </span>
      </div>
    );
  }
  const respond = (decision: 'allow' | 'allow-always' | 'deny') => {
    setSent(decision);
    onRespond(decision);
  };
  const command =
    item.toolName === 'Bash' && typeof (item.input as { command?: unknown })?.command === 'string'
      ? (item.input as { command: string }).command
      : undefined;
  return (
    <Surface
      lustre
      elevation={2}
      radius="lg"
      className={styles.permission}
      role="group"
      aria-label="Permission request"
    >
      <div className={styles.permissionHead}>
        <span className={styles.permissionIcon} aria-hidden>
          <ShieldQuestion />
        </span>
        <Stack gap={0.5}>
          <Text weight="semibold">
            {name} would like to{' '}
            {withCode(item.summary.charAt(0).toLowerCase() + item.summary.slice(1))}
          </Text>
          <Text size="sm" tone="muted">
            Nothing happens until you decide.
          </Text>
        </Stack>
      </div>
      {command && <pre className={styles.permissionCommand}>{command}</pre>}
      <div className={styles.permissionActions}>
        <Button variant="ghost" onClick={() => respond('deny')} disabled={Boolean(sent)}>
          Deny
        </Button>
        <Button
          variant="surface"
          onClick={() => respond('allow-always')}
          disabled={Boolean(sent)}
          loading={sent === 'allow-always'}
        >
          Always allow
        </Button>
        <Button
          ref={allowRef}
          onClick={() => respond('allow')}
          disabled={Boolean(sent)}
          loading={sent === 'allow'}
        >
          Allow
        </Button>
      </div>
    </Surface>
  );
}

export function MemoryPill({ item }: { item: Of<'memory'> }) {
  const client = useQueryClient();
  const [undone, setUndone] = useState(false);
  const undo = async () => {
    try {
      await api.deleteMemory(item.memoryId);
      setUndone(true);
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className={styles.memory} data-action={undone ? 'undone' : item.action}>
      <Brain aria-hidden />
      <span className={styles.memoryText}>
        {undone ? 'Forgot' : item.action === 'saved' ? 'Remembered' : 'Forgot'}: {item.content}
      </span>
      {item.action === 'saved' && !undone && (
        <Button variant="ghost" size="sm" leadingIcon={<Undo2 />} onClick={() => void undo()}>
          Undo
        </Button>
      )}
    </div>
  );
}

export function TurnEnd({ item, onRetry }: { item: Of<'turn-end'>; onRetry?: () => void }) {
  if (item.outcome === 'interrupted') {
    return <div className={styles.stopped}>Stopped</div>;
  }
  if (item.outcome === 'error') {
    return (
      <Callout
        tone="danger"
        title="That didn’t work"
        action={
          onRetry && (
            <Button size="sm" variant="surface" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      >
        {item.error ?? 'Something went wrong while Claude was working.'}
      </Callout>
    );
  }
  return null;
}
