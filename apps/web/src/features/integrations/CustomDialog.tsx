import {
  AppMaker,
  Button,
  Callout,
  Dialog,
  Field,
  IconButton,
  Input,
  PasswordInput,
  Stack,
  Tabs,
  Text,
} from '@conch/nacre';
import { Globe, KeyRound, Link2, Plus, Sparkles, SquareTerminal, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useVerify } from '../auth/useVerify';
import { useAuth } from '../auth/useAuth';
import { FromLink, type LinkInput } from '../conchapps/FromLink';
import { useStartChat } from '../conchapps/useStartChat';
import { integrationsApi } from './api';
import styles from './Integrations.module.css';
import { errorText, useAssistantName } from './queries';
import { useSignIn } from './useSignIn';

/** `npx -y pkg "My Folder"` → ['npx', '-y', 'pkg', 'My Folder'] (no shell is ever involved). */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
      else current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started || current) out.push(current);
      current = '';
      started = false;
    } else {
      current += c;
    }
  }
  if (started || current) out.push(current);
  return out;
}

/** The dialog's tabs: make one, add one someone shared, or connect an MCP app. */
export type AddTab = 'describe' | 'link' | 'http' | 'stdio';

/** What the dialog opens with: words to build from, or a link or a file to look at. */
export interface AddStart {
  describe?: string;
  link?: LinkInput;
}

const LEADS: Record<AddTab, string> = {
  describe: 'Say what you want in your own words, and Conch makes it into an app.',
  link: 'Add an app someone shared: from GitHub, a link, or the file they sent you.',
  http: 'Connect any app that speaks MCP, the open standard AI assistants use for tools. Its maker’s instructions tell you what to put here.',
  stdio:
    'Connect any app that speaks MCP, the open standard AI assistants use for tools. Its maker’s instructions tell you what to put here.',
};

/**
 * **Add your own** (ADR 0061, ADR 0009). It opens on **Describe it**: say
 * what it should do and **Build it** starts a chat that makes it. **From a
 * link** adds an app someone shared. Anything else that speaks MCP is **By
 * address** (Conch works out whether it needs a sign-in) or **Run a
 * program**; programs run as you, so they ask you to confirm it's you and
 * start out asking before every action.
 */
