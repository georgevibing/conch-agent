import type { GoogleAppId, Routine, Trigger } from '@conch/protocol';
import { RoutineCard, Stack, Text, toast, type RoutineCardStatus } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import { browserTimezone, routinesApi } from './api';
import { routineIcon, WAITING_TEXT } from './icon';
import { routineKeys } from './queries';
import { RoutineEditor, type RoutineDraft } from './RoutineEditor';
import styles from './Routines.module.css';
import { templates, type Template } from './templates';
import { useWhenPreview } from './useWhenPreview';

/** The one or two that fit each app, best first (ADR 0056). */
const FOR: Partial<Record<GoogleAppId, string[]>> = {
  gmail: ['waiting-on'],
  'google-calendar': ['meeting-brief'],
};

const KEY = (app: GoogleAppId) => `conch.whenStarters.${app}`;

function offered(app: GoogleAppId): boolean {
  try {
    return localStorage.getItem(KEY(app)) !== null;
  } catch {
    return false;
  }
}

function markOffered(app: GoogleAppId) {
  try {
    localStorage.setItem(KEY(app), String(Date.now()));
  } catch {
    // A private window: it may be offered once more. Nothing is created either way.
  }
}

/** A starter that can't be on without one more choice (whose mail): the editor asks it. */
const needsChoice = (t: Template) => t.when?.kind === 'mail' && !t.when.from?.length;

/**
 * Right after Gmail or Google Calendar is connected from Apps, the one or two
 * routines that start from them, offered once, in the flow. Nothing is
 * created until the person turns one on (ADR 0056, ADR 0021).
 */
export function WhenStarters({ app }: { app: GoogleAppId }) {
  const ids = FOR[app] ?? [];
  // Decided once when it shows: the offer stays for this visit, and never comes back.
  const [show] = useState(() => ids.length > 0 && !offered(app));
  useEffect(() => {
    if (show) markOffered(app);
  }, [show, app]);
  if (!show) return null;
  const starters = templates.filter((t) => ids.includes(t.id));
  return (
    <Stack gap={2}>
      <Text size="sm" weight="medium">
        Want one of these?
      </Text>
      {starters.map((t) => (
        <Starter key={t.id} template={t} />
      ))}
    </Stack>
  );
}

function Starter({ template }: { template: Template }) {
  const [status, setStatus] = useState<RoutineCardStatus>('draft');
  const [made, setMade] = useState<Routine>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RoutineDraft>();
  const client = useQueryClient();
  const navigate = useNavigate();
  const draft: RoutineDraft = { ...template, timezone: browserTimezone() };
  // Conch's own words for what starts it, never typed here.
  const { preview } = useWhenPreview(template.when as Trigger | undefined, '');

  const turnOn = async () => {
    if (needsChoice(template)) return setEditing(draft);
    setBusy(true);
    try {
      const routine = await routinesApi.create({
        ...template,
        timezone: browserTimezone(),
        status: 'active',
      });
      setMade(routine);
      setStatus('active');
      await client.invalidateQueries({ queryKey: routineKeys.all });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Couldn’t turn it on.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.chatCard}>
      <RoutineCard
        variant="proposal"
        title={template.title}
        summary={template.summary ?? ''}
        scheduleText={preview?.text || template.title}
        waitingText={WAITING_TEXT}
        status={status}
        icon={routineIcon(template.schedule ?? { type: 'daily', time: '09:00' }, template.when)}
        busy={busy}
        {...(needsChoice(template) && { activateLabel: 'Choose who' })}
        onActivate={() => void turnOn()}
        onEdit={() => setEditing(draft)}
        onDismiss={() => setStatus('deleted')}
        {...(made && { onOpen: () => void navigate(`/routines/${made.id}`) })}
      />
      {editing && (
        <RoutineEditor open draft={editing} onOpenChange={(o) => !o && setEditing(undefined)} />
      )}
    </div>
  );
}
