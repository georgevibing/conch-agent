import type {
  McpClient,
  McpClientApp,
  McpOverview,
  McpScope,
  McpTarget,
  PairedMcpClient,
} from '@conch/protocol';
import {
  Button,
  Callout,
  CodeBlock,
  Dialog,
  Field,
  Input,
  IntegrationHandshake,
  McpScopePicker,
  OtherAppTargets,
  PairedAppList,
  SecretReveal,
  Stack,
  Switch,
  Text,
  toast,
  type OtherAppTarget,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { otherAppsApi, otherAppsKeys, useOtherApps } from './api';
import { APP_LOOK, pairedWords, scopeChoices, usesWords } from './words';

type Guard = ReturnType<typeof useVerify>['guard'];

/** What a new pairing starts with: enough to be useful, nothing that acts. */
const START: McpScope[] = ['memory.read', 'skills'];

const fail = (error: unknown) => toast.error((error as Error).message);

/** Who's being paired, or changed. */
type Editing =
  | { kind: 'pair'; app: McpClientApp; name: string; file?: string }
  | { kind: 'change'; client: McpClient };

/**
 * Settings → Other apps (ADR 0073): Claude Desktop, Cursor, VS Code and any
 * app that speaks MCP, using Conch's memory, skills, your apps and its
 * browser — each paired by you, each held to what you ticked.
 */
export function OtherAppsTab() {
  const overview = useOtherApps();
  const access = useQuery({ queryKey: keys.access, queryFn: api.access, staleTime: 10_000 });
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  const client = useQueryClient();
  const navigate = useNavigate();
  const closeSettings = useUi((s) => s.closeSettings);
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState<string>();
  const data = overview.data;
  const refresh = () => void client.invalidateQueries({ queryKey: otherAppsKeys.overview });

  if (!data)
    return (
      <Stack gap={6}>
        <Section title="Other apps" description="Loading…">
          {null}
        </Section>
      </Stack>
    );

  const clientsById = new Map(data.clients.map((c) => [c.id, c]));
  const targets: OtherAppTarget[] = data.targets.map((t) => ({
    app: t.app,
    name: t.name,
    state: t.connected ? 'connected' : t.found ? 'ready' : 'missing',
    ...(t.clientId && {
      detail: usesWords(clientsById.get(t.clientId)?.scopes ?? [], data.choices),
    }),
    ...APP_LOOK[t.app],
  }));

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await otherAppsApi.remove(id);
      refresh();
      toast.success('Removed. It can’t use Conch any more.');
    } catch (error) {
      fail(error);
    } finally {
      setRemoving(undefined);
    }
  };

  const setRemote = async (on: boolean) => {
    try {
      await guard(async () => {
        client.setQueryData(otherAppsKeys.overview, await otherAppsApi.remote(on));
      });
    } catch (error) {
      fail(error);
    }
  };

  return (
    <Stack gap={8}>
      <Section
        title="Use Conch from other apps"
        description="Claude Desktop, Cursor and VS Code can use your memory, your skills, your apps and Conch’s browser, through Conch. Each uses only what you tick, and anything that changes something asks you first, here."
      >
        <OtherAppTargets
          targets={targets}
          onConnect={(t) => {
            const target = data.targets.find((x) => x.app === t.app);
            setEditing({
              kind: 'pair',
              app: t.app as McpClientApp,
              name: t.name,
              file: target?.file,
            });
          }}
          onManage={(t) => {
            const paired = data.targets.find((x) => x.app === t.app)?.clientId;
            const found = paired ? clientsById.get(paired) : undefined;
            if (found) setEditing({ kind: 'change', client: found });
          }}
        />
        <div>
          <Button
            variant="surface"
            size="sm"
            leadingIcon={<Plus />}
            onClick={() => setEditing({ kind: 'pair', app: 'other', name: 'Another app' })}
          >
            Another app
          </Button>
        </div>
      </Section>

      <Section title="Paired with Conch" description="What each may use, and what it did.">
        <PairedAppList
          apps={data.clients.map((c) => ({
            id: c.id,
            name: c.name,
            uses: usesWords(c.scopes, data.choices),
            meta: pairedWords(c),
            remote: data.remote && c.remote,
            ...APP_LOOK[c.app],
          }))}
          busy={removing}
          onOpen={(app) => {
            const chat = clientsById.get(app.id)?.conversationId;
            if (!chat) return toast('It hasn’t used anything that needs a chat yet.');
            closeSettings();
            void navigate(`/c/${chat}`);
          }}
          onEdit={(app) => {
            const found = clientsById.get(app.id);
            if (found) setEditing({ kind: 'change', client: found });
          }}
          onRemove={(app) => void remove(app.id)}
        />
      </Section>

      {data.address && (
        <Section
          title="From your own address"
          description="Off unless you need it: an app on another computer reaching Conch over the internet."
        >
          <Stack gap={3}>
            <Switch
              checked={data.remote}
              onCheckedChange={(on) => void setRemote(on)}
              label="Let apps you mark in through your address"
              description={`They connect to ${data.address} with their key. Whoever has that key can use what you let the app use, from anywhere.`}
            />
          </Stack>
        </Section>
      )}

      <PairDialog
        editing={editing}
        overview={data}
        guard={guard}
        onClose={() => setEditing(undefined)}
        onDone={refresh}
      />
      {dialog}
    </Stack>
  );
}

