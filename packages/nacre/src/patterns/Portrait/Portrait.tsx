import { Check, Plus, Sparkles, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import styles from './Portrait.module.css';

/** One thing about you, on a card: "SDM at Amazon", or "Lina" with "daughter". */
export interface PortraitFact {
  id: string;
  kind: string;
  text: string;
  /** Beside it, quieter: who a person is to you, a date. */
  detail?: string;
}

/** A card of the portrait: what it holds, and an example of it. */
export interface PortraitCard {
  kind: string;
  title: string;
  icon: ReactNode;
  /** Shown while the card is empty, and as the placeholder when adding. */
  example: string;
  /** A second field for a detail (people: "who they are to you"). */
  detailLabel?: string;
  detailExample?: string;
}

export interface PortraitProps {
  name: string;
  onNameChange: (name: string) => void;
  /** One line under the name, drawn from the cards. */
  summary?: string;
  cards: PortraitCard[];
  facts: PortraitFact[];
  /** Read from your own words, waiting for Keep or Dismiss. */
  suggested?: PortraitFact[];
  onAdd: (fact: Omit<PortraitFact, 'id'>) => void;
  onChange: (fact: PortraitFact) => void;
  onRemove: (id: string) => void;
  onKeep?: (id: string) => void;
  onKeepAll?: () => void;
  onDismiss?: (id: string) => void;
  className?: string;
}

/**
 * About you as a portrait: your name, a line that sums you up, and a card for
 * each part of your life (work, home, people…) holding short facts you add,
 * change or take away in place. Facts read from your own words arrive as
 * suggestions, outlined, until you keep them. Nothing is a form to fill in.
 */
export function Portrait({
  name,
  onNameChange,
  summary,
  cards,
  facts,
  suggested = [],
  onAdd,
  onChange,
  onRemove,
  onKeep,
  onKeepAll,
  onDismiss,
  className,
}: PortraitProps) {
  return (
    <section className={cx(styles.portrait, className)} aria-label="About you">
      <header className={styles.hero}>
        <Avatar size="xl" name={name.trim() || 'You'} className={styles.avatar} />
        <div className={styles.who}>
          <input
            className={styles.name}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Your name"
            aria-label="What should I call you?"
            maxLength={80}
            autoComplete="given-name"
            spellCheck={false}
          />
          <p className={styles.summary}>
            {summary || 'Add a few things below, and every chat starts knowing them.'}
          </p>
        </div>
      </header>
      {suggested.length > 0 && (
        <div className={styles.suggestBar} role="status">
          <Sparkles aria-hidden />
          <span>
            I read {suggested.length === 1 ? 'one card' : `${suggested.length} cards`} in your
            words. Keep what’s right.
          </span>
          {onKeepAll && suggested.length > 1 && (
            <Button size="sm" variant="soft" onClick={onKeepAll}>
              Keep all
            </Button>
          )}
        </div>
      )}
      <div className={styles.grid}>
        {cards.map((card) => (
          <FactCard
            key={card.kind}
            card={card}
            facts={facts.filter((f) => f.kind === card.kind)}
            suggested={suggested.filter((f) => f.kind === card.kind)}
            onAdd={onAdd}
            onChange={onChange}
            onRemove={onRemove}
            onKeep={onKeep}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

function FactCard({
  card,
  facts,
  suggested,
  onAdd,
  onChange,
  onRemove,
  onKeep,
  onDismiss,
}: {
  card: PortraitCard;
  facts: PortraitFact[];
  suggested: PortraitFact[];
  onAdd: PortraitProps['onAdd'];
  onChange: PortraitProps['onChange'];
  onRemove: PortraitProps['onRemove'];
  onKeep?: PortraitProps['onKeep'];
  onDismiss?: PortraitProps['onDismiss'];
}) {
  const titleId = useId();
  const [adding, setAdding] = useState(false);
  const empty = facts.length === 0 && suggested.length === 0;
  return (
    <section className={styles.card} aria-labelledby={titleId} data-empty={empty || undefined}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden>
          {card.icon}
        </span>
        <h3 id={titleId} className={styles.cardTitle}>
          {card.title}
        </h3>
      </div>
      {!empty && (
        <ul className={styles.chips}>
          {facts.map((fact) => (
            <li key={fact.id}>
              <FactChip fact={fact} card={card} onChange={onChange} onRemove={onRemove} />
            </li>
          ))}
          {suggested.map((fact) => (
            <li key={fact.id} className={styles.suggested}>
              <span className={styles.chipText}>
                {fact.text}
                {fact.detail && <span className={styles.chipDetail}>{fact.detail}</span>}
              </span>
              {onKeep && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Keep “${fact.text}”`}
                  onClick={() => onKeep(fact.id)}
                >
                  <Check />
                </IconButton>
              )}
              {onDismiss && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Dismiss “${fact.text}”`}
                  onClick={() => onDismiss(fact.id)}
                >
                  <X />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <FactForm
          card={card}
          submitLabel="Add"
          onSubmit={(text, detail) => {
            onAdd({ kind: card.kind, text, ...(detail && { detail }) });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className={styles.cardFoot}>
          {empty && <span className={styles.example}>e.g. {card.example}</span>}
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Plus />}
            aria-label={`Add to ${card.title}`}
            onClick={() => setAdding(true)}
          >
            Add
          </Button>
        </div>
      )}
    </section>
  );
}

function FactChip({
  fact,
  card,
  onChange,
  onRemove,
}: {
  fact: PortraitFact;
  card: PortraitCard;
  onChange: PortraitProps['onChange'];
  onRemove: PortraitProps['onRemove'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.chip}
          data-lustre=""
          aria-label={fact.detail ? `${fact.text}, ${fact.detail}` : fact.text}
        >
          <span className={styles.chipText}>
            {fact.text}
            {fact.detail && <span className={styles.chipDetail}>{fact.detail}</span>}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Content align="start" aria-label={`Change “${fact.text}”`} className={styles.edit}>
        <FactForm
          card={card}
          initial={fact}
          submitLabel="Save"
          onSubmit={(text, detail) => {
            onChange({ ...fact, text, ...(detail ? { detail } : { detail: undefined }) });
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
          onRemove={() => {
            onRemove(fact.id);
            setOpen(false);
          }}
        />
      </Popover.Content>
    </Popover.Root>
  );
}

function FactForm({
  card,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onRemove,
}: {
  card: PortraitCard;
  initial?: PortraitFact;
  submitLabel: string;
  onSubmit: (text: string, detail: string | undefined) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  // The person just pressed Add or a chip: the words are where they type next.
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const escape = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onCancel();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSubmit(t, detail.trim() || undefined);
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <Input
        ref={first}
        size="sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={escape}
        placeholder={card.example}
        aria-label={card.title}
        maxLength={160}
      />
      {card.detailLabel && (
        <Input
          size="sm"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          onKeyDown={escape}
          placeholder={card.detailExample}
          aria-label={card.detailLabel}
          maxLength={160}
        />
      )}
      <div className={styles.formActions}>
        {onRemove && (
          <Button size="sm" variant="ghost" tone="danger" onClick={onRemove}>
            Remove
          </Button>
        )}
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
