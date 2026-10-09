import {
  BrainCircuit,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  MessagesSquare,
  Play,
  Quote,
} from 'lucide-react';
import { useId, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { PasswordInput } from '../../components/PasswordInput';
import { cx } from '../../utils/cx';
import { StreamingText } from '../StreamingText';
import styles from './PartReview.module.css';
import { isWebLink, type AppSettingView } from './types';

/** How a provider speaks (`ProviderSpeaks`), in a few words. */
const SPEAKS: Record<PartProviderView['speaks'], string> = {
  openai: 'Speaks OpenAI’s chat',
  anthropic: 'Speaks Anthropic’s Messages',
  code: 'Runs its own sealed code',
};

/** A provider an app brings (`AppProviderPart`), as the card shows it. */
export interface PartProviderView {
  /** "Fireworks AI". */
  name: string;
  speaks: 'openai' | 'anthropic' | 'code';
  models: readonly {
    id: string;
    name?: string;
    context?: number;
    price?: { input: number; output: number };
  }[];
  /** What the person types; absent for one with no key. */
  key?: { label: string; help?: string; link?: string; optional?: boolean };
  /** The hosts it reaches, for the line that says where its key goes. */
  reaches: readonly string[];
}

/** A chat app an app brings (`AppChannelPart`), as the card shows it. */
export interface PartChannelView {
  /** "Zulip". */
  name: string;
  fields: readonly (AppSettingView & { placeholder?: string })[];
  /** What to press in the chat app itself, one sentence each. */
  steps: readonly string[];
  receives: 'poll' | 'webhook';
}

/** Mirrors `AppPartTest`, with the two states before it answers. */
export type PartTestView =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'passed'; said: string; model?: string; ms: number }
  | { state: 'failed'; message: string; field?: string };

/** What the person typed for it: a provider's key, a chat app's fields. */
export interface PartValues {
  key: string;
  fields: Record<string, string>;
}

export interface PartReviewProps extends Omit<ComponentProps<'section'>, 'children'> {
  provider?: PartProviderView;
  channel?: PartChannelView;
  values: PartValues;
  onValuesChange: (values: PartValues) => void;
  test: PartTestView;
  /** **Test it**: one real line from the provider, or who the chat app's bot is. */
  onTest?: () => void;
  disabled?: boolean;
}

/** Whether the person has typed everything the test needs. */
export function partReady(
  part: Pick<PartReviewProps, 'provider' | 'channel'>,
  values: PartValues,
): boolean {
  if (part.provider)
    return !part.provider.key || part.provider.key.optional || Boolean(values.key.trim());
  if (part.channel)
    return part.channel.fields.every((f) => f.optional || Boolean(values.fields[f.key]?.trim()));
  return true;
}

