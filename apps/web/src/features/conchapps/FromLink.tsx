import type { ConchAppPreview } from '@conch/protocol';
import { AppPreview, Button, Field, Input, Text, type AppPreviewApp } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { FileArchive, Link2 } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import { canPickHere } from '../../lib/pick';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { conchAppsApi, readAsBase64 } from './api';
import styles from './ConchApps.module.css';
import { putConchApp, useConchApps } from './queries';
import { appWords, conchAppPath } from './words';

/** What the person gave: a link they typed or pasted, or a file. */
export type LinkInput = { link: string } | { file: File };

type Looking =
  | { state: 'idle' }
  | { state: 'loading'; looking: string }
  | { state: 'ready'; looking: string; preview: ConchAppPreview }
  | { state: 'failed'; looking: string; message: string; again: () => void };

/** "https://github.com/ada/plant-diary" → "github.com/ada/plant-diary": where it's looking, in a few words. */
export function lookingAt(link: string): string {
  return (
    link
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .slice(0, 80) || 'that link'
  );
}

/** Looks like something to look at: an address, or `owner/repo`. */
const looksLikeLink = (text: string) =>
  /^(https?:\/\/\S+|github\.com\/\S+|[\w.-]+\/[\w.-]+)$/i.test(text.trim());

const isConchFile = (file: File) => /\.conchapp$/i.test(file.name);

/**
 * **From a link** (ADR 0061): a GitHub address or a `.conchapp` link — or
 * the file itself — and what it holds, laid out like the card in a chat,
 * with **Add to my apps**. Settings are typed right into the preview. On the
 * computer Conch runs on, **Choose a file…** is the system's own Open dialog;
 * anywhere else it's the browser's.
 */
