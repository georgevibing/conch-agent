import type {
  McpClient,
  McpClientApp,
  McpOverview,
  McpScope,
  McpTarget,
  PairedMcpClient,
} from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  CodeBlock,
  Collapsible,
  Dialog,
  EmptyState,
  Field,
  Heading,
  Input,
  IntegrationHandshake,
  McpScopePicker,
  OtherAppsArt,
  OtherAppTargets,
  PairedAppList,
  PairedAppListSkeleton,
  SecretReveal,
  Stack,
  Switch,
  Text,
  toast,
  type OtherAppTarget,
  type PairedAppItem,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useVerify } from '../auth/useVerify';
import { otherAppsApi, otherAppsKeys, useOtherApps } from './api';
import styles from './OtherApps.module.css';
import { APP_LOOK, pairedWords, scopeChoices, usesWords } from './words';

type Guard = ReturnType<typeof useVerify>['guard'];

/** What a new pairing starts with: enough to be useful, nothing that acts. */
const START: McpScope[] = ['memory.read', 'skills'];

const fail = (error: unknown) => toast.error((error as Error).message);

/** Who's being paired, or changed. */
type Editing =
  | { kind: 'choose' }
  | { kind: 'pair'; app: McpClientApp; name: string; file?: string; back?: boolean }
  | { kind: 'change'; client: McpClient };

export interface OtherAppsTabProps {
  /**
   * The level of this place's own heading: 3 under a settings page's title,
   * 4 when it's a section inside another section. Its parts sit one below.
   */
  headingLevel?: 2 | 3 | 4 | 5;
}

/**
 * Apps that use Conch, in Settings → Access under Advanced (ADR 0073): Claude Desktop, Cursor, VS Code and any
 * app that speaks MCP, using Conch's memory, skills, your apps and its
 * browser — each paired by you, each held to what you ticked.
 *
 * It's drawn as a section, not a page: it brings its own heading (at
 * `headingLevel`) and nothing that assumes the whole window, so it can sit
 * inside another place.
 */
