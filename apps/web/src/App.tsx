import { Button, Heading, Stack, Surface, Text } from '@conch/nacre';
import { ArrowRight } from 'lucide-react';

/** Placeholder shell — the chat experience lands in the next milestone. */
export function App() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <Surface lustre elevation={3} radius="2xl" padding={8} style={{ maxWidth: '32rem' }}>
        <Stack gap={4}>
          <Heading level={1} display size="4xl">
            Conch, <em>listening</em>
          </Heading>
          <Text tone="muted" size="lg">
            A calm window onto the Claude Code running on this machine.
          </Text>
          <Stack direction="row" gap={3}>
            <Button trailingIcon={<ArrowRight />}>New session</Button>
            <Button variant="surface">Resume</Button>
          </Stack>
        </Stack>
      </Surface>
    </main>
  );
}
