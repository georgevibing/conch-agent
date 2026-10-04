import type { BrowserBackendKind, BrowserStatus, SetBrowserBackendBody } from '@conch/protocol';
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  PasswordInput,
  RadioGroup,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { AppWindowMac, Cloud, Globe, Plug } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '../../api/client';
import { browserApi } from './api';
import { browserKeys } from './queries';

const CHOICES: {
  value: BrowserBackendKind;
  label: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    value: 'local',
    label: 'Its own browser',
    description: 'Separate from yours, on this computer. Your own browser is never touched.',
    icon: <Globe />,
  },
  {
    value: 'chrome',
    label: 'Your Chrome',
    description:
      'Where you’re already signed in. It opens tabs of its own there, marked, and asks on every site.',
    icon: <AppWindowMac />,
  },
  {
    value: 'browserbase',
    label: 'Browserbase',
    description: 'A browser in the cloud. Pages it opens are seen by Browserbase.',
    icon: <Cloud />,
  },
  {
    value: 'steel',
    label: 'Steel',
    description: 'A browser in the cloud. Pages it opens are seen by Steel.',
    icon: <Cloud />,
  },
  {
    value: 'cdp',
    label: 'Another browser',
    description: 'Any browser you run elsewhere, at its DevTools address.',
    icon: <Plug />,
  },
];

/**
 * Settings › Browser › Where it runs (ADR 0080): its own browser, your
 * signed-in Chrome, or one in the cloud. Choosing anything but its own needs a
 * recent sign-in (`guard`); keys go in once and never come back.
 */
