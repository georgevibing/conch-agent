import {
  Badge,
  Callout,
  IntegrationLogo,
  LinkCard,
  Prose,
  Surface,
  Text,
  Tick,
} from '@conch/nacre';
import { Link } from 'react-router';
import reference from 'virtual:conch-reference';

import type { ProviderRef } from '../../reference/types';
import styles from './embeds.module.css';

export function providerLogo(provider: ProviderRef) {
  return (
    <IntegrationLogo brand={provider.id} name={provider.name} color={provider.color} decorative />
  );
}

/** Every provider Conch drives, each a link to its page. */
export function ProviderGrid() {
  return (
    <div className={styles.grid}>
      {reference.providers.map((provider, index) => (
        <LinkCard
          key={provider.id}
          index={index}
          icon={providerLogo(provider)}
          title={provider.name}
          meta={provider.experimental ? 'Early support' : undefined}
          description={provider.tagline}
          asChild
        >
          <Link to={`/providers/${provider.id}`} />
        </LinkCard>
      ))}
    </div>
  );
}

const ABILITIES: { label: string; can: (provider: ProviderRef) => boolean }[] = [
  { label: 'Your files and commands', can: (p) => p.can.files },
  { label: 'Saves memories itself', can: (p) => p.can.hostTools },
  { label: 'Asks before each step', can: (p) => p.can.asksFirst },
  { label: 'Works offline', can: (p) => p.can.offline },
];

/** What each provider can do, side by side, as each engine declares it. */
export function ProviderMatrix() {
  return (
    <Prose size="lg">
      <table>
        <thead>
          <tr>
            <th scope="col">Provider</th>
            {ABILITIES.map((ability) => (
              <th key={ability.label} scope="col">
                {ability.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reference.providers.map((provider) => (
            <tr key={provider.id}>
              <th scope="row">
                <Link to={`/providers/${provider.id}`}>{provider.name}</Link>
              </th>
              {ABILITIES.map((ability) => (
                <td key={ability.label}>
                  <Tick value={ability.can(provider)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Prose>
  );
}

function connectsWith(provider: ProviderRef): string {
  if (provider.connect === 'program') return 'A program on this computer';
  return provider.key?.canSignIn
    ? 'A key you paste, or a sign-in that makes one'
    : 'A key you paste';
}

/** One provider, as the code describes it: what it is, what it takes, what it can't do. */
export function ProviderFacts({ id }: { id: string }) {
  const provider = reference.providers.find((p) => p.id === id);
  if (!provider)
    return (
      <Callout tone="danger" title={`There’s no provider “${id}”`}>
        The providers are listed in apps/server/src/providers/catalog.ts.
      </Callout>
    );
  const facts: [string, string][] = [
    ['Connects with', connectsWith(provider)],
    [
      'Your apps',
      provider.can.apps === 'itself' ? 'It runs them itself' : 'Conch hands it their tools',
    ],
  ];
  if (provider.can.account)
    facts.push(['Also brings', `The connectors of ${provider.can.account}`]);
  if (provider.key) facts.push(['A key looks like', provider.key.placeholder]);

  return (
    <Surface
      as="section"
      variant="flat"
      radius="xl"
      padding={5}
      className={styles.facts}
      aria-label={`${provider.name} at a glance`}
    >
      <div className={styles.factsHead}>
        <IntegrationLogo
          brand={provider.id}
          name={provider.name}
          color={provider.color}
          size="lg"
          decorative
        />
        <Text size="lg">{provider.description}</Text>
      </div>
      <ul className={styles.chips} aria-label="Good at">
        {provider.highlights.map((highlight) => (
          <li key={highlight}>
            <Badge tone="neutral">{highlight}</Badge>
          </li>
        ))}
        {provider.experimental && (
          <li>
            <Badge tone="warning">Early support</Badge>
          </li>
        )}
      </ul>
      <dl className={styles.pairs}>
        {facts.map(([term, value]) => (
          <div key={term}>
            <Text as="span" size="sm" tone="subtle" asChild>
              <dt>{term}</dt>
            </Text>
            <Text as="span" asChild>
              <dd>{value}</dd>
            </Text>
          </div>
        ))}
      </dl>
      <ul className={styles.abilities} aria-label="What it can do">
        {ABILITIES.map((ability) => (
          <li key={ability.label}>
            <Tick value={ability.can(provider)} />
            <Text as="span" tone={ability.can(provider) ? 'default' : 'subtle'}>
              {ability.label}
            </Text>
          </li>
        ))}
      </ul>
      {provider.limits.length > 0 && (
        <Callout tone="neutral" title="Worth knowing first">
          <ul className={styles.plainList}>
            {provider.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </Callout>
      )}
    </Surface>
  );
}
