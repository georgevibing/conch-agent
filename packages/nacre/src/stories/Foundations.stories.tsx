import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../components/Button';
import { Stack } from '../components/Stack';
import { Surface } from '../components/Surface';
import { Heading, Text } from '../components/Text';
import styles from './Foundations.module.css';

const meta = {
  title: 'Foundations',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const steps = Array.from({ length: 12 }, (_, i) => i + 1);

function Scale({ name }: { name: 'gray' | 'accent' }) {
  return (
    <div className={styles.scale}>
      {steps.map((step) => (
        <div key={step} className={styles.swatch}>
          <div className={styles.chip} style={{ background: `var(--nc-${name}-${step})` }} />
          {step}
        </div>
      ))}
    </div>
  );
}

const semanticTokens = [
  'canvas',
  'canvas-raised',
  'surface',
  'surface-overlay',
  'surface-sunken',
  'surface-inverse',
  'text',
  'text-muted',
  'text-subtle',
  'text-accent',
  'border',
  'border-strong',
  'ring',
  'wash-2',
];

export const Color: Story = {
  render: () => (
    <div className={styles.page}>
      <Stack gap={2}>
        <Heading level={1} display size="4xl">
          Colour, <em>derived</em>
        </Heading>
        <Text tone="muted" size="lg">
          Every step is computed in OKLCH from a hue and chroma. Change the accent in the toolbar
          and all twelve steps — and the pearl spectrum — follow.
        </Text>
      </Stack>
      <section className={styles.section}>
        <Heading level={2} size="lg">
          Accent
        </Heading>
        <Scale name="accent" />
      </section>
      <section className={styles.section}>
        <Heading level={2} size="lg">
          Neutral
        </Heading>
        <Scale name="gray" />
      </section>
      <section className={styles.section}>
        <Heading level={2} size="lg">
          Pearl spectrum
        </Heading>
        <div
          className={styles.chip}
          style={{
            blockSize: '4rem',
            background: 'linear-gradient(90deg, var(--nc-pearl-spectrum))',
          }}
        />
      </section>
      <section className={styles.section}>
        <Heading level={2} size="lg">
          Semantic tokens
        </Heading>
        <div className={styles.semantic}>
          {semanticTokens.map((token) => (
            <div key={token} className={styles.token}>
              <div className={styles.chip} style={{ background: `var(--nc-${token})` }} />
              --nc-{token}
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};

const typeScale = ['5xl', '4xl', '3xl', '2xl', 'xl', 'lg', 'md', 'sm', 'xs', '2xs'] as const;

const readingSamples = [
  { token: 'read-lg', size: '--nc-text-read-lg', label: 'read-lg 17' },
  { token: 'read', size: '--nc-text-read', label: 'read 16' },
  { token: 'code', size: '--nc-text-code', label: 'code 14' },
  { token: 'md', size: '--nc-text-md', label: 'UI 14' },
] as const;

export const Typography: Story = {
  render: () => (
    <div className={styles.page}>
      <Stack gap={2}>
        <Heading level={1} display size="5xl">
          Quiet type, <em>clear voice</em>
        </Heading>
        <Text tone="muted" size="lg">
          Geist for interface, Geist Mono for code, Instrument Serif for editorial moments.
        </Text>
      </Stack>
      <section className={styles.section}>
        {typeScale.map((size) => (
          <div key={size} className={styles.typeRow}>
            <span className={styles.typeMeta}>{size}</span>
            <Text size={size} weight={size.includes('xl') ? 'semibold' : 'regular'} truncate>
              Claude is refactoring the session store
            </Text>
          </div>
        ))}
      </section>
      <section className={styles.section}>
        <Heading level={2} size="lg">
          Tones
        </Heading>
        <Stack direction="row" gap={6} wrap>
          {(['default', 'muted', 'subtle', 'accent', 'success', 'danger'] as const).map((tone) => (
            <Text key={tone} tone={tone} weight="medium">
              {tone}
            </Text>
          ))}
        </Stack>
      </section>
      <section className={styles.section}>
        <Heading level={2} size="lg">
          Reading
        </Heading>
        <Text tone="muted" size="sm">
          UI text is glanced at (14px); reading text is read through (16px, line height 1.6, at most
          70ch). A reply reads 16 / 13 / 12: the words, the steps, the when.
        </Text>
        {readingSamples.map(({ token, size, label }) => (
          <div key={token} className={styles.typeRow}>
            <span className={styles.typeMeta}>{label}</span>
            <p
              style={{
                margin: 0,
                fontSize: `var(${size})`,
                lineHeight: 'var(--nc-leading-read)',
                maxInlineSize: 'var(--nc-measure-read)',
                fontFamily: token === 'code' ? 'var(--nc-font-mono)' : undefined,
              }}
            >
              {token === 'code'
                ? 'const frames = queue.drain(); // one frame, one message'
                : 'The bug was that frames were concatenated into a single buffer, so two messages arriving in the same tick were merged. Frames are now parsed one by one.'}
            </p>
          </div>
        ))}
      </section>
    </div>
  ),
};

export const Elevation: Story = {
  render: () => (
    <div className={styles.page}>
      <Stack gap={2}>
        <Heading level={1} display size="4xl">
          Layered <em>like nacre</em>
        </Heading>
        <Text tone="muted" size="lg">
          Tight, tinted shadows stacked over one broad ambient shadow, plus a glazed top edge. No
          blur, no glass.
        </Text>
      </Stack>
      <div className={styles.grid}>
        {([0, 1, 2, 3, 4] as const).map((e) => (
          <Surface key={e} elevation={e} className={styles.tile}>
            elevation {e}
          </Surface>
        ))}
        <Surface variant="sunken" className={styles.tile}>
          sunken
        </Surface>
        <Surface variant="outline" className={styles.tile}>
          outline
        </Surface>
      </div>
    </div>
  ),
};

export const Lustre: Story = {
  render: () => (
    <div className={styles.page}>
      <Stack gap={2}>
        <Heading level={1} display size="4xl">
          Lustre
        </Heading>
        <Text tone="muted" size="lg">
          Move your pointer across these surfaces. The rim turns toward the light, a soft sheen
          follows you, and a press sends a tide ring outward. The last card is <em>ambient</em> —
          how the composer looks while Claude is working.
        </Text>
      </Stack>
      <div className={styles.grid}>
        <Surface lustre elevation={2} className={styles.lustreHero}>
          <Text weight="medium">Hover me</Text>
          <Text size="sm" tone="subtle">
            rim + sheen
          </Text>
        </Surface>
        <Surface lustre interactive elevation={2} className={styles.lustreHero} tabIndex={0}>
          <Text weight="medium">Press me</Text>
          <Text size="sm" tone="subtle">
            interactive surface
          </Text>
        </Surface>
        <Surface lustre="ambient" elevation={3} className={styles.lustreHero}>
          <Text weight="medium">Ambient</Text>
          <Text size="sm" tone="subtle">
            agent is working
          </Text>
        </Surface>
      </div>
      <Stack direction="row" gap={3}>
        <Button>Solid</Button>
        <Button variant="surface">Surface</Button>
        <Button variant="soft">Soft</Button>
      </Stack>
    </div>
  ),
};

function SpringDemo({ name }: { name: 'snappy' | 'soft' | 'bouncy' }) {
  const [on, setOn] = useState(false);
  return (
    <Stack gap={2}>
      <Stack direction="row" justify="between" align="center">
        <Text weight="medium">--nc-spring-{name}</Text>
        <Button size="sm" variant="surface" onClick={() => setOn((v) => !v)}>
          Play
        </Button>
      </Stack>
      <div className={styles.motionTrack} data-on={on || undefined}>
        <div
          className={styles.motionDot}
          style={{
            transitionDuration: `var(--nc-spring-${name}-duration)`,
            transitionTimingFunction: `var(--nc-spring-${name})`,
          }}
        />
      </div>
    </Stack>
  );
}

export const Motion: Story = {
  render: () => (
    <div className={styles.page}>
      <Stack gap={2}>
        <Heading level={1} display size="4xl">
          Motion, <em>on springs</em>
        </Heading>
        <Text tone="muted" size="lg">
          Real damped-spring physics baked into CSS <code>linear()</code> curves. Switch the toolbar
          to reduced motion and everything becomes instant.
        </Text>
      </Stack>
      <SpringDemo name="snappy" />
      <SpringDemo name="soft" />
      <SpringDemo name="bouncy" />
    </div>
  ),
};
