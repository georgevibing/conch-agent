import type { ConchApp, ConchAppFound, Integration, IntegrationPolicy } from '@conch/protocol';
import {
  AlertDialog,
  AppAbilityList,
  AppChanges,
  AppIcon,
  AppPreview,
  AppVersions,
  Button,
  Callout,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Heading,
  Input,
  IntegrationStatusBadge,
  Page,
  PasswordInput,
  Skeleton,
  Stack,
  Switch,
  Text,
  toast,
  META_SEP,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  ExternalLink,
  KeyRound,
  MessageSquare,
  PencilLine,
  Share2,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useConversations } from '../../api/queries';
import { usePageTrail } from '../../app/trail';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { AppAbilitiesSection } from '../integrations/AppAbilitiesSection';
import type { AppItem } from '../integrations/apps';
import { PolicyAndTools } from '../integrations/IntegrationDetailView';
import intStyles from '../integrations/Integrations.module.css';
import { APPS_PATH } from '../integrations/paths';
import {
  errorText,
  putIntegration,
  useAssistantName,
  useUpdateIntegration,
} from '../integrations/queries';
import { integrationsApi } from '../integrations/api';
import { conchAppsApi } from './api';
import styles from './ConchApps.module.css';
import { conchAppKeys, putConchApp, useConchApp } from './queries';
import { ShareFlow } from './ShareFlow';
import { updateApp } from './update';
import { useStartChat } from './useStartChat';
import { appLook, appWords, conchPagePath, sizeInWords } from './words';

const SETTINGS_ID = 'capp-settings';

/** "2 KB", "less than 1 KB", "nothing yet": what an app keeps, inside a sentence. */
const keptInWords = (bytes: number) =>
  bytes <= 0 ? 'nothing yet' : bytes < 1024 ? 'less than 1 KB' : sizeInWords(bytes);

/**
 * A Conch app's page (ADR 0061, ADR 0052): who it's from and what it can
 * do; a new version waiting, with what changed first; its switches and
 * each tool's Allow · Ask · Off; its pages; things to try; its settings
 * (a secret one shown as saved, never again); and sharing, changing, going
 * back to an earlier version and removing it.
 */
export function ConchAppDetail({ appId, item }: { appId: string; item: AppItem }) {
  const { data: app, isPending } = useConchApp(appId);
  const navigate = useNavigate();
  const integration = item.integration;
  if (isPending && !app)
    return (
      <Page gap={8}>
        <Skeleton shape="block" height="4.5rem" />
        <Skeleton shape="block" height="12rem" />
      </Page>
    );
  if (!app || !integration)
    return (
      <Page gap={8}>
        <EmptyState
          title="This app isn’t here any more"
          description="It may have been removed on another device."
          actions={<Button onClick={() => void navigate(APPS_PATH)}>See all apps</Button>}
        />
      </Page>
    );
  return <Detail app={app} integration={integration} item={item} />;
}

