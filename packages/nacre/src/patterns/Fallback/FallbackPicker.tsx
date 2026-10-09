import { ArrowDown, ArrowUp } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { IconButton } from '../../components/IconButton';
import { RadioGroup } from '../../components/RadioGroup';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { formatMoney, formatResetAt, lowerFirst } from '../Usage/format';
import { useNow } from '../Usage/useNow';
import styles from './FallbackPicker.module.css';

/** One plan or key that could carry on, with what it would cost and say (ADR 0126). */
export interface FallbackOption {
  /** The provider that answers for it. */
  id: string;
  /** "Codex", or "Codex · ada@example.com" when two would read the same. */
  name: string;
  /** Who it is: "ChatGPT Plus · ada@example.com", "Key …4f2c". */
  account?: string;
  /** `plan`: included in what you already pay for. `metered`: pay per use. */
  billing: 'plan' | 'metered';
  room: 'room' | 'low' | 'none' | 'unknown';
  /** Share left of its tightest window, 0–100. */
  leftPercent?: number;
  /** When it has room again, or its tightest window resets. */
  resetsAt?: number;
  /** About what a reply costs, on a key. */
  perReplyUsd?: number;
  /** The model it answers with: "GPT-5.5". */
  model?: string;
  /** Why Automatic passes it over right now. */
  skip?: string;
}

export const FALLBACK_AUTO = 'auto';
export const FALLBACK_WAIT = 'wait';

/**
 * The facts of one choice, each a few words, in the order people weigh them:
 * whether it has room and until when, what it costs, and the model it answers with.
 */
export function fallbackFacts(option: FallbackOption, now: number): string[] {
  const facts: string[] = [];
  const at = (t: number) => formatResetAt(t, now);
  if (option.room === 'none')
    facts.push(
      option.skip && option.skip !== 'At its limit'
        ? option.skip
        : `At its limit${option.resetsAt !== undefined ? ` until ${at(option.resetsAt)}` : ''}`,
    );
  else if (option.leftPercent !== undefined)
    facts.push(
      `${option.leftPercent}% left${option.resetsAt !== undefined ? ` · resets ${at(option.resetsAt)}` : ''}`,
    );
  facts.push(
    option.billing === 'plan'
      ? 'Included in your plan'
      : option.perReplyUsd !== undefined
        ? `Pay per use · about ${formatMoney(Math.max(option.perReplyUsd, 0.01))} a reply`
        : 'Pay per use',
  );
  if (option.model) facts.push(`Answers with ${option.model}`);
  if (option.skip && option.room !== 'none') facts.push(option.skip);
  return facts;
}

/** Whether Automatic would use it now. */
const usable = (o: FallbackOption) => !o.skip && o.room !== 'none';

/** "Codex, then OpenRouter, then the Anthropic API." */
function inOrder(options: readonly FallbackOption[]): string {
  return options.map((o) => o.name).join(', then ');
}

export interface FallbackPickerProps {
  /** The provider whose limit this is about: "Claude Code". */
  from: string;
  /** When its own limit resets, if known. */
  fromResetsAt?: number;
  /** `auto`, `wait`, or one option's id. */
  value: string;
  onValueChange: (value: string) => void;
  /** In Automatic's order. */
  options: readonly FallbackOption[];
  /** The new order, by id. Without it, the order is shown but can't be changed. */
  onReorder?: (ids: string[]) => void;
  /** The last resort, the model on this computer: whether it may answer. */
  local?: { name?: string; checked: boolean; onCheckedChange: (checked: boolean) => void };
  /** Whether a chat goes back to `from` once its limit resets. */
  back?: { checked: boolean; onCheckedChange: (checked: boolean) => void };
  /** Whether Automatic may use pay-per-use keys, not only plans already paid for. */
  paid?: { checked: boolean; onCheckedChange: (checked: boolean) => void };
  /** Names the group, e.g. the id of a heading "At a usage limit". */
  'aria-labelledby'?: string;
  /** For stories and tests. */
  now?: number;
  className?: string;
}

/**
 * Who carries on when a provider reaches its usage limit (ADR 0126). One
 * radio list, best first: **Automatic** (the next with room, in an order you
 * can change), **Wait until it resets**, then each plan or key by name with
 * what it has left, what it costs and the model it answers with. The model on
 * this computer is the last step of every order, and coming back once the
 * limit resets is a switch of its own.
 */
