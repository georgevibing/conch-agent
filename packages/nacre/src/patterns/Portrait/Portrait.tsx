import { Check, Plus, Sparkle, Sparkles, X } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { AvatarPicker } from '../AvatarPicker';
import { FactChip, FactEditor } from './FactChip';
import { PortraitTell } from './PortraitTell';
import styles from './Portrait.module.css';

/** One thing about you: "SDM at Amazon", or "Lina" with "daughter". */
export interface PortraitFact {
  id: string;
  kind: string;
  text: string;
  /** Beside it, quieter: who a person is to you, a date. */
  detail?: string;
  /** Learned from a chat, not told: a small spark marks it, and its name says so. */
  learned?: boolean;
  /** Where it came from, shown when it's opened: “Learned from a chat on 3 May”. */
  source?: ReactNode;
  /** Beside where it came from, one way there: “Open the chat”. */
  sourceAction?: { label: string; onSelect: () => void };
  /** Just arrived: it surfaces with a glint. */
  arriving?: boolean;
  /** The longest its words may be when corrected (160 unless said). */
  maxLength?: number;
}

/** A part of your life on the portrait: what it holds, and how it asks while it's empty. */
export interface PortraitGroup {
  kind: string;
  title: string;
  icon: ReactNode;
  /** While there's nothing in it, the question it asks: “Who’s close to you?”. */
  invite: string;
  /** The placeholder when adding to it. */
  example: string;
  /** A second field for a detail (people: "who they are to you"). */
  detailLabel?: string;
  detailExample?: string;
}

export interface PortraitProps {
  name: string;
  onNameChange: (name: string) => void;
  /** Your photo, if you've set one; your initial shows otherwise. */
  photo?: string;
  /** With these, pressing your initial adds a photo (and, once set, changes or removes it). */
  onPhotoSave?: (photo: Blob) => Promise<void> | void;
  onPhotoRemove?: () => Promise<void> | void;
  /** One line under the name, drawn from what it knows. */
  summary?: string;
  groups: PortraitGroup[];
  facts: PortraitFact[];
  /** Read from your own words, waiting for Keep or Dismiss. */
  suggested?: PortraitFact[];
  onAdd: (fact: { kind: string; text: string; detail?: string }) => void;
  onChange: (fact: PortraitFact) => void;
  /** Called once the chip has folded away. */
  onRemove: (id: string) => void;
  onKeep?: (id: string) => void;
  onKeepAll?: () => void;
  onDismiss?: (id: string) => void;
  /** With these, a line at the foot to tell it something in your own words. */
  onTell?: (text: string, kind: string) => void;
  guessKind?: (text: string) => string;
  /** Who's listening, by name. */
  assistant?: string;
  /** How many chips a group shows before “N more”. */
  limit?: number;
  className?: string;
}

/**
 * What the assistant knows about you, as a portrait rather than a form: your
 * face and your name, a line that sums you up, and the parts of your life
 * (how you like answers, people, work, places…) as rows of chips. What you
 * told it and what it learned from your chats sit together; a small spark
 * marks the learned, and opening a chip says where it came from.
 *
 * Calm at rest; alive where you touch it. A chip opens in place to be
 * corrected or removed, and folds away when it goes. A new one surfaces with
 * a glint. A part with nothing in it isn't a blank: it's a question, waiting
 * at the foot, and one line there takes whatever you'd like to tell it.
 */
