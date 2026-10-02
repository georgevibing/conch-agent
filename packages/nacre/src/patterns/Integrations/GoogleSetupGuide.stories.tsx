import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Stack } from '../../components/Stack';
import { GoogleSetupGuide } from './GoogleSetupGuide';

const meta = { title: 'Patterns/Integrations/Google setup' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
function Example({ initial = 0, narrow = false }: { initial?: number; narrow?: boolean }) {
  const [step, setStep] = useState(initial);
  const [project, setProject] = useState('');
  return (
    <Stack style={{ maxWidth: narrow ? 340 : 620 }}>
      <GoogleSetupGuide
        step={step}
        onStepChange={setStep}
        projectId={project}
        onProjectIdChange={setProject}
        services={['gmail', 'calendar']}
        importControl={
          <Stack gap={3}>
            <Field>
              <Field.Label>Google credential JSON</Field.Label>
              <Input type="file" accept=".json" />
            </Field>
            <Button disabled>Save and connect Google</Button>
          </Stack>
        }
      />
    </Stack>
  );
}
export const Start: Story = { render: () => <Example /> };
export const APIs: Story = { render: () => <Example initial={1} /> };
export const Audience: Story = { render: () => <Example initial={2} /> };
export const Import: Story = { render: () => <Example initial={3} /> };
export const Narrow: Story = { render: () => <Example initial={3} narrow /> };