function Detail({
  app,
  integration,
  item,
}: {
  app: ConchApp;
  integration: Integration;
  item: AppItem;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const update = useUpdateIntegration();
  const assistant = useAssistantName();
  const startChat = useStartChat();
  const { data: chats } = useConversations();
  const [sharing, setSharing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [keepData, setKeepData] = useState(true);
  const [goingBack, setGoingBack] = useState<string>();
  const [updating, setUpdating] = useState(false);
  const [looking, setLooking] = useState<ConchAppFound | 'loading'>();
  const settingsRef = useRef<HTMLElement>(null);
  const { manifest } = app;
  const words = appWords({
    ...app,
    ...(app.update && { changes: app.update.changes }),
  });
  const enabled = integration.enabled;
  const health = integration.health;

  useEffect(() => {
    document.title = `${manifest.name} · Conch`;
  }, [manifest.name]);
  usePageTrail([{ label: 'Apps', to: APPS_PATH }, { label: manifest.name }]);

  // A card's "Change settings" (a setting missing) lands on the field.
  const focusSettings = () => {
    settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    settingsRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  };
  const wantsSettings = (location.state as { focus?: string } | null)?.focus === 'token';
  useEffect(() => {
    if (wantsSettings) focusSettings();
  }, [wantsSettings]);

  const setPolicy = (policy: IntegrationPolicy) =>
    void guard(async () =>
      putIntegration(client, await integrationsApi.update(integration.id, { policy })),
    ).catch((error: unknown) => toast.error(errorText(error)));

  const applyUpdate = async (seen?: ConchAppFound) => {
    setUpdating(true);
    try {
      await guard(async () => {
        const outcome = await updateApp(app, seen);
        if ('look' in outcome) {
          // Something newer came since: nothing changed, and the new one is shown first.
          setLooking(outcome.look);
          toast('A newer version arrived since you looked', {
            description: 'Here’s what it does now. Press Update if you still want it.',
          });
          return;
        }
        putConchApp(client, outcome.updated);
        setLooking(undefined);
        toast.success(
          `${outcome.updated.manifest.name} is updated to ${outcome.updated.manifest.version}`,
        );
      });
    } catch (error) {
      toast.error(errorText(error, 'It didn’t update. Nothing changed.'));
    } finally {
      setUpdating(false);
    }
  };

  const lookFirst = async () => {
    setLooking('loading');
    try {
      setLooking(await conchAppsApi.updatePreview(app.id));
    } catch (error) {
      setLooking(undefined);
      toast.error(errorText(error, 'Conch couldn’t read the new version. Try again.'));
    }
  };

  const goBack = async (version: string) => {
    setGoingBack(version);
    try {
      await guard(async () => {
        const back = await conchAppsApi.rollback(app.id, version);
        putConchApp(client, back);
        void client.invalidateQueries({ queryKey: conchAppKeys.all });
        toast.success(`${back.manifest.name} is back to ${back.manifest.version}`);
      });
    } catch (error) {
      toast.error(errorText(error, 'It didn’t go back. Nothing changed.'));
    } finally {
      setGoingBack(undefined);
    }
  };

  const remove = async () => {
    try {
      await conchAppsApi.remove(app.id, keepData);
      client.setQueryData<ConchApp[]>(conchAppKeys.all, (list) =>
        list?.filter((a) => a.id !== app.id),
      );
      void client.invalidateQueries({ queryKey: ['integrations'] });
      toast(`Removed ${manifest.name}`, {
        description: keepData
          ? 'What it kept stays on this computer, in case you add it again.'
          : undefined,
      });
      void navigate(APPS_PATH);
    } catch (error) {
      toast.error(errorText(error, 'It wasn’t removed. Try again.'));
    }
  };

  // Change it: the chat it was made in, when it's still there; else a new one, ready to say what.
  const madeIn = chats?.find((c) => c.id === app.conversationId);
  const changeIt = () =>
    madeIn
      ? void navigate(`/c/${madeIn.id}`)
      : void navigate('/', { state: { draft: `Change ${manifest.name}: ` } });

  const missing = app.missing.length > 0 && enabled;
  const versionsFor = app.versions;

  return (
    <Page gap={8}>
      <header className={intStyles.detailHeader}>
        <AppIcon {...appLook(app)} size="xl" status={enabled ? health.state : 'off'} />
        <Stack gap={1} className={intStyles.detailTitle}>
          <Heading level={1} size="2xl">
            {manifest.name}
          </Heading>
          <Text tone="muted">{manifest.tagline}</Text>
          <Stack direction="row" gap={2} align="center" wrap>
            <IntegrationStatusBadge state={enabled ? health.state : 'off'} />
            <Text as="span" size="sm" tone="subtle">
              {words.from}
              {META_SEP}
              {manifest.version}
            </Text>
          </Stack>
        </Stack>
        <label className={intStyles.detailSwitch}>
          <Text as="span" size="sm" tone="muted">
            {enabled ? 'On' : 'Off'}
          </Text>
          <Switch
            checked={enabled}
            aria-label={enabled ? `Turn off ${manifest.name}` : `Turn on ${manifest.name}`}
            onCheckedChange={(on) => update.mutate({ id: integration.id, patch: { enabled: on } })}
          />
        </label>
      </header>

      <Stack direction="row" gap={2} wrap>
        {manifest.pages[0] && (
          <Button
            leadingIcon={<AppWindow />}
            onClick={() => void navigate(conchPagePath(app.id, manifest.pages[0]?.id ?? ''))}
          >
            Open {manifest.pages[0].title}
          </Button>
        )}
        <Button variant="surface" leadingIcon={<PencilLine />} onClick={changeIt}>
          Change it
        </Button>
        <Button variant="surface" leadingIcon={<Share2 />} onClick={() => setSharing(true)}>
          Share
        </Button>
        {app.published && (
          <Button asChild variant="ghost" trailingIcon={<ExternalLink />}>
            <a href={app.published} target="_blank" rel="noopener noreferrer">
              On GitHub
            </a>
          </Button>
        )}
      </Stack>

      {missing && (
        <Callout
          tone="info"
          live="polite"
          title={health.message ?? `${manifest.name} needs something from you first.`}
          action={
            <Button size="sm" leadingIcon={<KeyRound />} onClick={focusSettings}>
              Add it
            </Button>
          }
        >
          It’s typed here, kept on this computer, and {assistant} never sees it.
        </Callout>
      )}
      {!missing && enabled && health.state === 'error' && health.message && (
        <Callout tone="danger" live="polite" title={health.message} />
      )}
      {!enabled && (
        <Callout tone="info" title="Off">
          {assistant} can’t use {manifest.name} while it’s off. What it kept stays here for when you
          turn it back on.
        </Callout>
      )}

      {app.update && (
        <Callout
          tone="info"
          title={`Version ${app.update.version} is ready`}
          action={
            <Stack direction="row" gap={2} wrap>
              <Button size="sm" onClick={() => void applyUpdate()} loading={updating}>
                Update
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void lookFirst()}
                loading={looking === 'loading'}
              >
                Look first
              </Button>
            </Stack>
          }
        >
          {words.changes && <AppChanges changes={app.update.changes} words={words.changes} />}
        </Callout>
      )}

      {manifest.description && <Text className={styles.about}>{manifest.description}</Text>}

      <section className={intStyles.section} aria-labelledby="capp-can">
        <Heading level={2} id="capp-can" size="md">
          What it can do
        </Heading>
        <AppAbilityList
          // What it looks up and changes, tool by tool, is in its switches below.
          abilities={appWords(app).abilities.filter(
            (line) => line.kind !== 'looks' && line.kind !== 'changes',
          )}
          label={`What ${manifest.name} can do`}
        />
      </section>

      <AppAbilitiesSection item={item} />
      <PolicyAndTools integration={integration} onPolicy={setPolicy} />

      {manifest.pages.length > 0 && (
        <section className={intStyles.section} aria-labelledby="capp-pages">
          <Heading level={2} id="capp-pages" size="md">
            {manifest.pages.length > 1 ? 'Its pages' : 'Its page'}
          </Heading>
          <ul className={styles.pages}>
            {manifest.pages.map((page) => (
              <li key={page.id} className={styles.pageRow}>
                <AppWindow aria-hidden className={styles.pageIcon} />
                <Text as="span" weight="medium" className={styles.pageName}>
                  {page.title}
                </Text>
                <Button
                  size="sm"
                  variant="surface"
                  onClick={() => void navigate(conchPagePath(app.id, page.id))}
                  aria-label={`Open the ${page.title} page`}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
          <Switch
            checked={app.pinned}
            label="In the sidebar, under Pinned"
            onCheckedChange={(pinned) =>
              void conchAppsApi
                .setPinned(app.id, pinned)
                .then((next) => putConchApp(client, next))
                .catch((error: unknown) => toast.error(errorText(error)))
            }
          />
        </section>
      )}

      {manifest.examples.length > 0 && enabled && !missing && (
        <section className={intStyles.section} aria-labelledby="capp-try">
          <Heading level={2} id="capp-try" size="md">
            Try it
          </Heading>
          <div className={intStyles.examples}>
            {manifest.examples.map((example) => (
              <Button
                key={example}
                variant="surface"
                size="sm"
                leadingIcon={<MessageSquare />}
                onClick={() => startChat(example)}
                className={intStyles.example}
              >
                {example}
              </Button>
            ))}
          </div>
        </section>
      )}

      {manifest.settings.length > 0 && (
        <SettingsSection app={app} sectionRef={settingsRef} assistant={assistant} />
      )}

      <AppVersions
        name={manifest.name}
        current={{ version: manifest.version, at: app.updatedAt }}
        versions={versionsFor}
        onGoBack={(version) => void goBack(version)}
        busy={goingBack}
      />

      <section className={intStyles.dangerZone}>
        <Stack direction="row" gap={3} align="center" justify="between" wrap>
          <Text size="sm" tone="subtle">
            Keeps {keptInWords(app.dataBytes)} on this computer.
          </Text>
          <Button
            variant="ghost"
            tone="danger"
            leadingIcon={<Trash2 />}
            onClick={() => setRemoving(true)}
          >
            Remove {manifest.name}
          </Button>
        </Stack>
      </section>

      <Dialog.Root open={sharing} onOpenChange={setSharing}>
        <Dialog.Content size="md" aria-describedby={undefined}>
          <Dialog.Header className="nc-visually-hidden">
            <Dialog.Title>Share {manifest.name}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <ShareFlow appId={app.id} name={manifest.name} source={app.source} />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={looking !== undefined && looking !== 'loading'}
        onOpenChange={(open) => !open && setLooking(undefined)}
      >
        <Dialog.Content size="md" aria-describedby={undefined}>
          <Dialog.Header>
            <Dialog.Title>
              {manifest.name} {app.update?.version}
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            {looking && looking !== 'loading' && (
              <AppPreview
                state="ready"
                looking={words.from}
                apps={[
                  {
                    manifest: looking.manifest,
                    tools: looking.tools,
                    signature: looking.signature,
                    problems: looking.problems,
                    ...(looking.warnings && { warnings: looking.warnings }),
                    installed: looking.installed ?? manifest.version,
                    ...(looking.changes && { changes: looking.changes }),
                    ...(looking.picture && { picture: looking.picture }),
                    saved: looking.changes?.otherMaker ? [] : app.saved,
                    words: appWords({
                      manifest: looking.manifest,
                      tools: looking.tools,
                      source: app.source,
                      signature: looking.signature,
                      ...(looking.changes && { changes: looking.changes }),
                    }),
                  },
                ]}
                busy={updating ? looking.manifest.id : undefined}
                onAdd={() => void applyUpdate(looking)}
              />
            )}
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      <AlertDialog.Root open={removing} onOpenChange={setRemoving}>
        <AlertDialog.Content tone="danger" icon={<Trash2 />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove {manifest.name}?</AlertDialog.Title>
            <AlertDialog.Description>
              {assistant} won’t be able to use it any more
              {manifest.pages.length ? ', and its page leaves your sidebar' : ''}.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <Checkbox
            checked={keepData}
            onCheckedChange={(v) => setKeepData(v === true)}
            label={`Keep what it saved (${keptInWords(app.dataBytes)})`}
            description="Add it again from the same place, or from a file of it you saved, and it carries on where it was."
          />
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action tone="danger" onClick={() => void remove()}>
              Remove
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </Page>
  );
}

/** Its settings: plain ones as they are, a secret one only as "saved", replaced by typing a new one. */
function SettingsSection({
  app,
  sectionRef,
  assistant,
}: {
  app: ConchApp;
  sectionRef: React.RefObject<HTMLElement | null>;
  assistant: string;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const changed = Object.entries(values).filter(
    ([key, value]) => value.trim() !== (app.values[key] ?? ''),
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!changed.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await conchAppsApi.setSettings(app.id, Object.fromEntries(changed));
      putConchApp(client, next);
      void client.invalidateQueries({ queryKey: ['integrations'] });
      setValues({});
      toast.success(`Saved ${app.manifest.name}’s settings`);
    } catch (e) {
      setError(errorText(e, 'They weren’t saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      ref={sectionRef}
      id={SETTINGS_ID}
      className={intStyles.section}
      aria-labelledby="capp-settings-title"
    >
      <Stack gap={0.5}>
        <Heading level={2} id="capp-settings-title" size="md">
          Settings
        </Heading>
        <Text size="sm" tone="muted">
          Kept on this computer. {assistant} never sees them.
        </Text>
      </Stack>
      <form onSubmit={(e) => void save(e)} className={intStyles.tokenForm} noValidate>
        {app.manifest.settings.map((setting) => {
          const saved = app.saved.includes(setting.key);
          const missing = app.missing.includes(setting.key);
          return (
            <Field key={setting.key} invalid={missing && !values[setting.key]}>
              <div className={styles.settingHead}>
                <Field.Label optional={setting.optional}>{setting.label}</Field.Label>
                {setting.link && /^https:\/\//i.test(setting.link) && (
                  <Button asChild size="sm" variant="ghost" trailingIcon={<ExternalLink />}>
                    <a
                      href={setting.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Get ${setting.label} (opens in a new tab)`}
                    >
                      Get it
                    </a>
                  </Button>
                )}
              </div>
              {setting.secret ? (
                <PasswordInput
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={saved ? 'Saved. Type a new one to replace it' : undefined}
                  value={values[setting.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [setting.key]: e.target.value })}
                  leading={<KeyRound />}
                  data-1p-ignore=""
                  data-lpignore="true"
                  data-bwignore=""
                  maxLength={4096}
                />
              ) : (
                <Input
                  autoComplete="off"
                  value={values[setting.key] ?? app.values[setting.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [setting.key]: e.target.value })}
                  maxLength={4096}
                />
              )}
              {setting.help && <Field.Description>{setting.help}</Field.Description>}
            </Field>
          );
        })}
        {error && (
          <Callout tone="danger" live="polite">
            {error}
          </Callout>
        )}
        <div>
          <Button type="submit" loading={busy} disabled={!changed.length}>
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
