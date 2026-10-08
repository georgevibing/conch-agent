import type { Meta, StoryObj } from '@storybook/react-vite';
import { Briefcase, Code, Mail, PenLine, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { Heading, Text } from '../../components/Text';
import {
  WelcomeApps,
  WelcomeBackdrop,
  WelcomeChoices,
  WelcomeName,
  WelcomeRise,
  WelcomeStage,
  WelcomeStarters,
  WelcomeSteps,
  WelcomeVoice,
} from './Welcome';

const meta = {
  title: 'Patterns/Welcome',
  component: WelcomeStage,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The first minutes with Conch (ADR 0068). One thing at a time, said like a sentence: each stage surfaces and its lines rise a beat apart, over a pearl dawn that drifts as you go. Answers are tapped, not typed, except a name, which is typed large. Choosing a voice is hearing it.',
      },
    },
  },
} satisfies Meta<typeof WelcomeStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hello: Story = {
  render: () => (
    <>
      <WelcomeBackdrop progress={0} />
      <WelcomeStage>
        <WelcomeRise order={0}>
          <Pearl size="xl" state="thinking" label={null} />
        </WelcomeRise>
        <WelcomeRise order={1}>
          <Heading level={1} display size="5xl">
            Hi, I’m Conch.
          </Heading>
        </WelcomeRise>
        <WelcomeRise order={2}>
          <Text size="lg" tone="muted">
            Your own assistant, on your own computer.
          </Text>
        </WelcomeRise>
        <WelcomeRise order={3}>
          <Button size="lg">Let’s begin</Button>
        </WelcomeRise>
      </WelcomeStage>
    </>
  ),
};

export const YourName: Story = {
  render: function Render() {
    const [name, setName] = useState('');
    return (
      <WelcomeStage>
        <WelcomeSteps count={5} current={0} />
        <Heading level={1} display size="4xl">
          First, what should I call you?
        </Heading>
        <WelcomeName
          label="Your name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </WelcomeStage>
    );
  },
};

/** A long name shrinks to fit its line instead of running out of sight; try it at phone width. */
export const LongName: Story = {
  render: function Render() {
    const [name, setName] = useState('Maximiliane Alexandra-Konstantinopoulou');
    return (
      <WelcomeStage>
        <Heading level={1} display size="4xl">
          First, what should I call you?
        </Heading>
        <WelcomeName
          label="Your name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </WelcomeStage>
    );
  },
};

const choices = [
  { value: 'writing', label: 'Writing', icon: <PenLine /> },
  { value: 'coding', label: 'Coding', icon: <Code /> },
  { value: 'research', label: 'Research', icon: <Search /> },
  { value: 'email', label: 'Email and calendar', icon: <Mail /> },
  { value: 'work', label: 'Work and meetings', icon: <Briefcase /> },
  { value: 'ideas', label: 'Ideas', icon: <Sparkles /> },
];

export const Choices: Story = {
  render: function Render() {
    const [value, setValue] = useState(['coding']);
    return (
      <WelcomeStage>
        <WelcomeChoices
          label="What you’d like a hand with"
          choices={choices}
          value={value}
          onChange={setValue}
        />
      </WelcomeStage>
    );
  },
};

const lines = {
  Warm: 'Happy to help, Ada. Let’s figure this out together.',
  Concise: 'Done, Ada. Three files changed.',
  Playful: 'Ooh, a regex puzzle, Ada. My favourite kind of trouble.',
} as const;

export const Voice: Story = {
  render: function Render() {
    const [tone, setTone] = useState<keyof typeof lines>('Warm');
    return (
      <WelcomeStage>
        <WelcomeVoice from="Conch" text={lines[tone]} />
        <div style={{ display: 'flex', gap: 8 }}>
          {(Object.keys(lines) as (keyof typeof lines)[]).map((t) => (
            <Button key={t} variant={t === tone ? 'solid' : 'surface'} onClick={() => setTone(t)}>
              {t}
            </Button>
          ))}
        </div>
      </WelcomeStage>
    );
  },
};

export const Apps: Story = {
  render: function Render() {
    const [on, setOn] = useState<string[]>(['gmail']);
    const apps = [
      { id: 'gmail', name: 'Gmail', color: '#EA4335' },
      { id: 'google-calendar', name: 'Google Calendar', color: '#4285F4' },
      { id: 'slack', name: 'Slack', color: '#4A154B' },
      { id: 'github', name: 'GitHub', color: '#181717' },
      { id: 'notion', name: 'Notion', color: '#000000' },
      { id: 'linear', name: 'Linear', color: '#5E6AD2' },
    ];
    return (
      <div style={{ inlineSize: 560 }}>
        <WelcomeApps
          label="Your apps"
          apps={apps.map((a) => ({ ...a, connected: on.includes(a.id) }))}
          onPick={(id) => setOn((now) => (now.includes(id) ? now : [...now, id]))}
        />
      </div>
    );
  },
};

export const Starters: Story = {
  render: () => (
    <WelcomeStage>
      <Heading level={1} display size="5xl">
        You’re all set, Ada.
      </Heading>
      <WelcomeStarters
        label="Something to ask first"
        starters={[
          'Help me plan my week',
          'Find me three good sources on something I’m curious about',
          'What needs my attention in my inbox today?',
        ]}
        onPick={() => undefined}
      />
    </WelcomeStage>
  ),
};