const per = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${+n.toFixed(2)}`);
const window = (tokens: number) =>
  tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

/**
 * A provider or a chat app a Conch app brings, reviewed before it's added
 * (ADR 0122): what it is and where its key goes, the key typed right here
 * (the assistant never sees it), and **Test it** — a real one-line answer
 * that streams in, in the provider's own words, or the bot the chat app
 * says it is. The card's **Add** waits for a test that passed whenever
 * there's something to test with.
 */
export function PartReview({
  provider,
  channel,
  values,
  onValuesChange,
  test,
  onTest,
  disabled,
  className,
  ...props
}: PartReviewProps) {
  const titleId = useId();
  const resultId = useId();
  const testing = test.state === 'testing';
  const ready = partReady({ provider, channel }, values);
  const name = provider?.name ?? channel?.name ?? '';
  const field = (
    setting: AppSettingView & { placeholder?: string },
    value: string,
    set: (v: string) => void,
  ) => (
    <Field
      key={setting.key}
      disabled={disabled || testing}
      invalid={test.state === 'failed' && test.field === setting.key}
      className={styles.field}
    >
      <div className={styles.fieldHead}>
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
      {setting.secret !== false ? (
        <PasswordInput
          size="sm"
          value={value}
          onChange={(e) => set(e.target.value)}
          autoComplete="off"
          placeholder={setting.placeholder}
          showLabel={`Show ${setting.label}`}
          hideLabel={`Hide ${setting.label}`}
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          maxLength={4096}
        />
      ) : (
        <Input
          size="sm"
          value={value}
          onChange={(e) => set(e.target.value)}
          autoComplete="off"
          placeholder={setting.placeholder}
          maxLength={4096}
        />
      )}
      {setting.help && <Field.Description>{setting.help}</Field.Description>}
    </Field>
  );

  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.review, className)}
      data-part={provider ? 'provider' : 'channel'}
      data-test={test.state}
      {...props}
    >
      <div className={styles.head}>
        <span className={styles.mark} aria-hidden>
          {provider ? <BrainCircuit /> : <MessagesSquare />}
        </span>
        <div className={styles.headText}>
          <p id={titleId} className={styles.title}>
            {provider ? `${name}, as a provider` : `Talk to me on ${name}`}
          </p>
          <p className={styles.meta}>
            {provider
              ? `${SPEAKS[provider.speaks]} · ${
                  provider.key
                    ? `its key goes only to ${provider.reaches.join(', ') || 'its own site'}`
                    : 'no key needed'
                }`
              : channel?.receives === 'webhook'
                ? `${name} delivers to Conch’s public address · it can’t read your chats or use your apps`
                : `Conch asks ${name} for messages from this computer · it can’t read your chats or use your apps`}
          </p>
        </div>
      </div>

      {provider && provider.models.length > 0 && (
        <ul className={styles.models} aria-label={`${name}’s models`}>
          {provider.models.map((m) => (
            <li key={m.id} className={styles.model}>
              <span className={styles.modelName}>{m.name ?? m.id}</span>
              {m.context && <span className={styles.modelFact}>{window(m.context)}</span>}
              {m.price && (
                <span className={styles.modelFact}>
                  {per(m.price.input)} in · {per(m.price.output)} out
                  <span className="nc-visually-hidden"> per million tokens</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {provider && !provider.models.length && (
        <p className={styles.meta}>Its models are read from {name} when it’s added.</p>
      )}

      {channel && channel.steps.length > 0 && (
        <ol className={styles.steps} aria-label={`In ${name}`}>
          {channel.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      <div className={styles.fields}>
        {provider?.key &&
          field(
            {
              key: 'key',
              label: provider.key.label,
              help: provider.key.help,
              link: provider.key.link,
              optional: provider.key.optional,
              secret: true,
            },
            values.key,
            (key) => onValuesChange({ ...values, key }),
          )}
        {channel?.fields.map((f) =>
          field(f, values.fields[f.key] ?? '', (v) =>
            onValuesChange({ ...values, fields: { ...values.fields, [f.key]: v } }),
          ),
        )}
      </div>

      <div className={styles.testRow}>
        {onTest && (
          <Button
            size="sm"
            variant="surface"
            leadingIcon={<Play />}
            onClick={onTest}
            loading={testing}
            disabled={disabled || !ready}
            aria-describedby={resultId}
          >
            {test.state === 'passed' || test.state === 'failed' ? 'Test again' : 'Test it'}
          </Button>
        )}
        <p id={resultId} className={styles.hint} role="status" aria-live="polite">
          {test.state === 'testing'
            ? provider
              ? `Asking ${name} for one short line…`
              : `Asking ${name} who the bot is…`
            : test.state === 'idle'
              ? ready
                ? provider
                  ? `One short question, with your key, before you add it.`
                  : `Conch checks it with ${name} before you add it.`
                : provider?.key
                  ? `Paste your ${provider.key.label} to test it.`
                  : `Paste what ${name} gave you to test it.`
              : ''}
        </p>
      </div>

      {test.state === 'passed' &&
        (provider ? (
          <figure className={styles.said}>
            <Quote className={styles.quote} aria-hidden />
            <blockquote className={styles.saidText}>
              <StreamingText text={test.said} />
            </blockquote>
            <figcaption className={styles.saidBy}>
              <CircleCheck aria-hidden />
              {test.model
                ? `${provider.models.find((m) => m.id === test.model)?.name ?? test.model} answered`
                : `${name} answered`}{' '}
              in {seconds(test.ms)}
            </figcaption>
          </figure>
        ) : (
          <p className={styles.passed}>
            <CircleCheck aria-hidden />
            <span>
              {test.said}. After you add it, say hello from {name}: Conch lets you in.
            </span>
          </p>
        ))}
      {test.state === 'failed' && (
        <p className={styles.failed} role="alert">
          <CircleAlert aria-hidden />
          <span>{test.message}</span>
        </p>
      )}
    </section>
  );
}