export function FallbackPicker({
  from,
  fromResetsAt,
  value,
  onValueChange,
  options,
  onReorder,
  local,
  back,
  paid,
  now: fixed,
  className,
  ...props
}: FallbackPickerProps) {
  const orderId = useId();
  const now = useNow(60_000, fixed);
  const auto = value === FALLBACK_AUTO;
  const waiting = value === FALLBACK_WAIT;
  const first = options.find(usable);
  const description: ReactNode = options.length ? (
    <>
      {inOrder(options)}.{' '}
      {first ? `Right now, ${first.name} would answer.` : 'None has room right now.'}
    </>
  ) : (
    'Connect another provider, and it carries on here.'
  );
  const move = (from: number, to: number) => {
    if (!onReorder || to < 0 || to >= options.length) return;
    const ids = options.map((o) => o.id);
    const [id] = ids.splice(from, 1);
    if (id !== undefined) ids.splice(to, 0, id);
    onReorder(ids);
  };

  return (
    <div className={cx(styles.picker, className)}>
      <RadioGroup value={value} onValueChange={onValueChange} {...props}>
        <RadioGroup.Item
          value={FALLBACK_AUTO}
          label={
            <span className={styles.title}>
              Automatic: the next one with room <Badge size="sm">Recommended</Badge>
            </span>
          }
          description={description}
        />
        <RadioGroup.Item
          value={FALLBACK_WAIT}
          label="Wait until it resets"
          description={
            fromResetsAt !== undefined
              ? `${from} answers again ${formatResetAt(fromResetsAt, now)}.`
              : `Messages wait for ${from}.`
          }
        />
        {options.map((option) => (
          <RadioGroup.Item
            key={option.id}
            value={option.id}
            label={
              <span className={styles.title}>
                {option.name}
                {option.account && <span className={styles.account}> {option.account}</span>}
              </span>
            }
            description={fallbackFacts(option, now).join(' · ')}
          />
        ))}
      </RadioGroup>

      {auto && options.length > 1 && (
        <div className={styles.order}>
          <p id={orderId} className={styles.orderTitle}>
            In this order
          </p>
          <ol aria-labelledby={orderId} className={styles.list}>
            {options.map((option, index) => (
              <li
                key={option.id}
                className={styles.step}
                data-skipped={!usable(option) || undefined}
              >
                <span className={styles.number} aria-hidden>
                  {index + 1}
                </span>
                <span className={styles.stepName}>
                  {option.name}
                  {!usable(option) && (
                    <span className={styles.stepNote}>
                      {`Skipped for now: ${lowerFirst(option.skip ?? 'no room')}`}
                    </span>
                  )}
                </span>
                {onReorder && (
                  <span className={styles.moves}>
                    <IconButton
                      size="sm"
                      label={`Move ${option.name} up`}
                      tooltip={false}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={`Move ${option.name} down`}
                      tooltip={false}
                      disabled={index === options.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown />
                    </IconButton>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(local || (back && !waiting) || (paid && auto)) && (
        <div className={styles.switches}>
          {paid && auto && (
            <Switch
              labelPosition="start"
              checked={paid.checked}
              onCheckedChange={paid.onCheckedChange}
              label="Pay-per-use keys too"
              description={
                paid.checked
                  ? 'After your plans, the cheapest key with room answers, within your monthly limit.'
                  : 'Only plans you already pay for carry on. Keys that charge per reply wait.'
              }
            />
          )}
          {local && (
            <Switch
              labelPosition="start"
              checked={local.checked}
              onCheckedChange={local.onCheckedChange}
              label={
                waiting
                  ? 'Answer offline with the model on this computer'
                  : auto
                    ? 'And if none has room, the model on this computer'
                    : 'If it has no room either, the model on this computer'
              }
              description={
                local.name
                  ? waiting
                    ? `${local.name} answers with no internet.`
                    : `${local.name} answers, free. It answers while you’re offline too.`
                  : 'No model here yet, so messages wait and go by themselves.'
              }
            />
          )}
          {back && !waiting && (
            <Switch
              labelPosition="start"
              checked={back.checked}
              onCheckedChange={back.onCheckedChange}
              label={`Back to ${from} once it resets`}
              description={
                back.checked
                  ? `Each chat goes back to ${from} by itself.`
                  : 'A chat stays with whoever carried it on.'
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
