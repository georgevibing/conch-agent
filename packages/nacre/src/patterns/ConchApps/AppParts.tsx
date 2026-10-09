import {
  AppWindow,
  BrainCircuit,
  ExternalLink,
  MessagesSquare,
  Eye,
  Globe,
  GlobeLock,
  HardDrive,
  PencilLine,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Collapsible } from '../../components/Collapsible';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { PasswordInput } from '../../components/PasswordInput';
import { cx } from '../../utils/cx';
import styles from './ConchApps.module.css';
import {
  isWebLink,
  type AppAbilityLine,
  type AppChangesView,
  type AppPageView,
  type AppSettingView,
  type AppToolView,
} from './types';

const ABILITY_ICONS: Record<AppAbilityLine['kind'], ReactNode> = {
  // What it brings (ADR 0122): a provider that answers chats, a chat app to talk on.
  provider: <BrainCircuit />,
  channel: <MessagesSquare />,
  data: <HardDrive />,
  reach: <Globe />,
  'nothing-else': <ShieldCheck />,
  needs: <UserRound />,
  looks: <Search />,
  changes: <PencilLine />,
};

export interface AppAbilityListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  abilities: readonly AppAbilityLine[];
  /** Its pages, as one more line. */
  pages?: readonly AppPageView[];
  /** Names the list: “What Plant diary can do”. */
  label: string;
}

/**
 * What an app can do, one plain line each with a small icon (ADR 0061): the
 * words the protocol's `appAbilities` wrote, so the card, the page and the
 * preview read the same.
 */
export function AppAbilityList({
  abilities,
  pages,
  label,
  className,
  ...props
}: AppAbilityListProps) {
  return (
    <ul aria-label={label} className={cx(styles.abilities, className)} {...props}>
      {abilities.map((line) => {
        const none = line.kind === 'reach' && /^Reaches no /.test(line.text);
        return (
          <li
            key={line.kind}
            className={styles.ability}
            data-kind={line.kind}
            data-none={none || undefined}
          >
            <span className={styles.abilityIcon} aria-hidden>
              {none ? <GlobeLock /> : ABILITY_ICONS[line.kind]}
            </span>
            <span>{line.text}</span>
          </li>
        );
      })}
      {pages && pages.length > 0 && (
        <li className={styles.ability} data-kind="pages">
          <span className={styles.abilityIcon} aria-hidden>
            <AppWindow />
          </span>
          <span>
            {pages.length > 1 ? 'Pages' : 'A page'}: {pages.map((p) => p.title).join(', ')}
          </span>
        </li>
      )}
    </ul>
  );
}

export interface AppToolsProps extends Omit<ComponentProps<'div'>, 'children'> {
  tools: readonly AppToolView[];
  /** Start open (an install preview of someone else's app). */
  defaultOpen?: boolean;
}

/**
 * Its tools, folded away under a count: each one's name, what it's for, and
 * whether it only looks or makes changes. Read changes first, since they're
 * what asks before going.
 */