export function WhereItRuns({
  status,
  name,
  guard,
}: {
  status: BrowserStatus;
  name: string;
  guard: (task: () => Promise<void>) => Promise<boolean>;
}) {
  const client = useQueryClient();
  const backend = status.backend ?? {
    chosen: 'local' as const,
    using: 'local' as const,
    saved: { browserbase: false, steel: false },
  };
  const [choice, setChoice] = useState<BrowserBackendKind>(backend.chosen);
  const [key, setKey] = useState('');
  const [project, setProject] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Chosen somewhere else (another device, the checkup's fix): show that.
  const [shown, setShown] = useState(backend.chosen);
  if (shown !== backend.chosen) {
    setShown(backend.chosen);
    setChoice(backend.chosen);
  }
  const pick = (value: BrowserBackendKind) => {
    setChoice(value);
    setKey('');
    setError(undefined);
  };

  // Waiting for Chrome to allow remote debugging: look again every few seconds.
  const watchChrome = choice === 'chrome' && backend.chrome !== 'ready';
  useEffect(() => {
    if (!watchChrome) return;
    const timer = setInterval(
      () => void client.invalidateQueries({ queryKey: browserKeys.status }),
      3_000,
    );
    return () => clearInterval(timer);
  }, [watchChrome, client]);

  const apply = async (body: SetBrowserBackendBody) => {
    setBusy(true);
    setError(undefined);
    try {
      const done = await guard(async () => {
        client.setQueryData(browserKeys.status, await browserApi.setBackend(body));
      });
      if (done) {
        setKey('');
        toast.success(
          body.kind === 'local'
            ? `${name} uses its own browser again.`
            : `${name} will browse in ${CHOICES.find((c) => c.value === body.kind)?.label}.`,
        );
      }
    } catch (failure) {
      setError(
        failure instanceof ApiError || failure instanceof Error
          ? failure.message
          : 'That didn’t work.',
      );
    } finally {
      setBusy(false);
    }
  };

  const forget = async (kind: 'browserbase' | 'steel' | 'cdp') => {
    client.setQueryData(browserKeys.status, await browserApi.forgetBackend(kind));
  };

  const current = choice === backend.chosen;
  const saved =
    choice === 'browserbase'
      ? backend.saved.browserbase
      : choice === 'steel'
        ? backend.saved.steel
        : choice === 'cdp'
          ? Boolean(backend.saved.cdp)
          : false;
  const use = (
    <Button
      loading={busy}
      disabled={
        (choice === 'browserbase' || choice === 'steel') && !saved && key.trim().length < 8
          ? true
          : choice === 'cdp' && !saved && !address.trim()
      }
      onClick={() =>
        void apply({
          kind: choice,
          ...(key.trim() && { key: key.trim() }),
          ...(choice === 'browserbase' && project.trim() && { project: project.trim() }),
          ...(choice === 'cdp' && address.trim() && { address: address.trim() }),
        })
      }
    >
      {choice === 'local'
        ? 'Use its own browser'
        : choice === 'chrome'
          ? 'Use my Chrome'
          : `Use ${CHOICES.find((c) => c.value === choice)?.label}`}
    </Button>
  );

  return (
    <Stack gap={4}>
      <RadioGroup
        variant="card"
        aria-label="Where the browser runs"
        value={choice}
        onValueChange={(value) => pick(value as BrowserBackendKind)}
      >
        {CHOICES.map((c) => (
          <RadioGroup.Item
            key={c.value}
            value={c.value}
            icon={c.icon}
            description={c.description}
            label={
              <span>
                {c.label}{' '}
                {c.value === backend.chosen && (
                  <Badge size="sm" tone={backend.fellBack ? 'warning' : 'success'} variant="soft">
                    {backend.fellBack ? 'Not reached' : 'In use'}
                  </Badge>
                )}
              </span>
            }
          />
        ))}
      </RadioGroup>

      {current && backend.fellBack && (
        <Callout tone="warning" title={`${name} is using its own browser for now`}>
          {backend.fellBack}
        </Callout>
      )}

      {choice === 'chrome' && (
        <Stack gap={3}>
          <Text size="sm">
            {name} opens tabs of its own in your Chrome, marked “Conch is using this tab”. It never
            reads your other tabs, asks before acting on each site in every chat, and still never
            types your passwords. A page it reads there could try to trick it, so use this only when
            you need your sign-ins.
          </Text>
          <ol>
            <li>
              <Text size="sm">Open Chrome (version 144 or newer).</Text>
            </li>
            <li>
              <Text size="sm">
                Go to <code>chrome://inspect/#remote-debugging</code> and turn on{' '}
                <strong>Allow remote debugging</strong>.
              </Text>
            </li>
            <li>
              <Text size="sm">
                Press <strong>Use my Chrome</strong>. The first time {name} connects, Chrome asks
                you to allow it.
              </Text>
            </li>
          </ol>
          <Text size="sm" tone="subtle" role="status">
            {backend.chrome === 'ready'
              ? 'Chrome is open and lets Conch ask.'
              : backend.chrome === 'missing'
                ? 'Conch can’t find Chrome on this computer.'
                : 'Waiting for Chrome: open it and allow remote debugging.'}
          </Text>
        </Stack>
      )}

      {(choice === 'browserbase' || choice === 'steel') && (
        <Stack gap={3}>
          <Field>
            <Field.Label>API key</Field.Label>
            <PasswordInput
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={saved ? 'Saved. Paste a new one to replace it' : 'Paste your key'}
              autoComplete="off"
            />
            <Field.Description>
              From your {choice === 'browserbase' ? 'Browserbase' : 'Steel'} dashboard. Kept sealed
              on this computer, and never shown again.
            </Field.Description>
          </Field>
          {choice === 'browserbase' && (
            <Field>
              <Field.Label optional>Project ID</Field.Label>
              <Input value={project} onChange={(event) => setProject(event.target.value)} />
            </Field>
          )}
        </Stack>
      )}

      {choice === 'cdp' && (
        <Field>
          <Field.Label>Address</Field.Label>
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={backend.saved.cdp ? `Saved: ${backend.saved.cdp}` : 'wss://…'}
            spellCheck={false}
            autoComplete="off"
          />
          <Field.Description>
            The browser’s DevTools address (ws://, wss:// or http://). Kept sealed, like a key.
          </Field.Description>
        </Field>
      )}

      {error && (
        <Callout tone="danger" live="assertive">
          {error}
        </Callout>
      )}

      <Stack direction="row" gap={2}>
        {(!current || backend.fellBack || choice === 'chrome') && use}
        {saved && choice !== 'local' && choice !== 'chrome' && (
          <Button
            variant="ghost"
            tone="danger"
            onClick={() => void forget(choice as 'browserbase' | 'steel' | 'cdp')}
          >
            Forget the {choice === 'cdp' ? 'address' : 'key'}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
