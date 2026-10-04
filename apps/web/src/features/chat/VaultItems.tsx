import { templateFor, type VaultFieldKind, type VaultFieldRole } from '@conch/protocol';
import { VaultApproval, VaultRequestCard, VaultUnlockCard, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import type { TranscriptItem } from '../../live/reducer';
import { errorText } from '../integrations/queries';
import { vaultApi } from '../passwords/api';
import { vaultKeys } from '../passwords/queries';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

/**
 * Passwords in the chat (ADR 0025 § Asking): unlock it right here, or type in
 * the credential the assistant asked for. What's typed goes to the vault,
 * never into the chat or to the assistant.
 */
export function VaultRequestItem({ item, name }: { item: Of<'vault-request'>; name: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { request } = item;
  // Answered here: the card says so at once, not when the chat's log catches up.
  const [settled, setSettled] = useState<'done' | 'declined'>();
  const state = request.state === 'waiting' && settled ? settled : request.state;
  if (request.kind === 'unlock')
    return (
      <VaultUnlockCard
        state={state}
        name={name}
        onUnlock={async (password) => {
          try {
            await vaultApi.unlock(password);
            setSettled('done');
            void client.invalidateQueries({ queryKey: vaultKeys.all });
          } catch (e) {
            throw new Error(errorText(e, 'That didn’t unlock it.'));
          }
        }}
      />
    );
  const type = request.itemType ?? 'login';
  const fields: { label: string; kind: VaultFieldKind; role?: VaultFieldRole }[] = request.fields
    ?.length
    ? request.fields
    : templateFor(type).fields.filter((f) => f.kind !== 'totp');
  return (
    <VaultRequestCard
      name={name}
      state={state}
      title={request.title ?? templateFor(type).name}
      itemKind={type}
      site={request.site}
      reason={request.reason}
      fields={fields}
      onSave={async ({ title, values }) => {
        try {
          await vaultApi.answer(request.requestId, {
            title,
            fields: fields
              .map((f, i) => ({
                label: f.label,
                kind: f.kind,
                ...(f.role && { role: f.role }),
                value: values[i] ?? '',
              }))
              .filter((f) => f.value),
          });
          setSettled('done');
          void client.invalidateQueries({ queryKey: vaultKeys.all });
        } catch (e) {
          throw new Error(errorText(e, 'Couldn’t save it.'));
        }
      }}
      onDecline={() => {
        setSettled('declined');
        vaultApi.decline(request.requestId).catch((e: unknown) => {
          setSettled(undefined);
          toast.error(errorText(e, 'That didn’t go through. Try again.'));
        });
      }}
      onOpen={request.itemId ? () => void navigate(`/passwords/${request.itemId}`) : undefined}
    />
  );
}

/** The assistant asking to read one thing from Passwords. */
export function VaultApprovalItem({
  item,
  name,
  onRespond,
}: {
  item: Of<'permission'>;
  name: string;
  onRespond: (decision: 'allow' | 'allow-always' | 'deny') => void;
}) {
  const [busy, setBusy] = useState(false);
  const vault = item.vault;
  if (!vault) return null;
  return (
    <VaultApproval
      name={name}
      itemTitle={vault.itemTitle}
      itemKind={vault.itemType}
      fieldLabel={vault.fieldLabel}
      reason={vault.reason}
      sensitive={vault.sensitive}
      decision={item.decision}
      busy={busy}
      onDecide={(d) => {
        setBusy(true);
        onRespond(d);
      }}
    />
  );
}
