import {
  DASHBOARD_DESTINATIONS,
  destinationOf,
  destinationSubject,
  readDashboardPaste,
  type DashboardDestinationId,
  type TelemetrySignal,
  type TelemetryStatus,
  type TelemetryUpdate,
} from '@conch/protocol';
import {
  Button,
  Callout,
  Checkbox,
  CodeBlock,
  DashboardPicker,
  Field,
  GrafanaCard,
  Input,
  MetricPreview,
  PasswordInput,
  PasteWell,
  ScrapeBeat,
  SecretReveal,
  SegmentedControl,
  Select,
  SendTest,
  SettingsAdvanced,
  Skeleton,
  Stack,
  Switch,
  Text,
  toast,
  TurnWaterfall,
  type FoundPiece,
  type SendTestState,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { dashboardsApi, dashboardsKeys, useDashboardPreview, useDashboards } from './api';

const fail = (error: unknown) => toast.error((error as Error).message);

const SIGNAL_WORDS: Record<TelemetrySignal, { label: string; description: string }> = {
  metrics: { label: 'Numbers', description: 'Turns, tokens, spending, tools and this computer.' },
  traces: {
    label: 'Each turn as a trace',
    description: 'The agent, the model at work, each tool call.',
  },
  logs: {
    label: 'Events',
    description: 'A short line when a turn, a tool call or a routine ends.',
  },
};

const INTERVALS = [
  { value: '15', label: 'Every 15 seconds' },
  { value: '30', label: 'Every 30 seconds' },
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
];

const ago = (at: number | undefined) => {
  if (!at) return undefined;
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 5
    ? 'just now'
    : s < 60
      ? `${s} s ago`
      : s < 3600
        ? `${Math.round(s / 60)} min ago`
        : `${Math.round(s / 3600)} h ago`;
};

const tiles = DASHBOARD_DESTINATIONS.map((d) => ({
  id: d.id,
  name: d.name,
  tagline: d.tagline,
  color: d.color,
  ...(d.brand && { brand: d.brand }),
}));

/**
 * Settings → Dashboards (ADR 0121): Conch's numbers, and the shape of each
 * turn, on a dashboard of your own. Choose the service, paste what it shows
 * you, and send a test; or let Prometheus read `/metrics`. What leaves is on
 * the page, as it leaves.
 */
export function DashboardsTab() {
  const status = useDashboards();
  const access = useQuery({ queryKey: keys.access, queryFn: api.access, staleTime: 10_000 });
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  if (!status.data)
    return (
      <Stack gap={6} aria-busy="true">
        <Skeleton shape="text" width="12rem" />
        <Skeleton shape="block" height="12rem" />
      </Stack>
    );
  return (
    <Stack gap={8}>
      <Sending status={status.data} guard={guard} />
      <Prometheus status={status.data} guard={guard} />
      <Grafana />
      <WhatLeaves />
      <SettingsAdvanced>
        <Advanced status={status.data} guard={guard} />
      </SettingsAdvanced>
      {dialog}
    </Stack>
  );
}

type Guard = ReturnType<typeof useVerify>['guard'];

/** Save a change, confirming it's you first when it sends somewhere new. */
function useSave(guard: Guard) {
  const client = useQueryClient();
  return async (body: TelemetryUpdate): Promise<boolean> => {
    try {
      return await guard(async () => {
        client.setQueryData(dashboardsKeys.status, await dashboardsApi.update(body));
      });
    } catch (error) {
      fail(error);
      return false;
    }
  };
}

function Sending({ status, guard }: { status: TelemetryStatus; guard: Guard }) {
  const save = useSave(guard);
  const { otlp } = status.settings;
  const destination = destinationOf(otlp.destination);
  const [found, setFound] = useState<FoundPiece[]>([]);
  const [problem, setProblem] = useState<string>();
  const [test, setTest] = useState<{ state: SendTestState; message?: string; ms?: number }>({
    state: 'idle',
  });

  const choose = async (id: string) => {
    setFound([]);
    setProblem(undefined);
    setTest({ state: 'idle' });
    await save({ otlp: { destination: id as DashboardDestinationId } });
  };

  const paste = async (text: string) => {
    const read = readDashboardPaste(text, otlp.destination);
    const to = destinationOf(read.destination ?? otlp.destination);
    const pieces: FoundPiece[] = [
      ...(read.endpoint
        ? [{ label: 'Endpoint', value: read.endpoint.replace(/^https?:\/\//, '') }]
        : []),
      ...(read.region
        ? [
            {
              label: 'Region',
              value: to.regions?.find((r) => r.id === read.region)?.label ?? read.region,
            },
          ]
        : []),
      ...to.fields
        .filter((f) => read.fields[f.id])
        .map((f) => ({ label: f.label, value: read.fields[f.id] ?? '', secret: f.secret })),
    ];
    if (!pieces.length) {
      setFound([]);
      setProblem(`That didn’t read as anything ${to.name} gives. ${to.keyHelp}`);
      return;
    }
    setProblem(undefined);
    setFound(pieces);
    const saved = await save({
      otlp: {
        destination: to.id,
        ...(read.endpoint && { endpoint: read.endpoint }),
        ...(read.region && { region: read.region }),
      },
      ...(Object.keys(read.fields).length && { key: read.fields }),
    });
    if (saved && to.id !== otlp.destination)
      toast.success(`That’s ${to.name}’s. Switched to ${to.name}.`);
  };

  const runTest = async () => {
    setTest({ state: 'sending' });
    try {
      const result = await dashboardsApi.test();
      setTest({
        state: result.ok ? 'received' : 'failed',
        message: result.message,
        ...(result.ms !== undefined && { ms: result.ms }),
      });
    } catch (error) {
      setTest({ state: 'failed', message: (error as Error).message });
    }
  };

  const needsKey = destination.fields.some((f) => !f.optional);
  const keySaved = status.key.destination === destination.id && status.key.fields.length > 0;
  const sent = ago(status.otlp.lastSentAt);
  const serverProblem = otlp.on ? status.otlp.problem : undefined;

  return (
    <Section
      title="Send to a dashboard"
      description="Conch’s numbers, and the shape of each turn, for a dashboard of your own. Never the words of your chats."
    >
      <Stack gap={4}>
        <DashboardPicker
          destinations={tiles}
          value={otlp.destination}
          onValueChange={(id) => void choose(id)}
          {...(otlp.on && !serverProblem && { live: otlp.destination })}
        />
        {destination.regions && (
          <Field>
            <Field.Label>Region</Field.Label>
            <Select
              value={otlp.region ?? destination.regions[0]?.id ?? ''}
              onValueChange={(region) => void save({ otlp: { region } })}
              aria-label="Region"
            >
              {destination.regions.map((r) => (
                <Select.Item key={r.id} value={r.id}>
                  {r.label}
                </Select.Item>
              ))}
            </Select>
          </Field>
        )}
        {(destination.fields.length > 0 || destination.endpoint) && (
          <PasteWell
            label={
              destination.fields.length
                ? `Paste what ${destination.name} shows you`
                : 'Paste its address, or leave the usual one'
            }
            hint={
              <>
                {destination.keyHelp}{' '}
                {destination.keyUrl && (
                  <a href={destination.keyUrl} target="_blank" rel="noreferrer noopener">
                    How
                  </a>
                )}
              </>
            }
            onPaste={(text) => void paste(text)}
            found={found}
            {...(keySaved &&
              !found.length && {
                saved: `Your key is saved${status.key.hint ? ` (${status.key.hint})` : ''}. Paste another to change it.`,
              })}
            {...((problem ?? (serverProblem?.yours ? serverProblem.message : undefined)) && {
              problem: problem ?? serverProblem?.message,
            })}
          >
            {destination.endpoint && (
              <Field>
                <Field.Label>{destination.endpoint.label}</Field.Label>
                <Input
                  key={`${destination.id}-endpoint`}
                  defaultValue={otlp.endpoint ?? ''}
                  placeholder={destination.endpoint.placeholder}
                  onBlur={(e) => {
                    const endpoint = e.currentTarget.value.trim();
                    if (endpoint !== (otlp.endpoint ?? ''))
                      void save({ otlp: { endpoint: endpoint || null } });
                  }}
                />
              </Field>
            )}
            {destination.fields.map((f) => (
              <Field key={`${destination.id}-${f.id}`}>
                <Field.Label>{f.label}</Field.Label>
                {f.secret ? (
                  <PasswordInput
                    placeholder={keySaved ? 'Saved' : f.placeholder}
                    autoComplete="off"
                    onBlur={(e) => {
                      const value = e.currentTarget.value.trim();
                      if (value) void save({ key: { [f.id]: value } });
                    }}
                  />
                ) : (
                  <Input
                    placeholder={f.placeholder}
                    autoComplete="off"
                    onBlur={(e) => {
                      const value = e.currentTarget.value.trim();
                      if (value) void save({ key: { [f.id]: value } });
                    }}
                  />
                )}
              </Field>
            ))}
          </PasteWell>
        )}
        <Switch
          checked={otlp.on}
          disabled={needsKey && !keySaved && !otlp.on}
          onCheckedChange={(on) => void save({ otlp: { on } })}
          label={`Send to ${destinationSubject(destination, false)}`}
          description={
            otlp.on
              ? serverProblem
                ? serverProblem.message
                : sent
                  ? `Sent ${sent}. ${status.otlp.dropped ? `${status.otlp.dropped} never arrived.` : 'Everything arrived.'}`
                  : 'On. The first numbers go within a minute.'
              : needsKey && !keySaved
                ? 'Paste the key first.'
                : undefined
          }
        />
        {otlp.on && (
          <>
            <Stack gap={3} role="group" aria-label="What it sends">
              {destination.signals.map((signal) => (
                <Checkbox
                  key={signal}
                  checked={otlp.signals[signal]}
                  onCheckedChange={(checked) =>
                    void save({ otlp: { signals: { [signal]: checked === true } } })
                  }
                  label={SIGNAL_WORDS[signal].label}
                  description={SIGNAL_WORDS[signal].description}
                />
              ))}
            </Stack>
            <SendTest
              destination={{
                name: destination.name,
                color: destination.color,
                ...(destination.brand && { brand: destination.brand }),
              }}
              state={test.state}
              {...(test.message && { message: test.message })}
              {...(test.ms !== undefined && { ms: test.ms })}
              onTest={() => void runTest()}
            />
          </>
        )}
      </Stack>
    </Section>
  );
}

function Prometheus({ status, guard }: { status: TelemetryStatus; guard: Guard }) {
  const save = useSave(guard);
  const { prometheus } = status.settings;
  const [made, setMade] = useState<{ token: string; config: string }>();
  const config = useQuery({
    queryKey: ['dashboards', 'scrape-config'],
    queryFn: dashboardsApi.scrapeConfig,
    enabled: prometheus.on,
  });

  const newToken = async () => {
    try {
      await guard(async () => setMade(await dashboardsApi.token()));
    } catch (error) {
      fail(error);
    }
  };

  const shown = made?.config ?? config.data?.config;
  return (
    <Section
      title="Prometheus"
      description="Let Prometheus, or Grafana Alloy, read Conch’s numbers at /metrics."
    >
      <Stack gap={4}>
        <Switch
          checked={prometheus.on}
          onCheckedChange={(on) => void save({ prometheus: { on } })}
          label="Answer at /metrics"
          description={prometheus.on ? undefined : 'Off: nothing answers there.'}
        />
        {prometheus.on && (
          <Stack gap={4}>
            <Field>
              <Field.Label>Who may read it</Field.Label>
              <SegmentedControl
                value={prometheus.access}
                onValueChange={(access) =>
                  access &&
                  void save({ prometheus: { access: access as 'token' | 'this-computer' } })
                }
                aria-label="Who may read it"
              >
                <SegmentedControl.Item value="token">With its token</SegmentedControl.Item>
                <SegmentedControl.Item value="this-computer">
                  This computer only
                </SegmentedControl.Item>
              </SegmentedControl>
            </Field>
            <ScrapeBeat
              {...(status.prometheus.lastScrapeAt !== undefined && {
                lastAt: status.prometheus.lastScrapeAt,
              })}
            />
            {made && (
              <SecretReveal
                secret={made.token}
                title="Your scrape token"
                description="Copy it now: it won’t be shown again. It only reads numbers; making a new one stops this one."
              />
            )}
            {prometheus.access === 'token' && (
              <div>
                <Button
                  size="sm"
                  variant="surface"
                  leadingIcon={<KeyRound />}
                  onClick={() => void newToken()}
                >
                  {status.prometheus.tokenSaved ? 'New scrape token' : 'Make a scrape token'}
                </Button>
              </div>
            )}
            {shown && (
              <CodeBlock
                code={
                  prometheus.access === 'token'
                    ? shown
                    : shown.replace(/ {4}authorization:\n.*\n.*\n/, '')
                }
                language="yaml"
                filename="prometheus.yml"
              />
            )}
          </Stack>
        )}
      </Stack>
    </Section>
  );
}

function Grafana() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await dashboardsApi.grafana());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      fail(error);
    }
  };
  return (
    <Section
      title="A dashboard, ready made"
      description="For Grafana, reading from Prometheus or Grafana Cloud."
    >
      <GrafanaCard onCopy={() => void copy()} copied={copied} href="/api/dashboards/grafana" />
    </Section>
  );
}

