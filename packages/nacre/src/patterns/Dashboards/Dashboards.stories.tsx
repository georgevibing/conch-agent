import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Input } from '../../components/Input';
import { Stack } from '../../components/Stack';
import {
  DashboardPicker,
  GrafanaCard,
  MetricPreview,
  PasteWell,
  ScrapeBeat,
  SendTest,
  TurnWaterfall,
  type FoundPiece,
  type SendTestState,
} from './Dashboards';
import { metrics, spans, tiles } from './fixtures';

const meta = {
  title: 'Patterns/Dashboards',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Settings → Dashboards (ADR 0119): where Conch’s numbers go, for people who’ve never heard of OTLP. Choose a service by its mark, paste what it shows you (Conch reads the key and the endpoint out of it), and press Send a test: a pearl runs from the shell to the service, which takes a ring of light when it received it. What leaves is shown as it leaves, opening with what never does, and the newest turn is drawn as the trace a dashboard will show.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const WhereToSend: Story = {
  render: function Render() {
    const [value, setValue] = useState('grafana-cloud');
    return (
      <DashboardPicker
        destinations={tiles}
        value={value}
        onValueChange={setValue}
        live="grafana-cloud"
      />
    );
  },
};

const grafanaFound: FoundPiece[] = [
  { label: 'Endpoint', value: 'otlp-gateway-prod-eu-west-2.grafana.net' },
  { label: 'Instance', value: '1234567' },
  { label: 'Token', value: 'glc_eyJvIjoiMTIzNDU2NyIsIm4iOiJjb25jaCJ9ab12', secret: true },
];

export const PasteIt: Story = {
  render: function Render() {
    const [found, setFound] = useState<FoundPiece[]>([]);
    return (
      <PasteWell
        label="Paste what Grafana Cloud shows you"
        hint="In your stack, open OpenTelemetry → Configure, make a token, and paste everything it shows."
        onPaste={() => setFound(grafanaFound)}
        found={found}
      >
        <Input aria-label="OTLP endpoint" placeholder="https://otlp-gateway-…grafana.net/otlp" />
        <Input aria-label="Instance ID" placeholder="1234567" />
        <Input aria-label="Token" type="password" placeholder="glc_…" />
      </PasteWell>
    );
  },
};

export const ReadFromThePaste: Story = {
  render: () => (
    <PasteWell
      label="Paste what Grafana Cloud shows you"
      onPaste={() => undefined}
      found={grafanaFound}
    />
  ),
};

export const KeySaved: Story = {
  render: () => (
    <Stack gap={4}>
      <PasteWell
        label="Paste what Honeycomb shows you"
        onPaste={() => undefined}
        saved="Your ingest key is saved (…4f2c). Paste another to change it."
      />
      <PasteWell
        label="Paste what Langfuse shows you"
        onPaste={() => undefined}
        problem="That didn’t read as a Langfuse key pair. Paste both keys: pk-lf-… and sk-lf-…"
      />
    </Stack>
  ),
};

const grafana = { name: 'Grafana Cloud', brand: 'grafana', color: '#F46800' };

export const SendATest: Story = {
  render: function Render() {
    const [state, setState] = useState<SendTestState>('idle');
    const test = () => {
      setState('sending');
      setTimeout(() => setState('received'), 1600);
    };
    return (
      <SendTest
        destination={grafana}
        state={state}
        message="Grafana Cloud received it."
        ms={182}
        onTest={test}
      />
    );
  },
};

export const Sending: Story = {
  render: () => <SendTest destination={grafana} state="sending" onTest={() => undefined} />,
};

export const Received: Story = {
  render: () => (
    <SendTest
      destination={grafana}
      state="received"
      message="Grafana Cloud received it."
      ms={182}
      onTest={() => undefined}
    />
  ),
};

export const DidntArrive: Story = {
  render: () => (
    <SendTest
      destination={{ name: 'Honeycomb', color: '#E79A12' }}
      state="failed"
      message="Honeycomb didn’t take the key. Paste it again, or make a new one."
      onTest={() => undefined}
    />
  ),
};

export const WhatLeaves: Story = {
  render: () => <MetricPreview metrics={metrics} />,
};

export const WhatLeavesForPrometheus: Story = {
  render: () => <MetricPreview metrics={metrics} naming="prometheus" initial={3} />,
};

export const TheLastTurn: Story = {
  render: () => <TurnWaterfall spans={spans} />,
};

export const PrometheusReading: Story = {
  render: () => (
    <Stack gap={2}>
      <ScrapeBeat now={60_000} />
      <ScrapeBeat lastAt={48_000} now={60_000} />
    </Stack>
  ),
};

export const ADashboardForGrafana: Story = {
  render: function Render() {
    const [copied, setCopied] = useState(false);
    return <GrafanaCard onCopy={() => setCopied(true)} copied={copied} href="#" />;
  },
};

export const TheWholePage: Story = {
  render: function Render() {
    const [value, setValue] = useState('grafana-cloud');
    return (
      <Stack gap={6} style={{ maxInlineSize: '46rem' }}>
        <DashboardPicker
          destinations={tiles}
          value={value}
          onValueChange={setValue}
          live="grafana-cloud"
        />
        <PasteWell
          label="Paste what Grafana Cloud shows you"
          onPaste={() => undefined}
          found={grafanaFound}
        />
        <SendTest
          destination={grafana}
          state="received"
          message="Grafana Cloud received it."
          ms={182}
          onTest={() => undefined}
        />
        <TurnWaterfall spans={spans} />
        <MetricPreview metrics={metrics} initial={4} />
        <GrafanaCard onCopy={() => undefined} href="#" />
      </Stack>
    );
  },
};
