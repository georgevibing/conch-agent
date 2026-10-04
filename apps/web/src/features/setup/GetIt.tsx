import { Button, Callout, Progress, Stack, Text } from '@conch/nacre';
import { ArrowUpRight, Download, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { AdminCommand } from './AdminCommand';
import { useNeed } from './useNeed';

/**
 * The one button that gets something Conch needs (AGENTS.md agreement 11):
 * “Install Codex” or “Update Codex”. It shows the installer's own progress,
 * says why in plain words if it fails, and always leaves the website as a way
 * out. Whatever was waiting on it notices by itself when it's done.
 */
export function GetIt({
  needId,
  kind = 'install',
  name: given,
  lead,
  children,
}: {
  needId: string;
  kind?: 'install' | 'update';
  /** "Codex"; the need's own short name when left out. */
  name?: string;
  /** One sentence above the button. */
  lead?: ReactNode;
  /** Another way to do it by hand (commands to copy), folded under the button. */
  children?: ReactNode;
}) {
  const { need, running, justDone, starting, error, act, dialog } = useNeed(needId);
  const name = given ?? need?.short ?? 'it';
  const label = kind === 'update' ? `Update ${name}` : `Install ${name}`;
  // Nothing Conch can run here (no winget, Homebrew or npm): the website it is.
  const canRun = kind === 'update' || Boolean(need?.install);
  // Only an administrator can get it here: typed into the terminal for them.
  if (need?.admin && kind === 'install' && !running)
    return (
      <Stack gap={3}>
        {lead && <Text tone="muted">{lead}</Text>}
        <AdminCommand
          command={need.admin.command}
          what={need.admin.what}
          label={`Set up ${name}`}
          watch={needId}
        />
        {children}
        {dialog}
      </Stack>
    );
  // Just finished: say so while the next step arrives, never the button again.
  if (justDone)
    return (
      <Stack gap={3}>
        <Callout tone="success" live="polite">
          {kind === 'update' ? `${name} is up to date.` : `${name} is installed.`}
        </Callout>
        {dialog}
      </Stack>
    );
  return (
    <Stack gap={3}>
      {lead && <Text tone="muted">{lead}</Text>}
      {running ? (
        <Progress
          value={need?.progress?.percent}
          label={
            need?.progress?.label ?? `${kind === 'update' ? 'Updating' : 'Installing'} ${name}…`
          }
        />
      ) : canRun ? (
        <Stack direction="row" gap={2} wrap align="center">
          <Button
            leadingIcon={kind === 'update' ? <RefreshCw /> : <Download />}
            loading={starting}
            onClick={() => void act(kind)}
          >
            {error ? `Try ${kind === 'update' ? 'updating' : 'installing'} again` : label}
          </Button>
          {need?.install && (
            <Text as="span" size="xs" tone="subtle" title={need.install.command}>
              Runs <code>{need.install.command.split(' ').slice(0, 4).join(' ')}…</code>
            </Text>
          )}
        </Stack>
      ) : null}
      {error && (
        <Callout tone="danger" live="polite">
          {error}
        </Callout>
      )}
      {!running && (error || !canRun) && need?.download && (
        <Button asChild variant="surface" trailingIcon={<ArrowUpRight />}>
          <a href={need.download} target="_blank" rel="noopener noreferrer">
            Get {name} from its website
          </a>
        </Button>
      )}
      {children}
      {dialog}
    </Stack>
  );
}