function WhatLeaves() {
  const preview = useDashboardPreview();
  const [naming, setNaming] = useState<'otel' | 'prometheus'>('otel');
  return (
    <Section
      title="What leaves"
      description="Exactly what Conch would send now, with a few of the values."
      status={
        <SegmentedControl
          size="sm"
          value={naming}
          onValueChange={(v) => v && setNaming(v as 'otel' | 'prometheus')}
          aria-label="Names"
        >
          <SegmentedControl.Item value="otel">OpenTelemetry</SegmentedControl.Item>
          <SegmentedControl.Item value="prometheus">Prometheus</SegmentedControl.Item>
        </SegmentedControl>
      }
    >
      {preview.data ? (
        <Stack gap={5}>
          {preview.data.spans.length > 0 && (
            <Stack gap={2}>
              <Text size="sm" weight="medium">
                Your last turn, as a trace
              </Text>
              <TurnWaterfall spans={preview.data.spans} />
            </Stack>
          )}
          <MetricPreview metrics={preview.data.metrics} naming={naming} />
        </Stack>
      ) : (
        <Skeleton shape="block" height="10rem" />
      )}
    </Section>
  );
}

function Advanced({ status, guard }: { status: TelemetryStatus; guard: Guard }) {
  const save = useSave(guard);
  const { settings } = status;
  const destination = destinationOf(settings.otlp.destination);
  return (
    <Stack gap={8}>
      <Section
        title="The words of your chats"
        description="For your own Langfuse or Phoenix, to read prompts and replies beside their traces."
      >
        <Stack gap={3}>
          <Switch
            checked={settings.content}
            onCheckedChange={(content) => void save({ content })}
            label="Send what’s written, too"
            description="Messages, replies and what tools read and wrote, in traces only. Keys, passwords and addresses are taken out first."
          />
          {settings.content && (
            <Callout tone="warning" title={`Your chats’ words go to ${destination.name}`}>
              Anyone who can open that dashboard can read them. Turn this off when you only need the
              numbers.
            </Callout>
          )}
        </Stack>
      </Section>
      <Section title="How it sends">
        <Stack gap={4}>
          <Field>
            <Field.Label>Numbers go</Field.Label>
            <Select
              value={String(settings.intervalSeconds)}
              onValueChange={(v) => void save({ intervalSeconds: Number(v) })}
              aria-label="How often numbers go"
            >
              {INTERVALS.map((i) => (
                <Select.Item key={i.value} value={i.value}>
                  {i.label}
                </Select.Item>
              ))}
            </Select>
          </Field>
          {settings.otlp.destination !== 'phoenix' && (
            <Field>
              <Field.Label>Format</Field.Label>
              <SegmentedControl
                value={settings.otlp.encoding}
                onValueChange={(v) =>
                  v && void save({ otlp: { encoding: v as 'protobuf' | 'json' } })
                }
                aria-label="Format"
              >
                <SegmentedControl.Item value="protobuf">Protobuf</SegmentedControl.Item>
                <SegmentedControl.Item value="json">JSON</SegmentedControl.Item>
              </SegmentedControl>
              <Field.Description>
                Every service takes protobuf. JSON is for a collector that asks for it.
              </Field.Description>
            </Field>
          )}
        </Stack>
      </Section>
    </Stack>
  );
}
