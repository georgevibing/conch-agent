import { recogniseKey, type Found, type Provider } from '@conch/protocol';
import {
  Heading,
  IntegrationCard,
  KeyCatcher,
  Stack,
  Text,
  toast,
  type KeyCandidate,
} from '@conch/nacre';
import { useId } from 'react';

import styles from './Providers.module.css';
import { useFound, useSetProviderKey, errorText } from './queries';
import { brandOf } from './words';

/**
 * What Conch noticed on this computer that connects a provider in one press:
 * a key already in its environment, a model server already running.
 */
export function FoundHere({ found }: { found: Found[] }) {
  const headingId = useId();
  const use = useFound();
  if (!found.length) return null;
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <Stack gap={0.5}>
        <Heading level={3} size="sm" tone="muted" id={headingId}>
          Found on this computer
        </Heading>
        <Text size="sm" tone="subtle">
          Ready to connect in one press. Nothing is used until you press it.
        </Text>
      </Stack>
      <ul className={styles.yours}>
        {found.map((item, index) => (
          <li key={item.id}>
            <IntegrationCard
              variant="found"
              index={index}
              name={item.name}
              brand={item.brand}
              color={item.color}
              tagline={item.detail}
              action={{
                label:
                  item.kind === 'key' ? 'Use this key' : item.kind === 'cloud' ? 'Use this' : 'Add',
                onClick: () =>
                  use.mutate(item.id, {
                    onSuccess: () =>
                      toast.success(
                        `${item.name} is ${item.kind === 'server' ? 'added' : 'connected'}. Its models are in the picker.`,
                      ),
                  }),
                loading: use.isPending && use.variables === item.id,
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

const candidate = (p: Provider): KeyCandidate => ({
  id: p.id,
  name: p.name,
  brand: brandOf(p),
  ...(p.color && { color: p.color }),
});

/**
 * Use an API key instead: a quiet line under the ways in. Paste a key there or
 * anywhere on the page, and Conch knows whose it is
 * from its prefix, or asks when its shape alone could be more than one
 * company's, and checks it with that provider before keeping it.
 */
export function KeyPaste({ providers }: { providers: Provider[] }) {
  const setKey = useSetProviderKey();
  // Providers you'd paste a key for: the pay-as-you-go ones, not servers or programs.
  const keyed = providers.filter((p) => p.connect === 'key' && p.group === 'key' && p.keyForm);
  return (
    <KeyCatcher
      recognise={(value) => {
        const { ids, sure } = recogniseKey(value, keyed);
        const candidates = ids.flatMap((id) => {
          const p = keyed.find((k) => k.id === id);
          return p ? [candidate(p)] : [];
        });
        return { candidates, sure };
      }}
      all={keyed.map(candidate)}
      onConnect={async (id, value) => {
        try {
          await setKey.mutateAsync({ id: id as Provider['id'], value });
        } catch (error) {
          throw new Error(errorText(error, 'That key didn’t work.'));
        }
      }}
    />
  );
}
