import {
  AgentAvatar,
  ApprovalSheet,
  type AgentFace,
  type ApprovalSheetOutcome,
} from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import type { ConversationView, TranscriptItem } from '../../live/reducer';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { pushApi } from './api';

/** `?approve=<permission>`: where a notification about an OK opens (ADR 0108). */
export const APPROVE_PARAM = 'approve';

type Permission = Extract<TranscriptItem, { kind: 'permission' }>;

/** Exactly what it would do, as it would do it: the command, the file, the address. */
export function exactly(item: Permission): string | undefined {
  const input = (item.input ?? {}) as Record<string, unknown>;
  for (const key of ['command', 'file_path', 'notebook_path', 'url', 'path', 'query'])
    if (typeof input[key] === 'string' && input[key]) return input[key];
  return undefined;
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The approval sheet, opened from a notification (ADR 0108): one question,
 * within reach of a thumb. A step that matters asks for a passkey or password
 * first (the gateway says so, and `useVerify` asks). The Passwords and browser
 * questions keep their own cards in the chat; the sheet doesn't open for them.
 */
export function ApprovalHere({
  conversationId,
  view,
  name,
  avatar,
  where,
}: {
  conversationId: string | undefined;
  view: ConversationView;
  name: string;
  avatar?: AgentFace;
  where?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const permissionId = new URLSearchParams(location.search).get(APPROVE_PARAM) ?? undefined;
  const item = view.items.find(
    (i): i is Permission => i.kind === 'permission' && i.id === permissionId,
  );
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [sent, setSent] = useState<'allow' | 'deny'>();
  const [outcome, setOutcome] = useState<ApprovalSheetOutcome>();
  const allowRef = useAutoFocus<HTMLButtonElement>();
  const asked = useQuery({
    queryKey: ['push', 'approval', conversationId, permissionId],
    queryFn: () => pushApi.approval(conversationId ?? '', permissionId ?? ''),
    enabled: Boolean(conversationId && permissionId && item && !item.decision),
    staleTime: 30_000,
  });
  const close = useCallback(() => {
    const search = new URLSearchParams(location.search);
    search.delete(APPROVE_PARAM);
    const rest = search.toString();
    void navigate(`${location.pathname}${rest ? `?${rest}` : ''}`, { replace: true });
  }, [navigate, location.pathname, location.search]);

  if (!conversationId || !item || item.browser || item.vault) return null;

  const decide = async (decision: 'allow' | 'deny') => {
    setSent(decision);
    try {
      let result: Awaited<ReturnType<typeof pushApi.answer>> | undefined;
      const done = await guard(async () => {
        result = await pushApi.answer(conversationId, item.id, decision);
      });
      if (!done) return setSent(undefined);
      setOutcome(result?.outcome === 'gone' ? 'gone' : decision);
    } catch (error) {
      setSent(undefined);
      if (error instanceof ApiError && error.status === 404) setOutcome('gone');
    }
  };

  const shown = exactly(item);
  const confirm = asked.data?.confirm;
  return (
    <>
      <ApprovalSheet
        open
        onOpenChange={(open) => !open && close()}
        name={name}
        face={<AgentAvatar name={name} avatar={avatar} size="sm" />}
        where={where}
        title={sentence(item.title ?? item.summary)}
        detail={item.detail}
        cost={item.cost}
        caution={item.caution ?? item.taint}
        until={
          asked.data?.expiresAt ? `No answer by ${clock(asked.data.expiresAt)} is a no.` : undefined
        }
        confirm={confirm}
        sent={sent}
        outcome={outcome ?? (item.decision ? 'gone' : undefined)}
        onDecide={(decision) => void decide(decision)}
        allowRef={allowRef}
      >
        {shown && <pre>{shown}</pre>}
      </ApprovalSheet>
      {dialog}
    </>
  );
}