export function CustomDialog({
  open,
  onOpenChange,
  tab = 'describe',
  start,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where it opens: Describe it, unless something else was asked for. */
  tab?: AddTab;
  start?: AddStart;
}) {
  const [mode, setMode] = useState<AddTab>(tab);
  const [wish, setWish] = useState(start?.describe ?? '');
  // Each time it opens, it opens where it was asked to, with what it was given.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setMode(tab);
      setWish(start?.describe ?? '');
    }
  }
  const startChat = useStartChat();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [command, setCommand] = useState('');
  const [env, setEnv] = useState<{ key: string; value: string }[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const assistant = useAssistantName();
  const signIn = useSignIn();
  const navigate = useNavigate();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');

  const reset = () => {
    setName('');
    setUrl('');
    setToken('');
    setCommand('');
    setEnv([]);
    setError(undefined);
  };

  const finish = (id: string) => {
    onOpenChange(false);
    reset();
    void navigate(`/apps/${id}`);
  };

  /** **Build it**: a new chat that makes it, opened at once. */
  const build = (text: string) => {
    onOpenChange(false);
    reset();
    startChat(`Make me an app: ${text}`);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode !== 'http' && mode !== 'stdio') return;
    setError(undefined);
    setBusy(true);
    try {
      if (mode === 'http') {
        const result = await signIn((display) =>
          integrationsApi.create(
            {
              custom: {
                type: 'http',
                name: name.trim() || hostOf(url),
                url: url.trim(),
                token: token.trim() || undefined,
              },
            },
            display,
          ),
        );
        if (result) finish(result.integration.id);
        return;
      }
      const [program, ...args] = splitCommand(command.trim());
      if (!program) {
        setError('Type the command that starts it.');
        return;
      }
      await guard(async () => {
        const result = await integrationsApi.create({
          custom: {
            type: 'stdio',
            name: name.trim() || program,
            command: program,
            args,
            env: Object.fromEntries(
              env.filter((e) => e.key.trim()).map((e) => [e.key.trim(), e.value]),
            ),
          },
        });
        finish(result.integration.id);
      });
    } catch (e) {
      setError(errorText(e, 'Couldn’t add it.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <Dialog.Content
        size="lg"
        onOpenAutoFocus={(event) => {
          // Straight into the box it opened on: what it should do, or where it is.
          const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
          const box =
            mode === 'describe'
              ? root?.querySelector<HTMLElement>('textarea')
              : mode === 'link'
                ? root?.querySelector<HTMLElement>('input[type="url"]')
                : undefined;
          if (!box) return;
          event.preventDefault();
          box.focus();
        }}
      >
        <Dialog.Header>
          <Dialog.Title>Add your own</Dialog.Title>
          <Dialog.Description>{LEADS[mode]}</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Tabs
            size="sm"
            value={mode}
            onValueChange={(v) => {
              setMode(v as AddTab);
              setError(undefined);
            }}
          >
            <Tabs.List aria-label="How to add it">
              <Tabs.Trigger value="describe" icon={<Sparkles />}>
                Describe it
              </Tabs.Trigger>
              <Tabs.Trigger value="link" icon={<Link2 />}>
                From a link
              </Tabs.Trigger>
              <Tabs.Trigger value="http" icon={<Globe />}>
                By address
              </Tabs.Trigger>
              <Tabs.Trigger value="stdio" icon={<SquareTerminal />}>
                Run a program
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="describe">
              <AppMaker value={wish} onValueChange={setWish} onBuild={build} />
            </Tabs.Content>
            <Tabs.Content value="link">
              <FromLink
                start={start?.link}
                onAdded={() => {
                  onOpenChange(false);
                  reset();
                }}
              />
            </Tabs.Content>
            <Tabs.Content value="http">
              <form id="custom-http" onSubmit={submit} className={styles.tokenForm} noValidate>
                <Field required invalid={Boolean(error)}>
                  <Field.Label>Address</Field.Label>
                  <Input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://mcp.example.com/mcp"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  {error ? (
                    <Field.Error>{error}</Field.Error>
                  ) : (
                    <Field.Description>
                      If it needs you to sign in, Conch opens its sign-in page next.
                    </Field.Description>
                  )}
                </Field>
                <Field>
                  <Field.Label>Name</Field.Label>
                  <Input
                    placeholder={url ? hostOf(url) : 'Team wiki'}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field>
                  <Field.Label>Access token (optional)</Field.Label>
                  <PasswordInput
                    autoComplete="off"
                    placeholder="Only if its instructions give you one"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    leading={<KeyRound />}
                  />
                </Field>
              </form>
            </Tabs.Content>
            <Tabs.Content value="stdio">
              <form id="custom-stdio" onSubmit={submit} className={styles.tokenForm} noValidate>
                <Callout tone="warning" title="This runs a program on your computer">
                  It runs as you and can do anything you can. Only add programs from people you
                  trust. {assistant} will ask before using each of its tools until you decide
                  otherwise.
                </Callout>
                <Field required invalid={Boolean(error)}>
                  <Field.Label>Command</Field.Label>
                  <Input
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="npx -y @modelcontextprotocol/server-everything"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    className={styles.mono}
                  />
                  {error ? (
                    <Field.Error>{error}</Field.Error>
                  ) : (
                    <Field.Description>Runs directly, not through a shell.</Field.Description>
                  )}
                </Field>
                <Field>
                  <Field.Label>Name</Field.Label>
                  <Input
                    placeholder="My tools"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Stack gap={2}>
                  <Text size="sm" weight="medium">
                    Settings it needs
                  </Text>
                  {env.map((row, i) => (
                    <div key={i} className={styles.envRow}>
                      <Input
                        aria-label="Name"
                        placeholder="API_KEY"
                        className={styles.mono}
                        value={row.key}
                        onChange={(e) =>
                          setEnv(env.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                        }
                      />
                      <PasswordInput
                        aria-label="Value"
                        placeholder="Value"
                        autoComplete="off"
                        value={row.value}
                        onChange={(e) =>
                          setEnv(env.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                        }
                      />
                      <IconButton
                        label="Remove"
                        variant="ghost"
                        onClick={() => setEnv(env.filter((_, j) => j !== i))}
                      >
                        <X />
                      </IconButton>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<Plus />}
                    onClick={() => setEnv([...env, { key: '', value: '' }])}
                    className={styles.addEnv}
                  >
                    Add a setting
                  </Button>
                  <Text size="xs" tone="subtle">
                    Values are kept like passwords: on this computer only, never shown again.
                  </Text>
                </Stack>
              </form>
            </Tabs.Content>
          </Tabs>
        </Dialog.Body>
        {(mode === 'http' || mode === 'stdio') && (
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button
              type="submit"
              form={`custom-${mode}`}
              loading={busy}
              disabled={mode === 'http' ? !url.trim() : !command.trim()}
            >
              Add
            </Button>
          </Dialog.Footer>
        )}
        {dialog}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|mcp|api)\./, '');
  } catch {
    return '';
  }
}