export function Portrait({
  name,
  onNameChange,
  photo,
  onPhotoSave,
  onPhotoRemove,
  summary,
  groups,
  facts,
  suggested = [],
  onAdd,
  onChange,
  onRemove,
  onKeep,
  onKeepAll,
  onDismiss,
  onTell,
  guessKind,
  assistant = 'Conch',
  limit = 8,
  className,
}: PortraitProps) {
  // Groups opened from their question, still empty: they show, with the words open.
  const [opened, setOpened] = useState<string[]>([]);
  const filled = (kind: string) =>
    facts.some((f) => f.kind === kind) || suggested.some((f) => f.kind === kind);
  const shown = groups.filter((g) => filled(g.kind) || opened.includes(g.kind));
  const waiting = groups.filter((g) => !shown.includes(g));
  const learned = facts.filter((f) => f.learned).length;
  const told = facts.length - learned;
  const nothing = facts.length === 0 && suggested.length === 0;
  const invitesId = useId();
  // A question opened and let go of, empty, gives the focus back to its question.
  const invites = useRef(new Map<string, HTMLButtonElement>());
  const letGo = (kind: string, added: boolean) => {
    setOpened((o) => o.filter((k) => k !== kind));
    if (!added) requestAnimationFrame(() => invites.current.get(kind)?.focus());
  };

  return (
    <section className={cx(styles.portrait, className)} aria-label="About you">
      <header className={styles.hero}>
        {onPhotoSave && onPhotoRemove ? (
          <AvatarPicker
            name={name.trim() || 'You'}
            src={photo}
            onSave={onPhotoSave}
            onRemove={onPhotoRemove}
          />
        ) : (
          <Avatar size="xl" name={name.trim() || 'You'} src={photo} className={styles.avatar} />
        )}
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
            data-nc-large-type=""
          />
          <p className={styles.summary}>
            {summary ||
              (nothing
                ? 'Tell me a little about you, and every chat starts knowing it.'
                : 'Every chat starts knowing what’s here.')}
          </p>
          {!nothing && (
            <p className={styles.tally}>
              {told > 0 && (
                <span>{told === 1 ? '1 thing you told me' : `${told} things you told me`}</span>
              )}
              {learned > 0 && (
                <span className={styles.tallyLearned}>
                  <Sparkle aria-hidden />
                  {learned} learned from your chats
                </span>
              )}
            </p>
          )}
        </div>
      </header>

      {suggested.length > 0 && (
        <div className={styles.suggestBar} role="status">
          <Sparkles aria-hidden />
          <span>
            I read {suggested.length === 1 ? 'one thing' : `${suggested.length} things`} in your
            words. Keep what’s right.
          </span>
          {onKeepAll && suggested.length > 1 && (
            <Button size="sm" variant="soft" onClick={onKeepAll}>
              Keep all
            </Button>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <div className={styles.strands}>
          {shown.map((group) => (
            <Strand
              key={group.kind}
              group={group}
              facts={facts.filter((f) => f.kind === group.kind)}
              suggested={suggested.filter((f) => f.kind === group.kind)}
              limit={limit}
              startAdding={opened.includes(group.kind) && !filled(group.kind)}
              onStopAdding={(added) => letGo(group.kind, added)}
              onAdd={onAdd}
              onChange={onChange}
              onRemove={onRemove}
              onKeep={onKeep}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}

      {waiting.length > 0 && (
        <div className={styles.invites}>
          <span className={styles.invitesLabel} id={invitesId}>
            {nothing ? 'Start anywhere' : 'Also tell me'}
          </span>
          <ul className={styles.inviteList} aria-labelledby={invitesId}>
            {waiting.map((group) => (
              <li key={group.kind}>
                <button
                  ref={(el) => {
                    if (el) invites.current.set(group.kind, el);
                    else invites.current.delete(group.kind);
                  }}
                  type="button"
                  className={styles.invite}
                  onClick={() => setOpened((o) => [...o, group.kind])}
                >
                  <span className={styles.inviteIcon} aria-hidden>
                    {group.icon}
                  </span>
                  {group.invite}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onTell && guessKind && (
        <PortraitTell
          groups={groups}
          guess={guessKind}
          onTell={onTell}
          assistant={assistant}
          className={styles.tellFoot}
        />
      )}
    </section>
  );
}

function Strand({
  group,
  facts,
  suggested,
  limit,
  startAdding,
  onStopAdding,
  onAdd,
  onChange,
  onRemove,
  onKeep,
  onDismiss,
}: {
  group: PortraitGroup;
  facts: PortraitFact[];
  suggested: PortraitFact[];
  limit: number;
  startAdding: boolean;
  /** `added`: it holds something now, and stays. */
  onStopAdding: (added: boolean) => void;
  onAdd: PortraitProps['onAdd'];
  onChange: PortraitProps['onChange'];
  onRemove: PortraitProps['onRemove'];
  onKeep?: PortraitProps['onKeep'];
  onDismiss?: PortraitProps['onDismiss'];
}) {
  const titleId = useId();
  const [adding, setAdding] = useState(startAdding);
  const [all, setAll] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const comeBack = () => requestAnimationFrame(() => addButton.current?.focus());
  // A new one is always in sight, wherever it falls in the order.
  const visible = all ? facts : facts.filter((f, i) => i < limit || f.arriving);
  const more = facts.length - visible.length;
  const stopAdding = (added: boolean) => {
    setAdding(false);
    onStopAdding(added);
    if (added || facts.length > 0) comeBack();
  };

  return (
    <section className={styles.strand} aria-labelledby={titleId}>
      <div className={styles.strandHead}>
        <span className={styles.strandIcon} aria-hidden>
          {group.icon}
        </span>
        <h3 id={titleId} className={styles.strandTitle}>
          {group.title}
        </h3>
      </div>
      <ul className={styles.chips}>
        {visible.map((fact) => (
          <li key={fact.id}>
            <FactChip
              text={fact.text}
              detail={fact.detail}
              learned={fact.learned}
              source={fact.source}
              sourceAction={fact.sourceAction}
              arriving={fact.arriving}
              label={group.title}
              placeholder={group.example}
              detailLabel={group.detailLabel}
              detailExample={group.detailExample}
              maxLength={fact.maxLength}
              onSave={(text, detail) => {
                if (text === fact.text && detail === fact.detail) return;
                const { detail: _was, ...rest } = fact;
                onChange({ ...rest, text, ...(detail && { detail }) });
              }}
              onRemove={() => {
                onRemove(fact.id);
                comeBack();
              }}
            />
          </li>
        ))}
        {suggested.map((fact) => (
          <li key={fact.id} className={styles.suggested}>
            <span className={styles.chipText}>
              <span className={styles.chipWords}>{fact.text}</span>
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
        {more > 0 && (
          <li>
            <button type="button" className={styles.more} onClick={() => setAll(true)}>
              {more} more
            </button>
          </li>
        )}
        {adding ? (
          <li className={styles.adding}>
            <FactEditor
              label={group.title}
              placeholder={group.example}
              detailLabel={group.detailLabel}
              detailExample={group.detailExample}
              submitLabel="Add"
              onSubmit={(text, detail) => {
                onAdd({ kind: group.kind, text, ...(detail && { detail }) });
                stopAdding(true);
              }}
              onCancel={() => stopAdding(false)}
            />
          </li>
        ) : (
          <li>
            <button
              ref={addButton}
              type="button"
              className={styles.add}
              aria-label={`Add to ${group.title}`}
              title={`Add to ${group.title}`}
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden />
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
