import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyRound, Server, ShieldCheck } from 'lucide-react';

import { Accordion } from './Accordion';

// Accordion's props are a discriminated union (single | multiple), which
// Storybook's arg inference can't express — stories pass props explicitly.
const meta: Meta = {
  title: 'Components/Display/Accordion',
  component: Accordion,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxInlineSize: 520 }}>{Story()}</div>],
};

export default meta;
type Story = StoryObj;

const items = [
  {
    value: 'host',
    icon: <Server />,
    title: 'Where does Claude Code run?',
    meta: 'Local',
    body: 'On the machine running the Conch gateway. The browser only renders the conversation; files, commands and credentials never leave your host.',
  },
  {
    value: 'auth',
    icon: <KeyRound />,
    title: 'How is the web UI authenticated?',
    body: 'The gateway binds to localhost by default and issues a one-time pairing token. Remote access requires an explicit tunnel.',
  },
  {
    value: 'perm',
    icon: <ShieldCheck />,
    title: 'Can I approve tool calls?',
    meta: '3 rules',
    body: 'Yes. Permission prompts from Claude Code surface inline, and you can allow once, always, or deny.',
  },
];

export const Divided: Story = {
  render: () => (
    <Accordion type="single" collapsible defaultValue="host">
      {items.map((item) => (
        <Accordion.Item key={item.value} value={item.value}>
          <Accordion.Trigger meta={item.meta}>{item.title}</Accordion.Trigger>
          <Accordion.Content>{item.body}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion>
  ),
};

export const Separated: Story = {
  render: () => (
    <Accordion type="single" collapsible defaultValue="host" variant="separated">
      {items.map((item) => (
        <Accordion.Item key={item.value} value={item.value}>
          <Accordion.Trigger icon={item.icon} meta={item.meta}>
            {item.title}
          </Accordion.Trigger>
          <Accordion.Content>{item.body}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion>
  ),
};

export const Multiple: Story = {
  render: () => (
    <Accordion type="multiple" defaultValue={['host', 'perm']} variant="separated">
      {items.map((item) => (
        <Accordion.Item key={item.value} value={item.value}>
          <Accordion.Trigger icon={item.icon} meta={item.meta}>
            {item.title}
          </Accordion.Trigger>
          <Accordion.Content>{item.body}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion>
  ),
};
