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

const GROUPS: { id: ProviderRef['group']; title: string; lead: string }[] = [
  {
    id: 'subscription',
    title: 'Your plans',
    lead: 'A plan you already pay for, signed in with its own program.',
  },
  { id: 'local', title: 'On this computer', lead: 'Private, free, and answers with no internet.' },
  {
    id: 'key',
    title: 'Pay as you go',
    lead: 'A key you paste. Conch checks it with that company before keeping it.',
  },
];

/** Every provider Conch drives, by what connecting takes, each a link to its page. */
export function ProviderGrid() {
  return (
    <div className={styles.stack}>
      {GROUPS.map((group) => {
        const providers = reference.providers.filter((p) => p.group === group.id);
        return (
          <section key={group.id} aria-label={group.title} className={styles.stack}>
            <Text as="p" size="sm" tone="muted">
              <strong>{group.title}.</strong> {group.lead}
            </Text>
            <div className={styles.grid}>
              {providers.map((provider, index) => (
                <LinkCard
                  key={provider.id}
                  index={index}
                  icon={providerLogo(provider)}
                  title={provider.name}
                  meta={provider.experimental ? 'Early support' : provider.free}
                  description={provider.tagline}
                  asChild
                >
                  <Link to={`/providers/${provider.id}`} />
                </LinkCard>
              ))}
              {group.id === 'local' && (
                <LinkCard
                  index={providers.length}
                  icon={
                    <IntegrationLogo
                      brand="server"
                      name={reference.server.name}
                      color={reference.server.color}
                      decorative
                    />
                  }
                  title={reference.server.name}
                  description={reference.server.tagline}
                  asChild
                >
                  <Link to="/providers/servers" />
                </LinkCard>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A server you add yourself, as the idea: what it is, what it's good at, what to know. */
export function ServerFacts() {
  const server = reference.server;
  return (
    <Surface
      as="section"
      variant="flat"
      radius="xl"
      padding={5}
      className={styles.facts}
      aria-label={`${server.name} at a glance`}
    >
      <div className={styles.factsHead}>
        <IntegrationLogo
          brand="server"
          name={server.name}
          color={server.color}
          size="lg"
          decorative
        />
        <Text size="lg">{server.description}</Text>
      </div>
      <ul className={styles.chips} aria-label="Good at">
        {server.highlights.map((highlight) => (
          <li key={highlight}>
            <Badge tone="neutral">{highlight}</Badge>
          </li>
        ))}
      </ul>
      <Callout tone="neutral" title="Worth knowing first">
        <ul className={styles.plainList}>
          {server.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </Callout>
    </Surface>
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
  if (provider.group === 'local') return 'A program on this computer';
  if (provider.connect === 'program')
    return 'Your own sign-in, through its program on this computer';
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
    facts.push([
      'Also brings',
      `The connectors of ${provider.can.account}; Conch brings in the ones it can connect, for every model`,
    ]);
  if (provider.key?.placeholder) facts.push(['A key looks like', provider.key.placeholder]);
  if (provider.free) facts.push(['To start', provider.free]);

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
