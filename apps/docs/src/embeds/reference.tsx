import {
  Badge,
  Callout,
  Definitions,
  Heading,
  InlineCode,
  Prose,
  Text,
  vaultSourceName,
} from '@conch/nacre';
import type { ReactNode } from 'react';
import reference from 'virtual:conch-reference';

import type { MessageRef, NeedHow } from '../../reference/types';
import { slugify } from '../site/text';
import styles from './embeds.module.css';
import { CLI_GROUPS, FILE_CLASSES } from './words';

/** A titled group inside a generated list, with an anchor the table of contents can find. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = slugify(title);
  return (
    <section className={styles.group} aria-labelledby={id}>
      <Heading level={2} size="xl" id={id} className={styles.groupTitle}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

/** Every `conch` command, grouped as `cliCommands.ts` groups them. */
export function CliReference() {
  return (
    <div className={styles.stack}>
      {CLI_GROUPS.map((group) => (
        <Group key={group} title={group}>
          <Definitions label={group}>
            {reference.cli
              .filter((command) => command.group === group)
              .map((command) => (
                <Definitions.Item
                  key={command.usage}
                  id={slugify(command.usage)}
                  term={command.usage}
                >
                  {command.detail}
                  {command.subcommands.length > 0 && (
                    <Prose size="md">
                      <table>
                        <tbody>
                          {command.subcommands.map((sub) => (
                            <tr key={sub.usage}>
                              <th scope="row">
                                <code>{`${command.name} ${sub.usage}`}</code>
                              </th>
                              <td>{sub.summary}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Prose>
                  )}
                </Definitions.Item>
              ))}
          </Definitions>
        </Group>
      ))}
    </div>
  );
}

/** Every environment variable Conch reads, from the schema that validates them. */
export function EnvReference() {
  const shown = reference.env.filter((variable) => !variable.internal);
  return (
    <Definitions label="Settings">
      {shown.map((variable) => {
        const facts = [
          variable.values && `One of: ${variable.values.join(', ')}`,
          variable.unset
            ? `Unset: ${variable.unset}`
            : variable.default !== undefined && `Default: ${variable.default}`,
        ].filter(Boolean);
        return (
          <Definitions.Item
            key={variable.name}
            id={variable.name.toLowerCase()}
            term={variable.name}
            meta={facts.length ? facts.join(' · ') : undefined}
          >
            {variable.about}
          </Definitions.Item>
        );
      })}
    </Definitions>
  );
}

const MODE_TONE = { default: 'neutral', caution: 'warning', danger: 'danger' } as const;

/** The permission modes, in the app's own words. */
export function ModeList() {
  return (
    <Definitions label="Modes">
      {reference.modes.map((mode) => (
        <Definitions.Item
          key={mode.value}
          id={slugify(mode.label)}
          term={
            <span className={styles.inline}>
              <Text as="span" weight="semibold">
                {mode.label}
              </Text>
              {mode.tone !== 'default' && (
                <Badge size="sm" tone={MODE_TONE[mode.tone]}>
                  {mode.tone === 'danger' ? 'Asks you to confirm' : 'More room'}
                </Badge>
              )}
            </span>
          }
        >
          {mode.description}
        </Definitions.Item>
      ))}
    </Definitions>
  );
}

/** How hard the model thinks, from quick to as long as it takes. */
export function EffortList() {
  return (
    <Definitions label="Thinking effort">
      {reference.efforts.map((effort) => (
        <Definitions.Item key={effort.value} term={`/effort ${effort.value}`} meta={effort.label}>
          {effort.description}.
        </Definitions.Item>
      ))}
    </Definitions>
  );
}

/** Conch's own slash commands. */
export function SlashReference() {
  return (
    <Definitions label="Commands">
      {reference.slash.map((command) => (
        <Definitions.Item
          key={command.name}
          id={`slash-${command.name}`}
          term={`/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`}
          meta={
            command.aliases.length
              ? `Also: ${command.aliases.map((alias) => `/${alias}`).join(', ')}`
              : undefined
          }
        >
          {command.description}.
        </Definitions.Item>
      ))}
    </Definitions>
  );
}

/** What lives in the Conch folder, sorted by what a backup does with it. */
export function FilesReference() {
  return (
    <div className={styles.stack}>
      {FILE_CLASSES.map((kind) => {
        const files = reference.files.filter((file) => file.class === kind.id);
        if (!files.length) return null;
        return (
          <Group key={kind.id} title={kind.title}>
            <Text tone="muted" size="lg">
              {kind.about}
            </Text>
            <Definitions label={kind.title}>
              {files.map((file) => (
                <Definitions.Item key={file.path} term={file.path}>
                  {file.why}
                </Definitions.Item>
              ))}
            </Definitions>
          </Group>
        );
      })}
    </div>
  );
}

const PLATFORMS = [
  ['darwin', 'macOS'],
  ['win32', 'Windows'],
  ['linux', 'Linux'],
] as const;

function how(platform: NeedHow | undefined): ReactNode {
  if (!platform)
    return (
      <Text as="span" tone="subtle">
        Not needed
      </Text>
    );
  if (platform.install) return <code>{platform.install}</code>;
  if (platform.download)
    return (
      <a href={platform.download} target="_blank" rel="noreferrer">
        Its own installer
      </a>
    );
  return (
    <Text as="span" tone="subtle">
      Comes with another
    </Text>
  );
}

/** The programs Conch can find, install and update for you. */
export function NeedsReference() {
  return (
    <Prose size="lg">
      <table>
        <thead>
          <tr>
            <th scope="col">Program</th>
            {PLATFORMS.map(([, name]) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
            <th scope="col">Kept up to date</th>
          </tr>
        </thead>
        <tbody>
          {reference.needs.map((need) => (
            <tr key={need.id}>
              <th scope="row">
                {need.name}
                {need.comesWith && (
                  <>
                    <br />
                    <small>Comes with {need.comesWith.replace(/^The /, 'the ')}</small>
                  </>
                )}
              </th>
              {PLATFORMS.map(([platform]) => (
                <td key={platform}>{how(need.platforms[platform])}</td>
              ))}
              <td>{need.updates ? 'Yes' : 'By itself, or by you'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Prose>
  );
}

/** Every address the app's own API answers at, by area. */
export function RoutesReference() {
  const areas = [...new Set(reference.routes.map((route) => route.area))];
  return (
    <div className={styles.columns}>
      {areas.map((area) => (
        <div key={area} className={styles.routes}>
          <Heading level={3} size="md" id={`api-${area}`} className={styles.groupTitle}>
            /api/{area}
          </Heading>
          <ul className={styles.plainList}>
            {reference.routes
              .filter((route) => route.area === area)
              .map((route) => (
                <li key={`${route.method} ${route.path}`} className={styles.route}>
                  <Badge size="sm" tone={route.method === 'GET' ? 'neutral' : 'accent'}>
                    {route.method}
                  </Badge>
                  <InlineCode>{route.path.replace(`/api/${area}`, '') || '/'}</InlineCode>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const SOCKET: Record<string, { label: string; messages: MessageRef[] }> = {
  commands: { label: 'What the app sends', messages: reference.socket.commands },
  events: { label: 'What Conch sends', messages: reference.socket.events },
  conversation: { label: 'A conversation’s events', messages: reference.socket.conversation },
};

/** The messages on the live socket, straight from the schemas both sides validate with. */
export function SocketReference({ kind }: { kind: string }) {
  const list = SOCKET[kind];
  if (!list)
    return (
      <Callout tone="danger" title={`There’s no “conch:socket ${kind}”`}>
        It takes commands, events or conversation.
      </Callout>
    );
  return (
    <Definitions label={list.label}>
      {list.messages.map((message) => (
        <Definitions.Item key={message.type} id={`${kind}-${message.type}`} term={message.type}>
          {message.fields.length ? (
            <ul className={styles.fields}>
              {message.fields.map((field) => (
                <li key={field.name}>
                  <InlineCode>
                    {field.name}
                    {field.optional ? '?' : ''}
                  </InlineCode>
                  <Text as="span" size="sm" tone="subtle">
                    {field.type}
                  </Text>
                </li>
              ))}
            </ul>
          ) : (
            <Text as="span" tone="subtle">
              Nothing else.
            </Text>
          )}
        </Definitions.Item>
      ))}
    </Definitions>
  );
}

/** The password managers Conch reads beside its own vault, as a sentence. */
export function PasswordManagers() {
  const names = reference.passwordManagers.map((id) =>
    vaultSourceName(id as Parameters<typeof vaultSourceName>[0]),
  );
  return (
    <ul className={styles.chips} aria-label="Password managers">
      {names.map((name) => (
        <li key={name}>
          <Badge tone="neutral">{name}</Badge>
        </li>
      ))}
    </ul>
  );
}
