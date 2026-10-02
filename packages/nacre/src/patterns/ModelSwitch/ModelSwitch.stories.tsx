import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { ModelSwitchCard, type ModelSwitchCardProps } from './ModelSwitch';

const linear = { name: 'Linear', brand: 'linear', color: '#5E6AD2' };

const meta = {
  title: 'Patterns/Chat/ModelSwitch',
  component: ModelSwitchCard,
  parameters: {
    docs: {
      description: {
        component:
          'Some models only chat: they can’t use apps, files, commands or memory. When a message needs an app (or a skill’s tools) and the chat’s model can’t, the message waits here instead of failing quietly. One button switches the chat to a model you already set up that can, and the message goes by itself; or it’s answered without. With no model that can, the one next step is connecting a provider. Once it goes, a quiet line says how.',
      },
    },
  },
  args: {
    model: 'Gemma3 1B',
    needs: [linear],
    switchTo: { label: 'Qwen3 4B' },
    onSwitch: () => {},
    onAnswerWithout: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 16, maxInlineSize: '44rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelSwitchCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The same provider has a model that can: the best choice, one tap. */
export const Offer: Story = {};

/** Only another provider you set up can: it says which. */
export const AnotherProvider: Story = {
  args: {
    model: 'Liquid: LFM 7B',
    switchTo: { label: 'Opus 5.5', provider: 'Claude Code' },
  },
};

export const SeveralApps: Story = {
  args: {
    needs: [linear, { name: 'Notion', brand: 'notion', color: '#000000' }],
  },
};

export const ASkill: Story = {
  name: 'A skill that needs tools',
  args: { needs: [{ name: 'Weekly review', kind: 'skill' }] },
};

/** No model you set up can use apps: one next step. */
export const NoneCan: Story = {
  args: { switchTo: undefined, onConnect: () => {} },
};

export const Switching: Story = { args: { busy: true } };

export const Switched: Story = { args: { state: 'switched' } };

export const AnsweredWithout: Story = { args: { state: 'answered' } };

function InChat(props: Partial<ModelSwitchCardProps>) {
  const [state, setState] = useState<ModelSwitchCardProps['state']>('offer');
  return (
    <MessageList>
      <Message from="user">What’s assigned to me in Linear this week?</Message>
      <ModelSwitchCard
        model="Gemma3 1B"
        needs={[linear]}
        switchTo={{ label: 'Qwen3 4B' }}
        {...props}
        state={state}
        onSwitch={() => setState('switched')}
        onAnswerWithout={() => setState('answered')}
      />
      {state === 'switched' && (
        <Message from="assistant">
          <Prose>You have three issues this week. The most urgent is due tomorrow.</Prose>
        </Message>
      )}
    </MessageList>
  );
}

export const InAConversation: Story = { render: () => <InChat /> };
