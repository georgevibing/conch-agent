import { Button, ImportOffer, Stack, Text, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { COME_HOME_FOCUS, importApi, useImportStatus } from './api';
import { comeHomeItem } from '../settings/paths';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** “just now”, “2 days ago”, “on 3 May”. */
const when = (at: number) =>
  Date.now() - at >= 7 * 86_400_000 ? `on ${relativeTime(at)}` : relativeTime(at);

/**
 * Settings → Memory → “Bring your things from OpenClaw” (ADR 0035): a card
 * for each other agent Conch finds on this computer, and Undo for the last
 * import while it can be. Nothing at all when there's none: no clutter for
 * people who never used one.
 */
export function ComeHomeSection() {
  const client = useQueryClient();
  const { data } = useImportStatus();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [undoing, setUndoing] = useState(false);
  const openSettings = useUi((s) => s.openSettings);
  const focus = useUi((s) => s.settingsFocus);
  const ref = useRef<HTMLElement>(null);

  // ⌘K and Repair everything arrive here: the first one found opens at once, as its page.
  useEffect(() => {
    if (focus !== COME_HOME_FOCUS || !data) return;
    useUi.setState({ settingsFocus: undefined });
    const first = data.sources[0]?.id;
    if (first) openSettings('memory', comeHomeItem(first), { replace: true });
    else ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focus, data, openSettings]);

  if (!data) return null;
  const last = data.last;
  const lastLabel = data.sources.find((s) => s.id === last?.source)?.label ?? 'the other app';
  if (!data.sources.length && !last) return null;

  const undo = async () => {
    setUndoing(true);
    try {
      let removed = 0;
      const ok = await guard(async () => {
        removed = (await importApi.undo()).removed;
      });
      if (!ok) return;
      void client.invalidateQueries();
      toast.success(`Took back what came from ${lastLabel}`, {
        description: `${plural(removed, 'thing')} removed, and what it changed is as it was.`,
      });
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : 'Couldn’t undo it. Try again.');
    } finally {
      setUndoing(false);
    }
  };

  return (
    <Section
      ref={ref}
      title="Bring your things from another assistant"
      description="Conch found these on this computer. Look first: nothing comes over until you say, and their folders stay as they are."
    >
      <Stack gap={3}>
        {data.sources.map((s) => (
          <ImportOffer
            key={s.id}
            from={s.label}
            summary={s.summary}
            imported={
              s.imported &&
              `Brought over ${plural(s.imported.count, 'thing')} ${when(s.imported.at)}.`
            }
            action={
              <Button
                size="sm"
                variant={s.imported ? 'surface' : 'solid'}
                onClick={() => openSettings('memory', comeHomeItem(s.id))}
              >
                {s.imported ? 'Look again' : 'Take a look'}
              </Button>
            }
          />
        ))}
        {last && (
          <Stack direction="row" gap={3} align="center" wrap>
            <Text size="sm" tone="muted">
              {plural(last.count, 'thing')} came from {lastLabel} {when(last.at)}.
            </Text>
            <Button size="sm" variant="ghost" loading={undoing} onClick={() => void undo()}>
              Undo that import
            </Button>
          </Stack>
        )}
      </Stack>
      {dialog}
    </Section>
  );
}