export function FromLink({
  start,
  onAdded,
}: {
  /** Something to look at straight away: a dropped file, a community app's address. */
  start?: LinkInput;
  /** An app was added: the dialog closes. */
  onAdded: () => void;
}) {
  const [link, setLink] = useState(start && 'link' in start ? start.link : '');
  const [looking, setLooking] = useState<Looking>({ state: 'idle' });
  const [busy, setBusy] = useState<string>();
  const [added, setAdded] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { data: mine } = useConchApps();
  const asked = useRef(0);

  const look = async (what: string, get: () => Promise<ConchAppPreview | undefined>) => {
    const n = ++asked.current;
    setAdded([]);
    setLooking({ state: 'loading', looking: what });
    try {
      const preview = await get();
      if (n !== asked.current) return;
      setLooking(preview ? { state: 'ready', looking: what, preview } : { state: 'idle' });
    } catch (error) {
      if (n !== asked.current) return;
      setLooking({
        state: 'failed',
        looking: what,
        message: errorText(error, 'Conch couldn’t read it. Check the link, then try again.'),
        again: () => void look(what, get),
      });
    }
  };

  const lookAtLink = (text = link) => {
    const value = text.trim();
    if (!value) return;
    void look(lookingAt(value), () => conchAppsApi.preview({ link: value }));
  };

  const lookAtFile = (file: File) => {
    setLink('');
    if (!isConchFile(file)) {
      setLooking({
        state: 'failed',
        looking: file.name,
        message: 'That isn’t a Conch app. Choose a file that ends in .conchapp.',
        again: () => fileInput.current?.click(),
      });
      return;
    }
    void look(file.name, async () =>
      conchAppsApi.preview({ file: await readAsBase64(file), name: file.name }),
    );
  };

  // A dropped file, or an address from the community, is looked at at once.
  const started = useRef(false);
  const begin = useEffectEvent(() => {
    if (started.current || !start) return;
    started.current = true;
    if ('file' in start) lookAtFile(start.file);
    else lookAtLink(start.link);
  });
  useEffect(() => {
    // After the first paint, so the tab is drawn before it starts looking.
    const timer = setTimeout(() => begin(), 0);
    return () => clearTimeout(timer);
  }, []);

  const choose = async () => {
    if (!canPickHere()) return fileInput.current?.click();
    // The system's window is where it happens now; what it holds shows once it's chosen.
    const n = ++asked.current;
    setPicking(true);
    setLink('');
    setLooking({ state: 'idle' });
    try {
      const preview = await conchAppsApi.pick();
      if (n !== asked.current || !preview) return;
      setAdded([]);
      const name = preview.source.kind === 'file' ? preview.source.name : 'your file';
      setLooking({ state: 'ready', looking: name, preview });
    } catch (error) {
      // Not this computer after all (a proxy): the browser's own chooser.
      if (error instanceof ApiError && error.code === 'not-here') return fileInput.current?.click();
      if (n !== asked.current) return;
      setLooking({
        state: 'failed',
        looking: 'your file',
        message: errorText(error, 'Conch couldn’t read that file. Try another.'),
        again: () => void choose(),
      });
    } finally {
      setPicking(false);
    }
  };

  const add = async (appId: string, settings: Record<string, string>) => {
    if (looking.state !== 'ready') return;
    const found = looking.preview.apps.find((a) => a.manifest.id === appId);
    if (!found) return;
    setBusy(appId);
    try {
      await guard(async () => {
        const app = await conchAppsApi.install({
          packageId: looking.preview.packageId,
          appId,
          hash: found.hash,
          settings,
        });
        putConchApp(client, app);
        setAdded((list) => [...list, appId]);
        // One app: straight to its page. From a collection, stay to add another.
        if (looking.preview.apps.length === 1) {
          onAdded();
          void navigate(conchAppPath(app.id));
        }
      });
    } catch (error) {
      setLooking({
        state: 'failed',
        looking: looking.looking,
        message: errorText(error, 'It wasn’t added. Nothing changed.'),
        again: () => setLooking(looking),
      });
    } finally {
      setBusy(undefined);
    }
  };

  const apps: AppPreviewApp[] =
    looking.state === 'ready'
      ? looking.preview.apps.map((found) => {
          const have = mine?.find((a) => a.id === found.manifest.id);
          return {
            manifest: found.manifest,
            tools: found.tools,
            signature: found.signature,
            problems: found.problems,
            ...(found.warnings && { warnings: found.warnings }),
            ...(found.installed && { installed: found.installed }),
            ...(found.changes && { changes: found.changes }),
            ...(have && !found.changes?.otherMaker && { saved: have.saved }),
            words: appWords({
              manifest: found.manifest,
              tools: found.tools,
              source: looking.preview.source,
              signature: found.signature,
              ...(found.changes && { changes: found.changes }),
            }),
          };
        })
      : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    lookAtLink();
  };

  return (
    <div className={styles.fromLink}>
      <form onSubmit={submit} className={styles.linkForm} noValidate>
        <Field>
          <Field.Label>Where it is</Field.Label>
          <div className={styles.linkRow}>
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              leading={<Link2 />}
              placeholder="https://github.com/ada/plant-diary"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text').trim();
                if (!looksLikeLink(pasted)) return;
                e.preventDefault();
                setLink(pasted);
                lookAtLink(pasted);
              }}
              className={styles.linkInput}
            />
            <Button type="submit" variant="surface" disabled={!link.trim()}>
              Look
            </Button>
          </div>
          <Field.Description>
            A GitHub address, or a link to a <code>.conchapp</code> file.
          </Field.Description>
        </Field>
      </form>
      <div className={styles.orFile}>
        <Text as="span" size="sm" tone="muted">
          Or a file someone sent you
        </Text>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<FileArchive />}
          onClick={() => void choose()}
          loading={picking}
        >
          Choose a file…
        </Button>
        {picking && (
          <Text as="span" size="sm" tone="subtle" role="status">
            Choose it in the window that opened.
          </Text>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".conchapp,application/gzip"
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) lookAtFile(file);
          }}
        />
      </div>
      {looking.state !== 'idle' && (
        <AppPreview
          state={looking.state}
          looking={looking.looking}
          apps={apps}
          message={looking.state === 'failed' ? looking.message : undefined}
          busy={busy}
          added={added}
          onAdd={(appId, settings) => void add(appId, settings)}
          onRetry={looking.state === 'failed' ? looking.again : undefined}
        />
      )}
      {dialog}
    </div>
  );
}
