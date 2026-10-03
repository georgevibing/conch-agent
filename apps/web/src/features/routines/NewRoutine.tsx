import { Button, Dialog, Stack, Text, Textarea } from '@conch/nacre';
import { ArrowRight, PencilRuler } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useLive } from '../../live/LiveProvider';
import { useLiveStore } from '../../live/store';
import { browserTimezone } from './api';
import { routineIcon } from './icon';
import { RoutineEditor, type RoutineDraft } from './RoutineEditor';
import styles from './Routines.module.css';
import { templates, type Template } from './templates';

/**
 * The front door: say what you want in your own words (Conch drafts it in a
 * chat), start from an idea, or set every detail yourself.
 */
export function NewRoutine({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [editor, setEditor] = useState<RoutineDraft | null>(null);
  const live = useLive();
  const navigate = useNavigate();

  const describe = () => {
    const request = text.trim();
    if (!request) return;
    const id = live.send(`Set up a routine for me: ${request}`);
    onOpenChange(false);
    setText('');
    // Follow the new chat once the server creates it.
    const off = useLiveStore.subscribe((s) => {
      const conversationId = s.created[id];
      if (conversationId) {
        off();
        void navigate(`/c/${conversationId}`);
      }
    });
    void navigate('/');
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Content
          size="lg"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Header>
            <Dialog.Title>New routine</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap={6}>
              <Stack gap={2}>
                <label htmlFor="describe-routine" className={styles.describeLabel}>
                  What should Conch do, and when?
                </label>
                <Textarea
                  ref={inputRef}
                  id="describe-routine"
                  autosize
                  minRows={2}
                  maxRows={6}
                  value={text}
                  placeholder="Every weekday at 8am, tell me what’s on my calendar. Or: tell me when Anna replies."
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      describe();
                    }
                  }}
                />
                <Stack direction="row" justify="between" align="center" gap={3} wrap>
                  <Text size="xs" tone="subtle">
                    Conch drafts it in a chat. Nothing runs until you turn it on.
                  </Text>
                  <Button onClick={describe} disabled={!text.trim()} trailingIcon={<ArrowRight />}>
                    Draft it
                  </Button>
                </Stack>
              </Stack>

              <Stack gap={2}>
                <Text size="sm" weight="medium" tone="muted">
                  Or start from an idea
                </Text>
                {/* Routines start at a time, or when something happens (ADR 0056). */}
                {[
                  { id: 'every', label: 'Every…', items: templates.filter((t) => !t.when) },
                  {
                    id: 'when',
                    label: 'When…, and free until it happens',
                    items: templates.filter((t) => t.when),
                  },
                ].map((group) => (
                  <Stack key={group.id} gap={1.5}>
                    <Text size="xs" tone="subtle" id={`ideas-${group.id}`}>
                      {group.label}
                    </Text>
                    <div
                      className={styles.ideas}
                      role="group"
                      aria-labelledby={`ideas-${group.id}`}
                    >
                      {group.items.map((t: Template) => (
                        <button
                          key={t.id}
                          type="button"
                          className={styles.idea}
                          data-lustre=""
                          onClick={() => {
                            onOpenChange(false);
                            setEditor({ ...t, timezone: browserTimezone() });
                          }}
                        >
                          <span className={styles.ideaIcon} aria-hidden>
                            {routineIcon(t.schedule ?? { type: 'daily', time: '09:00' }, t.when)}
                          </span>
                          <span className={styles.ideaText}>
                            <Text as="span" weight="medium" size="sm">
                              {t.title}
                            </Text>
                            <Text as="span" size="xs" tone="muted" truncate={2}>
                              {t.summary}
                            </Text>
                          </span>
                        </button>
                      ))}
                    </div>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button
              variant="ghost"
              leadingIcon={<PencilRuler />}
              onClick={() => {
                onOpenChange(false);
                setEditor({});
              }}
            >
              Set it up yourself
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
      {editor && <RoutineEditor open draft={editor} onOpenChange={(o) => !o && setEditor(null)} />}
    </>
  );
}
