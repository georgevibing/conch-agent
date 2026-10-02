import type { Skill, SkillMode } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  SkillPermissionList,
  SkillSignatureBadge,
  Text,
  TrustedPublisherList,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { skillsApi } from './api';
import {
  errorText,
  trustedPublisher,
  useForgetPublisher,
  usePublishers,
  useUpdateSkill,
} from './queries';

/** What a skill may do, as Nacre shows it. */
export function SkillCan({ skill, compact }: { skill: Skill; compact?: boolean }) {
  if (!skill.permissions) return null;
  return (
    <SkillPermissionList
      variant={compact ? 'compact' : 'page'}
      declared={skill.permissions.declared}
      capabilities={skill.permissions.capabilities}
      words={skill.permissions.words}
    />
  );
}

/**
 * Turning a skill on (ADR 0031). One from another app, or one signed by
 * someone you don't trust, first says what it can do; yours just turn on.
 */
export function useTurnOn() {
  const update = useUpdateSkill();
  const [asking, setAsking] = useState<{ skill: Skill; mode: SkillMode }>();

  const turn = (skill: Skill, mode: SkillMode) => {
    const turningOn = skill.mode === 'off' && mode !== 'off';
    const stranger = skill.source !== 'conch' || skill.signature?.state === 'untrusted';
    if (turningOn && stranger && !skill.problem) setAsking({ skill, mode });
    else update.mutate({ id: skill.id, patch: { mode } });
  };

  const skill = asking?.skill;
  const dialog = (
    <AlertDialog.Root open={Boolean(asking)} onOpenChange={(open) => !open && setAsking(undefined)}>
      {skill && (
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Turn on {skill.title}?</AlertDialog.Title>
            <AlertDialog.Description>
              {skill.signature?.state === 'verified'
                ? `Signed by ${skill.signature.publisher ?? 'a publisher you trust'}.`
                : skill.source === 'conch'
                  ? 'It’s in your skills.'
                  : `It’s from ${skill.sourceLabel}.`}{' '}
              A chat it’s used in is held to this list until you stop it.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <SkillCan skill={skill} compact />
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep it off</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                const chosen = asking;
                setAsking(undefined);
                if (chosen) update.mutate({ id: chosen.skill.id, patch: { mode: chosen.mode } });
              }}
            >
              Turn it on
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      )}
    </AlertDialog.Root>
  );
  return { turn, dialog };
}

/**
 * Who made it (ADR 0031), and for a signature that holds from someone new,
 * the way to trust them: a lasting power, so it says what it means and asks
 * that it's you.
 */
export function SkillSignatureSection({ skill }: { skill: Skill }) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [confirming, setConfirming] = useState(false);
  const [trusting, setTrusting] = useState(false);
  const signature = skill.signature;
  // Your own unsigned skills need no line saying so.
  if (!signature || (signature.state === 'unsigned' && skill.source === 'conch')) return null;
  const who = signature.publisher ?? 'this publisher';

  const trust = async () => {
    setConfirming(false);
    setTrusting(true);
    try {
      await guard(async () => {
        trustedPublisher(client, await skillsApi.trustPublisher(skill.id));
        toast.success(`You trust ${who}`, {
          description: 'Their signed skills say “Verified”, and their signed updates carry on.',
        });
      });
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t trust them just now.'));
    } finally {
      setTrusting(false);
    }
  };

  return (
    <>
      <SkillSignatureBadge
        state={signature.state}
        publisher={signature.publisher}
        fingerprint={signature.fingerprint}
        problem={signature.problem}
        lookalike={signature.lookalike}
        action={
          signature.state === 'untrusted' && !signature.lookalike ? (
            <Button
              size="sm"
              variant="surface"
              leadingIcon={<BadgeCheck />}
              loading={trusting}
              onClick={() => setConfirming(true)}
            >
              Trust this publisher…
            </Button>
          ) : undefined
        }
      />
      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Trust {who}?</AlertDialog.Title>
            <AlertDialog.Description>
              Skills signed with this key will say “Verified: signed by {who}”, and when they
              update, they stay on. Only trust someone you know: anyone can call themselves {who}.
              It’s the key that counts.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <Text size="sm" tone="muted">
            Key <code>{signature.fingerprint}</code>. If {who} told you theirs, check it matches.
          </Text>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Not now</AlertDialog.Cancel>
            <AlertDialog.Action onClick={() => void trust()}>Trust {who}</AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </>
  );
}

/** The Skills page's list of publishers you trust, when there are any. */
export function PublishersSection() {
  const { data: publishers } = usePublishers();
  const forget = useForgetPublisher();
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  const wanted = (location.state as { focus?: string } | null)?.focus === 'publishers';
  const ready = Boolean(publishers);
  // Opened from ⌘K: straight to the list.
  useEffect(() => {
    if (wanted && ready) ref.current?.scrollIntoView({ block: 'center' });
  }, [wanted, ready]);
  if (!publishers) return null;
  if (!publishers.length)
    return wanted ? <TrustedPublisherList ref={ref} id="publishers" publishers={[]} /> : null;
  return (
    <TrustedPublisherList
      ref={ref}
      id="publishers"
      publishers={publishers}
      forgetting={forget.isPending ? forget.variables : undefined}
      onForget={(p) =>
        forget.mutate(p.fingerprint, {
          onSuccess: () =>
            toast(`You no longer trust ${p.name}`, {
              description: 'Their skills still work; their updates turn them off until you look.',
            }),
        })
      }
    />
  );
}