export function OtherAppsTab({ headingLevel = 3 }: OtherAppsTabProps = {}) {
  const overview = useOtherApps();
  const access = useQuery({ queryKey: keys.access, queryFn: api.access, staleTime: 10_000 });
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  const client = useQueryClient();
  const navigate = useNavigate();
  const closeSettings = useUi((s) => s.closeSettings);
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState<string>();
  const [confirming, setConfirming] = useState<PairedAppItem>();
  const data = overview.data;
  const refresh = () => void client.invalidateQueries({ queryKey: otherAppsKeys.overview });
  const inner = (headingLevel + 1) as 3 | 4 | 5 | 6;
  const paired = data?.clients ?? [];
  const choose = () => setEditing({ kind: 'choose' });
  const titleId = useId();

  const clientsById = new Map(paired.map((c) => [c.id, c]));

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

  // The apps on this computer, for the picture: what you'd pair first.
  const here = (data?.targets ?? [])
    .filter((t) => t.found)
    .map((t) => ({ name: t.name, ...APP_LOOK[t.app] }));

  return (
    <section className={styles.place} aria-labelledby={titleId}>
      <div className={styles.head}>
        <Stack gap={0.5}>
          <Heading id={titleId} level={headingLevel} size="lg">
            Apps that use Conch
          </Heading>
          <Text size="sm" tone="muted">
            Programs like Claude Desktop or Cursor can use your memory, skills and apps. Each gets
            only what you choose.
          </Text>
        </Stack>
        {paired.length > 0 && (
          <Button variant="surface" size="sm" leadingIcon={<Plus />} onClick={choose}>
            Pair an app
          </Button>
        )}
      </div>

      <div
        className={styles.region}
        data-state={!data ? 'loading' : paired.length ? 'list' : 'empty'}
        aria-busy={!data}
      >
        {!data ? (
          <>
            <PairedAppListSkeleton rows={2} />
            <span className="nc-visually-hidden" role="status">
              Loading the apps paired with Conch…
            </span>
          </>
        ) : paired.length ? (
          <PairedAppList
            apps={paired.map((c) => ({
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
              if (!chat) return toast('Nothing to show yet. It hasn’t done anything here.');
              closeSettings();
              void navigate(`/c/${chat}`);
            }}
            onEdit={(app) => {
              const found = clientsById.get(app.id);
              if (found) setEditing({ kind: 'change', client: found });
            }}
            onRemove={setConfirming}
          />
        ) : (
          <EmptyState
            size="sm"
            headingLevel={inner}
            media={<OtherAppsArt apps={here} />}
            title="Nothing paired yet"
            description="Pair an app, and it can use what you choose. It asks you before it changes anything."
            actions={
              <Button leadingIcon={<Plus />} onClick={choose}>
                Pair an app
              </Button>
            }
          />
        )}
      </div>

      {data && <ForDevelopers overview={data} onRemote={(on) => void setRemote(on)} />}

      <PairDialog
        editing={editing}
        overview={data}
        guard={guard}
        onEdit={setEditing}
        onClose={() => setEditing(undefined)}
        onDone={refresh}
      />
      <AlertDialog.Root
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(undefined)}
      >
        <AlertDialog.Content icon={<Trash2 />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove {confirming?.name}?</AlertDialog.Title>
            <AlertDialog.Description>
              It stops using Conch at once. You can pair it again any time.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel />
            <AlertDialog.Action
              onClick={() => {
                if (confirming) void remove(confirming.id);
              }}
            >
              Remove
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </section>
  );
}

/**
 * How it works underneath, for the few who want it: the protocol's name, the
 * address, and whether apps on other computers may come in. Open by itself
 * while they may, so that's never out of sight.
 */
function ForDevelopers({
  overview,
  onRemote,
}: {
  overview: McpOverview;
  onRemote: (on: boolean) => void;
}) {
  return (
    <Collapsible defaultOpen={overview.remote} className={styles.developers}>
      <Collapsible.Trigger>For developers</Collapsible.Trigger>
      <Collapsible.Content>
        <Stack gap={4} className={styles.developersBody}>
          <Text size="sm" tone="muted">
            Conch is an MCP server. Pairing an app writes its launcher into that app’s settings. An
            app that can’t run it gets a key, and connects over HTTP here:
          </Text>
          <CodeBlock code={overview.endpoint} language="text" filename="Conch’s MCP address" />
          {overview.address && (
            <Switch
              checked={overview.remote}
              onCheckedChange={onRemote}
              label="Let apps on other computers in"
              description={`Only apps you allow, through ${overview.address}, each with its own key. Whoever has a key can use what that app may use.`}
            />
          )}
        </Stack>
      </Collapsible.Content>
    </Collapsible>
  );
}

function PairDialog({
  editing,
  overview,
  guard,
  onEdit,
  onClose,
  onDone,
}: {
  editing: Editing | undefined;
  overview: McpOverview | undefined;
  guard: Guard;
  onEdit: (next: Editing) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const key = !editing
    ? ''
    : editing.kind === 'choose'
      ? 'choose'
      : editing.kind === 'pair'
        ? editing.app
        : editing.client.id;
  return (
    <Dialog.Root open={Boolean(editing && overview)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="md" aria-describedby={undefined}>
        {editing &&
          overview &&
          (editing.kind === 'choose' ? (
            <ChooseApp overview={overview} onEdit={onEdit} onClose={onClose} />
          ) : (
            <PairFlow
              key={key}
              editing={editing}
              overview={overview}
              guard={guard}
              onBack={() => onEdit({ kind: 'choose' })}
              onClose={onClose}
              onDone={onDone}
            />
          ))}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** The first step of Pair an app: which one. The ones on this computer connect in one press. */
function ChooseApp({
  overview,
  onEdit,
  onClose,
}: {
  overview: McpOverview;
  onEdit: (next: Editing) => void;
  onClose: () => void;
}) {
  const clientsById = new Map(overview.clients.map((c) => [c.id, c]));
  const targets: OtherAppTarget[] = overview.targets.map((t) => ({
    app: t.app,
    name: t.name,
    state: t.connected ? 'connected' : t.found ? 'ready' : 'missing',
    ...(t.clientId && {
      detail: usesWords(clientsById.get(t.clientId)?.scopes ?? [], overview.choices),
    }),
    ...APP_LOOK[t.app],
  }));
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Pair an app</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap={4}>
          <Text tone="muted">
            Choose the app. Conch adds itself to it, and you choose what it may use.
          </Text>
          <OtherAppTargets
            targets={targets}
            onConnect={(t) => {
              const target = overview.targets.find((x) => x.app === t.app);
              onEdit({
                kind: 'pair',
                app: t.app as McpClientApp,
                name: t.name,
                file: target?.file,
                back: true,
              });
            }}
            onManage={(t) => {
              const id = overview.targets.find((x) => x.app === t.app)?.clientId;
              const found = id ? clientsById.get(id) : undefined;
              if (found) onEdit({ kind: 'change', client: found });
            }}
          />
          <div>
            <Button
              variant="surface"
              size="sm"
              leadingIcon={<Plus />}
              onClick={() =>
                onEdit({ kind: 'pair', app: 'other', name: 'Another app', back: true })
              }
            >
              Another app
            </Button>
          </div>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </Dialog.Footer>
    </>
  );
}

function PairFlow({
  editing,
  overview,
  guard,
  onBack,
  onClose,
  onDone,
}: {
  editing: Exclude<Editing, { kind: 'choose' }>;
  overview: McpOverview;
  guard: Guard;
  onBack: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const changing = editing.kind === 'change' ? editing.client : undefined;
  const app = changing?.app ?? (editing.kind === 'pair' ? editing.app : 'other');
  const shownName = changing?.name ?? (editing.kind === 'pair' ? editing.name : '');
  const back = editing.kind === 'pair' && editing.back;
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
              <Text>Paste this into the app’s settings, where it lists its tools or servers.</Text>
            )}
            {done.setup && (
              <CodeBlock code={done.setup.json} language="json" filename="Settings to paste" />
            )}
            {done.setup?.key && (
              <Stack gap={2}>
                <Text size="sm" tone="muted">
                  If the app asks for an address and a key instead, use {done.setup.url} and this
                  key. You’ll only see it now.
                </Text>
                <SecretReveal secret={done.setup.key} title="Its key" />
              </Stack>
            )}
          </Stack>
        ) : (
          <Stack gap={5}>
            <Text tone="muted">
              It gets only what you tick. Anything that changes something asks you first, here in
              Conch.
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
                label="Give it a key instead"
                description="For an app that can’t start Conch by itself. You’ll see the key once."
              />
            )}
            {overview.address && ((app === 'other' && http && !changing) || changing?.http) && (
              <Switch
                checked={remote}
                onCheckedChange={setRemote}
                label="Let it in from another computer"
                description="Only while apps on other computers are let in, under For developers."
              />
            )}
            {target && !changing && (
              <Text size="sm" tone="subtle">
                Conch adds itself to {target.file} and keeps a copy of the old one. Nothing else in
                it changes.
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
            <Button variant="ghost" onClick={back ? onBack : onClose}>
              {back ? 'Back' : 'Cancel'}
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