export function AppTools({ tools, defaultOpen, className, ...props }: AppToolsProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  if (!tools.length) return null;
  const sorted = [...tools].sort((a, b) => Number(b.changes) - Number(a.changes));
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cx(styles.tools, className)}
      {...props}
    >
      <Collapsible.Trigger className={styles.toolsTrigger}>
        {tools.length === 1 ? 'Its tool' : `Its ${tools.length} tools`}
      </Collapsible.Trigger>
      {/* A sunken panel of its tools: the fold's whole width. */}
      <Collapsible.Content inset={false}>
        <ul className={styles.toolList}>
          {sorted.map((tool) => (
            <li key={tool.name} className={styles.tool}>
              <div className={styles.toolHead}>
                <span className={styles.toolTitle}>{tool.title || tool.name}</span>
                {tool.changes ? (
                  <Badge size="sm" tone="warning" icon={<PencilLine />}>
                    Changes things
                  </Badge>
                ) : (
                  <Badge size="sm" tone="neutral" icon={<Eye />}>
                    Looks
                  </Badge>
                )}
              </div>
              {tool.description && <p className={styles.toolAbout}>{tool.description}</p>}
            </li>
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible>
  );
}

export interface AppChangesProps extends Omit<ComponentProps<'section'>, 'children'> {
  changes: AppChangesView;
  /** `describeChanges`: one sentence each, new reach first. */
  words: readonly string[];
  /** In place of “What’s new in 1.2.0” (going back to an earlier one isn't new). */
  title?: string;
}

/**
 * What an update changes, before **Update** is pressed (ADR 0061): new reach
 * first and marked, calmly, since it's what someone should look at twice.
 */
export function AppChanges({ changes, words, title, className, ...props }: AppChangesProps) {
  const titleId = useId();
  // `describeChanges` says new reach first, then a tool that now makes changes.
  const marked = (changes.reachesAdded?.length ? 1 : 0) + (changes.toolsNowChange?.length ? 1 : 0);
  return (
    <section aria-labelledby={titleId} className={cx(styles.changes, className)} {...props}>
      <p id={titleId} className={styles.sectionLabel}>
        {title ?? `What’s new in ${changes.to}`}
      </p>
      {words.length ? (
        <ul className={styles.changeList}>
          {words.map((line, i) => (
            <li key={line} className={styles.change} data-marked={i < marked || undefined}>
              <span className={styles.changeIcon} aria-hidden>
                {i < marked ? (
                  i === 0 && changes.reachesAdded?.length ? (
                    <Globe />
                  ) : (
                    <PencilLine />
                  )
                ) : (
                  <Sparkles />
                )}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.changeNone}>Nothing it can reach or do has changed.</p>
      )}
    </section>
  );
}

export interface AppSettingsFieldsProps extends Omit<
  ComponentProps<'div'>,
  'children' | 'onChange'
> {
  settings: readonly AppSettingView[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
  /** Names the group: “What Plant diary needs from you”. */
  label: string;
}

/**
 * The settings an app needs that have no value yet, typed by the person right
 * on the card: the assistant never sees them (ADR 0061). A secret is masked
 * with a toggle, kept out of password managers' autofill, and **Get it**
 * opens the page that makes one in a tab of its own.
 */
export function AppSettingsFields({
  settings,
  values,
  onChange,
  disabled,
  label,
  className,
  ...props
}: AppSettingsFieldsProps) {
  const titleId = useId();
  if (!settings.length) return null;
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={cx(styles.settings, className)}
      {...props}
    >
      <p id={titleId} className={styles.sectionLabel}>
        {label}
      </p>
      {settings.map((setting) => (
        <Field key={setting.key} disabled={disabled} className={styles.setting}>
          <div className={styles.settingHead}>
            <Field.Label size="sm" optional={setting.optional}>
              {setting.label}
            </Field.Label>
            {isWebLink(setting.link) && (
              <a
                href={setting.link}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.getIt}
                aria-label={`Get ${setting.label} (opens in a new tab)`}
              >
                Get it
                <ExternalLink aria-hidden />
              </a>
            )}
          </div>
          {setting.secret ? (
            <PasswordInput
              size="sm"
              value={values[setting.key] ?? ''}
              onChange={(e) => onChange(setting.key, e.target.value)}
              autoComplete="off"
              showLabel={`Show ${setting.label}`}
              hideLabel={`Hide ${setting.label}`}
              // It's this app's key, not a sign-in: no password manager should offer one.
              data-1p-ignore=""
              data-lpignore="true"
              data-bwignore=""
              maxLength={4096}
            />
          ) : (
            <Input
              size="sm"
              value={values[setting.key] ?? ''}
              onChange={(e) => onChange(setting.key, e.target.value)}
              autoComplete="off"
              maxLength={4096}
            />
          )}
          {setting.help && <Field.Description>{setting.help}</Field.Description>}
        </Field>
      ))}
    </div>
  );
}
