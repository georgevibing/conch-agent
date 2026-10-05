import { toolTitle, type AppCallResult, type ConchAppTool } from '@conch/protocol';
import {
  AlertDialog,
  AppIcon,
  Button,
  EmptyState,
  Heading,
  IconButton,
  SealedFrame,
  Skeleton,
  Stack,
  Text,
  useNacreTheme,
  type AppIconLook,
} from '@conch/nacre';
import { AppWindow, ArrowLeft, PencilLine, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';
import { conchAppsApi, pageFrameUrl, type PageOwner } from './api';
import styles from './ConchApps.module.css';
import { useConchApp } from './queries';
import { appLook, conchAppPath } from './words';
import { askToOpen } from '../artifacts/openLink';

/** "Count one more" → "count one more": a tool's title inside a sentence. */
export const inSentence = (title: string) =>
  /^[A-Z][a-z]/.test(title) ? `${title.charAt(0).toLowerCase()}${title.slice(1)}` : title;

/** One value a call sends, short enough to read at a glance. */
function shown(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

interface Asking {
  appName: string;
  title: string;
  input: Record<string, unknown>;
  answer: (yes: boolean) => void;
}

/**
 * A page's bridge to its own app's tools (ADR 0061). A read goes by itself;
 * so does a change the person made by pressing something in the page
 * (`activated`, which `SealedFrame` reads as the message arrives). Any other
 * change asks first, in a small confirm that names the app, the tool and
 * what it sends, and goes only on **Allow**.
 */
export function usePageBridge(
  owner: PageOwner,
  appName: string,
  tools: readonly Pick<ConchAppTool, 'name' | 'title'>[],
) {
  const [asking, setAsking] = useState<Asking>();
  const latest = useRef({ owner, appName, tools });
  useEffect(() => {
    latest.current = { owner, appName, tools };
  }, [owner, appName, tools]);

  const ask = (title: string, input: Record<string, unknown>) =>
    new Promise<boolean>((resolve) => {
      setAsking({
        appName: latest.current.appName,
        title,
        input,
        answer: (yes) => {
          setAsking(undefined);
          resolve(yes);
        },
      });
    });

  const onCall = async (
    tool: string,
    input: Record<string, unknown>,
    activated: boolean,
  ): Promise<AppCallResult> => {
    const { owner: who, tools: known } = latest.current;
    const first = await conchAppsApi.call(who, tool, input, activated);
    if (first.ok || first.reason !== 'confirm' || activated) return first;
    const found = known.find((t) => t.name === tool);
    const yes = await ask(found ? toolTitle(found) : toolTitle({ name: tool, title: '' }), input);
    if (!yes) return { ok: false, reason: 'off', message: 'You said no, so nothing changed.' };
    return conchAppsApi.call(who, tool, input, true);
  };

  const entries = asking ? Object.entries(asking.input) : [];
  const confirm = (
    <AlertDialog.Root
      open={Boolean(asking)}
      onOpenChange={(open) => !open && asking?.answer(false)}
    >
      <AlertDialog.Content tone="accent" icon={<PencilLine />}>
        <AlertDialog.Header>
          <AlertDialog.Title>
            Let {asking?.appName} {asking ? inSentence(asking.title) : ''}?
          </AlertDialog.Title>
          <AlertDialog.Description>
            Its page asked for this while you weren’t pressing anything in it.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <Stack gap={1} className={styles.sends}>
          <Text size="xs" tone="subtle" weight="medium">
            {entries.length ? 'It sends' : 'It sends nothing else'}
          </Text>
          {entries.map(([key, value]) => (
            <Text key={key} size="sm">
              <Text as="span" tone="muted">
                {key}:
              </Text>{' '}
              {shown(value)}
            </Text>
          ))}
        </Stack>
        <AlertDialog.Footer>
          <AlertDialog.Cancel onClick={() => asking?.answer(false)}>Not now</AlertDialog.Cancel>
          <AlertDialog.Action tone="accent" onClick={() => asking?.answer(true)}>
            Allow
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
  return { onCall, confirm };
}

/** The page itself: sealed, in the person's theme and accent, talking only to its own tools. */
export function AppPageFrame({
  owner,
  pageId,
  title,
  appName,
  tools,
  fill,
}: {
  owner: PageOwner;
  pageId: string;
  title: string;
  appName: string;
  tools: readonly Pick<ConchAppTool, 'name' | 'title'>[];
  fill?: boolean;
}) {
  const { resolvedMode, accent } = useNacreTheme();
  const { onCall, confirm } = usePageBridge(owner, appName, tools);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const changed = () => setRefresh((n) => n + 1);
    window.addEventListener('conch-app-query-refresh', changed);
    return () => window.removeEventListener('conch-app-query-refresh', changed);
  }, []);
  return (
    <>
      <SealedFrame
        src={pageFrameUrl(
          owner,
          pageId,
          resolvedMode === 'dark' ? 'dark' : 'light',
          typeof accent === 'string' ? accent : undefined,
        )}
        title={title}
        fill={fill}
        initialHeight={420}
        onOpenLink={askToOpen}
        onCall={onCall}
        refresh={refresh}
      />
      {confirm}
    </>
  );
}

/** `/apps/capp_<id>/<page>`: one of an app's pages, on a page of its own. */
export function AppPageView({ appId, pageId }: { appId: string; pageId: string }) {
  const navigate = useNavigate();
  const { data: app, isPending, isError } = useConchApp(appId);
  const page = app?.manifest.pages.find((p) => p.id === pageId);
  if (isPending) return <Skeleton className={styles.pageLoading} />;
  if (isError || !app || !page)
    return (
      <EmptyState
        icon={<AppWindow />}
        title="This page isn’t here any more"
        description={
          app
            ? `${app.manifest.name} doesn’t have it now. Its other pages are on its page in Apps.`
            : 'Its app may have been removed on another device.'
        }
        actions={
          <Button onClick={() => void navigate(app ? conchAppPath(app.id) : '/apps')}>
            {app ? `Open ${app.manifest.name}` : 'See all apps'}
          </Button>
        }
      />
    );
  const titled =
    app.manifest.pages.length > 1 ? `${app.manifest.name} — ${page.title}` : page.title;
  return (
    <div className={styles.pageView}>
      <header className={styles.pageBar}>
        {/* Back to the app's page in Apps, where its switches and settings are. */}
        <IconButton
          label={`Back to ${app.manifest.name}`}
          variant="ghost"
          size="sm"
          onClick={() => void navigate(conchAppPath(app.id))}
        >
          <ArrowLeft />
        </IconButton>
        <PageTitle icon={appLook(app)} title={titled} />
      </header>
      <AppPageFrame
        key={`${app.id}:${app.hash}:${page.id}`}
        owner={{ appId: app.id }}
        pageId={page.id}
        title={titled}
        appName={app.manifest.name}
        tools={app.tools}
        fill
      />
    </div>
  );
}

function PageTitle({ icon, title }: { icon: AppIconLook; title: string }) {
  return (
    <div className={styles.pageTitle}>
      <AppIcon {...icon} size="xs" />
      <Heading level={1} size="sm" weight="medium" truncate>
        {title}
      </Heading>
    </div>
  );
}

/**
 * An app's page beside the chat (ADR 0061): a draft's while it's being made
 * (the newest card for it says what it is), or an app you have.
 */
export function AppPagePanel({ conversationId }: { conversationId: string }) {
  const open = useUi((s) =>
    s.appPageOpen?.conversationId === conversationId ? s.appPageOpen : null,
  );
  const close = useUi((s) => s.closeAppPage);
  const navigate = useNavigate();
  const asked = open && 'draftId' in open.owner ? open.owner.draftId : undefined;
  const offer = useLiveStore((s) => {
    if (!asked) return undefined;
    const item = s.views[conversationId]?.items.findLast(
      (i) => i.kind === 'conch-app-offer' && i.offer.draftId === asked,
    );
    return item?.kind === 'conch-app-offer' ? item.offer : undefined;
  });
  // Once its card is pressed, the draft is the app: the page shows the app's own notes.
  const added = offer?.state === 'added' || offer?.state === 'updated';
  const appId =
    open && 'appId' in open.owner ? open.owner.appId : added ? offer?.manifest.id : undefined;
  const draftId = added ? undefined : asked;
  const owner: PageOwner | undefined = appId ? { appId } : draftId ? { draftId } : undefined;
  const { data: app } = useConchApp(appId);
  if (!open || !owner) return null;
  const manifest = app?.manifest ?? offer?.manifest;
  const tools = app?.tools ?? offer?.tools ?? [];
  const page = manifest?.pages.find((p) => p.id === open.pageId);
  if (!manifest || !page)
    return (
      <div className={styles.panel}>
        <div className={styles.panelBar}>
          <span />
          <IconButton label="Close" variant="ghost" size="sm" onClick={close}>
            <X />
          </IconButton>
        </div>
        <EmptyState
          size="sm"
          icon={<AppWindow />}
          title="This page isn’t here any more"
          description="Ask for the app again in the chat."
        />
      </div>
    );
  const title = manifest.pages.length > 1 ? `${manifest.name} — ${page.title}` : page.title;
  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.panelBar}>
        <PageTitle
          icon={app ? appLook(app) : offer ? appLook(offer) : manifest.icon}
          title={
            draftId
              ? offer?.action === 'update'
                ? `${title} ${manifest.version} · not updated yet`
                : `${title} · not added yet`
              : title
          }
        />
        {appId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigate(`${conchAppPath(appId)}/${encodeURIComponent(page.id)}`)}
          >
            Open on its own
          </Button>
        )}
        <IconButton label="Close" variant="ghost" size="sm" onClick={close}>
          <X />
        </IconButton>
      </div>
      <AppPageFrame
        key={`${JSON.stringify(owner)}:${page.id}:${app?.hash ?? offer?.hash ?? ''}`}
        owner={owner}
        pageId={page.id}
        title={title}
        appName={manifest.name}
        tools={tools}
        fill
      />
    </section>
  );
}