function PairDialog({
  editing,
  overview,
  guard,
  onClose,
  onDone,
}: {
  editing: Editing | undefined;
  overview: McpOverview;
  guard: Guard;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog.Root open={Boolean(editing)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="md" aria-describedby={undefined}>
        {editing && (
          <PairFlow
            key={editing.kind === 'pair' ? editing.app : editing.client.id}
            editing={editing}
            overview={overview}
            guard={guard}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function PairFlow({
  editing,
  overview,
  guard,
  onClose,
  onDone,
}: {
  editing: Editing;
  overview: McpOverview;
  guard: Guard;
  onClose: () => void;
  onDone: () => void;
}) {
  const changing = editing.kind === 'change' ? editing.client : undefined;
  const app = changing?.app ?? (editing.kind === 'pair' ? editing.app : 'other');
  const shownName = changing?.name ?? (editing.kind === 'pair' ? editing.name : '');
  const [scopes, setScopes] = useState<McpScope[]>(changing?.scopes ?? START);
  const [name, setName] = useState('');
  const [http, setHttp] = useState(false);
  const [remote, setRemote] = useState(changing?.remote ?? false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PairedMcpClient>();
  const target: McpTarget | undefined = overview.targets.find((t) => t.app === app);

  const submit = async () => {
    setBusy(true);
    try {
      await guard(async () => {
        if (changing) {
          await otherAppsApi.update(changing.id, {
            scopes,
            ...(changing.http && { remote }),
          });
          onDone();
          toast.success(`Saved. ${changing.name} can use what you ticked.`);
          onClose();
          return;
        }
        const paired = await otherAppsApi.pair({
          app,
          scopes,
          ...(app === 'other' && name.trim() && { name: name.trim() }),
          ...(app === 'other' && { http, remote: http && remote }),
        });
        onDone();
        setDone(paired);
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const title = changing
    ? `What ${changing.name} may use`
    : done
      ? `${done.client.name} is paired`
      : app === 'other'
        ? 'Pair another app'
        : `Connect ${shownName}`;

  return (
    <>
      <Dialog.Header>
        <IntegrationHandshake
          name={shownName || 'Another app'}
          {...APP_LOOK[app]}
          phase={done ? 'connected' : busy ? 'waiting' : 'idle'}
        />
        <Dialog.Title>{title}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {done ? (
          <Stack gap={4}>
            {done.wrote ? (
              <Text>{done.next}</Text>
            ) : done.next ? (
              <Callout tone="warning">{done.next}</Callout>
            ) : (
              <Text>Add Conch to the app’s MCP servers with these settings.</Text>
            )}
            {done.setup && (
              <CodeBlock code={done.setup.json} language="json" filename="Its MCP settings" />
            )}
            {done.setup?.key && (
              <Stack gap={2}>
                <Text size="sm" tone="muted">
                  Or, for an app that connects over HTTP: {done.setup.url}, with this key as its
                  bearer token.
                </Text>
                <SecretReveal secret={done.setup.key} title="Its key" />
              </Stack>
            )}
          </Stack>
        ) : (
          <Stack gap={5}>
            <Text tone="muted">
              {changing
                ? 'It can use exactly what’s ticked. Anything that changes something asks you first, here in Conch.'
                : 'It can use what you tick, through Conch. Anything that changes something asks you first, here in Conch.'}
            </Text>
            {app === 'other' && !changing && (
              <Field>
                <Field.Label>Its name</Field.Label>
                <Input
                  value={name}
                  maxLength={60}
                  placeholder="Zed, Windsurf, my script…"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            )}
            <McpScopePicker
              choices={scopeChoices(overview.choices)}
              value={scopes}
              onChange={(next) => setScopes(next as McpScope[])}
              disabled={busy}
            />
            {app === 'other' && !changing && (
              <Switch
                checked={http}
                onCheckedChange={setHttp}
                label="It connects over HTTP, with a key"
                description="For an app that can’t start Conch’s launcher. Conch shows the key once."
              />
            )}
            {overview.address && ((app === 'other' && http && !changing) || changing?.http) && (
              <Switch
                checked={remote}
                onCheckedChange={setRemote}
                label="It may come in through your address"
                description="Only while “From your own address” is on in Other apps."
              />
            )}
            {target && !changing && (
              <Text size="sm" tone="subtle">
                Conch adds itself to {target.name}’s settings ({target.file}). Nothing else in that
                file changes, and its old copy is kept beside it.
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
            <Button loading={busy} disabled={!scopes.length} onClick={() => void submit()}>
              {changing ? 'Save' : app === 'other' ? 'Pair' : 'Connect'}
            </Button>
          </>
        )}
      </Dialog.Footer>
    </>
  );
}
