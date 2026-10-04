/**
 * Discover (ADR 0072): skills people publish, found by search, a kind or an
 * idea, read in full before they're added, and added in one press.
 */
import {
  MARKET_CATEGORY_LABELS,
  MARKET_IDEAS,
  MarketCategory,
  type MarketListing,
  type MarketPreview,
  type SkillDetail,
} from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  EmptyState,
  Input,
  MarketCategories,
  MarketIdeas,
  MarketShelf,
  MarketSkillPreview,
  Page,
  fromWords,
  hostWords,
  pinWords,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpCircle,
  MessageSquare,
  PenLine,
  Search,
  SearchX,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { ApiError } from '../../api/client';
import { useAssistantName } from '../integrations/queries';
import {
  marketApi,
  marketKeys,
  useInstallSkill,
  useMarket,
  useMarketListing,
  useMarketPreview,
} from './market';
import { errorText, putSkill } from './queries';

const CATEGORIES = MarketCategory.options.map((id) => ({ id, label: MARKET_CATEGORY_LABELS[id] }));

/** Where a listing opens. */
export const listingPath = (id: string) => `/skills/discover/${encodeURIComponent(id)}`;

/** Discover isn't there on this Conch (turned off), from the answer it gave. */
const turnedOff = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * The Discover tab of the Skills page: a search box, the kinds, ideas for
 * someone who doesn't know what to look for, and the shelf. What's typed is
 * in the address (`?q=`), so Back and a shared link land on the same shelf.
 */
export function DiscoverPanel() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const asked = params.get('kind');
  const category = MarketCategory.safeParse(asked).success ? (asked as MarketCategory) : undefined;
  const [typed, setTyped] = useState(q);
  // A short pause after typing before asking: one search, not one per letter.
  useEffect(() => {
    const words = typed.trim();
    if (words === q) return;
    const timer = setTimeout(
      () =>
        setParams(
          (now) => {
            const next = new URLSearchParams(now);
            if (words) next.set('q', words);
            else next.delete('q');
            return next;
          },
          { replace: true },
        ),
      350,
    );
    return () => clearTimeout(timer);
  }, [typed, q, setParams]);

  const { data, isPending, isFetching, error } = useMarket(q, category);
  const setCategory = (next: string | undefined) =>
    setParams(
      (now) => {
        const out = new URLSearchParams(now);
        if (next) out.set('kind', next);
        else out.delete('kind');
        return out;
      },
      { replace: true },
    );
  const states = data?.sources ?? [];
  const offline = states.some((s) => s.state === 'offline');
  const limited = states.some((s) => s.state === 'limited');
  const listings = data?.listings ?? [];
  const title = q
    ? `For “${q}”`
    : category
      ? MARKET_CATEGORY_LABELS[category]
      : 'Popular, and from the makers of the models';

  if (turnedOff(error))
    return (
      <EmptyState
        icon={<SearchX />}
        title="Discover is turned off here"
        description="Whoever runs this Conch turned off finding skills people share. Your own skills work as always."
      />
    );

  return (
    <Stack gap={5}>
      <Text size="sm" tone="muted">
        Skills people share, from Anthropic, ClawHub and skills.sh. Anyone can publish one, so Conch
        reads every file before you add it, and a chat it’s used in is held to what it says it
        needs.
      </Text>
      <Input
        type="search"
        aria-label="Search skills people share"
        placeholder="What should it get better at? Slides, emails, research…"
        leading={<Search />}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && typed) {
            e.preventDefault();
            setTyped('');
          }
        }}
      />
      <MarketCategories categories={CATEGORIES} value={category} onChange={setCategory} />
      {!q && !category && (
        <MarketIdeas
          ideas={MARKET_IDEAS}
          onPick={(idea) => {
            setTyped(idea.query);
            setParams({ q: idea.query }, { replace: true });
          }}
        />
      )}
      <MarketShelf
        title={title}
        listings={listings}
        loading={isPending || (isFetching && !listings.length)}
        offline={offline || (Boolean(error) && !listings.length)}
        limited={limited}
        query={q}
        onOpen={(listing) => void navigate(listingPath(listing.id))}
        emptyAction={
          q ? (
            <Button
              size="sm"
              variant="soft"
              leadingIcon={<PenLine />}
              onClick={() => void navigate('/skills/new', { state: { instructions: q } })}
            >
              Write it yourself
            </Button>
          ) : undefined
        }
      />
    </Stack>
  );
}

/**
 * Add what was read, and say so: the button's whole job, wherever it is (a
 * page, the chat's card). A worrying one sends the hash it was read with,
 * which the person's tick stood for.
 */
export function useAddFromPreview() {
  const install = useInstallSkill();
  const add = (preview: MarketPreview, mode: 'auto' | 'manual') =>
    install.mutateAsync({
      previewId: preview.previewId,
      mode,
      ...(preview.review.verdict === 'danger' && { acknowledged: preview.review.hash }),
    });
  return { add, adding: install.isPending };
}

/** One skill from Discover, on a page of its own: read first, added in one press. */
export function MarketSkillView({ listingId }: { listingId: string }) {
  const navigate = useNavigate();
  const assistant = useAssistantName();
  const listing = useMarketListing(listingId);
  const have = listing.data?.installed;
  const preview = useMarketPreview(listingId, Boolean(listing.data) && !have);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [added, setAdded] = useState<SkillDetail>();
  const { add, adding } = useAddFromPreview();
  const back = (
    <Button
      variant="ghost"
      size="sm"
      leadingIcon={<ArrowLeft />}
      onClick={() => void navigate(-1)}
      style={{ alignSelf: 'flex-start' }}
    >
      Discover
    </Button>
  );

  if (listing.isError)
    return (
      <Page gap={4}>
        {back}
        <EmptyState
          icon={<SearchX />}
          title="That skill isn’t there any more"
          description={errorText(
            listing.error,
            'Its place may have taken it down, or can’t be reached right now.',
          )}
          actions={
            <Button onClick={() => void navigate('/skills/discover')}>Back to Discover</Button>
          }
        />
      </Page>
    );
  if (!listing.data) return <Page gap={4}>{back}</Page>;

  const tryIt = (name: string) => void navigate('/', { state: { draft: `/${name} ` } });
  const skillId = added?.id ?? have?.skillId;
  return (
    <Page gap={5}>
      {back}
      <MarketSkillPreview
        listing={listing.data}
        {...(preview.data && { preview: preview.data })}
        {...(preview.isError && {
          error: errorText(preview.error, 'Something went wrong reading it.'),
          onRetry: () => void preview.refetch(),
        })}
        mode={mode}
        onModeChange={setMode}
        adding={adding}
        onAdd={() =>
          preview.data &&
          void add(preview.data, mode).then(
            (skill) => {
              setAdded(skill);
              toast.success(`Added ${skill.title}`, {
                description:
                  mode === 'auto'
                    ? `${assistant} uses it when a request fits, or type /${skill.name}.`
                    : `Type /${skill.name} when you want it.`,
              });
            },
            (error: unknown) => toast.error(errorText(error, 'Couldn’t add it.')),
          )
        }
        done={
          skillId ? (
            <>
              <Button
                leadingIcon={<MessageSquare />}
                onClick={() => tryIt(added?.name ?? listing.data.name)}
              >
                Try it in a chat
              </Button>
              <Button
                variant="surface"
                onClick={() => void navigate(`/skills/${encodeURIComponent(skillId)}`)}
              >
                {have?.update ? 'See the update' : 'Open it'}
              </Button>
            </>
          ) : undefined
        }
      />
      {have && !added && (
        <Callout tone="success" icon={<ShieldCheck />} title="You have this skill">
          It’s in your skills, pinned to the version you read. Updates wait for you to read them
          too.
        </Callout>
      )}
    </Page>
  );
}

/**
 * On a skill you added from Discover: where it came from, the version it's
 * pinned to, and an update when there is one, read like the first time
 * (what changed, file by file) before it's taken.
 */
export function MarketOriginSection({ skill }: { skill: SkillDetail }) {
  const origin = skill.origin;
  const client = useQueryClient();
  const [reading, setReading] = useState<MarketPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const open = useMemo(() => Boolean(reading || error), [reading, error]);
  if (!origin) return null;

  const read = async () => {
    setError(undefined);
    setBusy(true);
    try {
      setReading(await marketApi.previewUpdate(skill.id));
    } catch (e) {
      setError(errorText(e, 'Conch couldn’t read the update just now.'));
    } finally {
      setBusy(false);
    }
  };

  const take = async () => {
    if (!reading) return;
    setBusy(true);
    try {
      const updated = await marketApi.update(skill.id, {
        previewId: reading.previewId,
        ...(reading.review.verdict === 'danger' && { acknowledged: reading.review.hash }),
      });
      putSkill(client, updated);
      void client.invalidateQueries({ queryKey: marketKeys.all });
      setReading(undefined);
      toast.success(`Updated ${skill.title}`, {
        description: `Now pinned to ${pinWords(updated.origin?.pin ?? reading.pin)}.`,
      });
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t take the update.'));
    } finally {
      setBusy(false);
    }
  };

  const listing: MarketListing = {
    id: origin.listingId,
    source: origin.source,
    sourceLabel: origin.sourceLabel,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    publisher: origin.publisher,
    trust: origin.trust,
    url: origin.url,
  };

  return (
    <Stack gap={3}>
      <Callout
        tone="info"
        title={`Added from ${fromWords(origin.sourceLabel, origin.publisher.name).replace(' · ', ', by ')}`}
      >
        Pinned to {pinWords(origin.pin)}. Conch never changes it by itself: an update waits for you
        to read what’s different.{' '}
        <a href={origin.url} target="_blank" rel="noreferrer noopener">
          Its page on {hostWords(origin.url)}
        </a>
      </Callout>
      {origin.update && !open && (
        <Callout
          tone="accent"
          icon={<ArrowUpCircle />}
          title="A newer version is there"
          action={
            <Button size="sm" variant="soft" loading={busy} onClick={() => void read()}>
              Read the update
            </Button>
          }
        >
          Nothing changes until you read it and press Update.
        </Callout>
      )}
      {open && (
        <MarketSkillPreview
          headingLevel={2}
          listing={listing}
          {...(reading && { preview: reading })}
          {...(error && { error, onRetry: () => void read() })}
          adding={busy}
          addLabel="Update"
          onAdd={() => void take()}
        />
      )}
    </Stack>
  );
}

/**
 * A skill the chat offered (ADR 0072 on ADR 0060), read in a dialog over the
 * chat: the same read as Discover's page, and one press adds it. The chat
 * carries on once it's added.
 */
export function MarketOfferDialog({
  listingId,
  open,
  onOpenChange,
  onAdded,
}: {
  listingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (skill: SkillDetail) => void;
}) {
  const listing = useMarketListing(open ? listingId : undefined);
  const preview = useMarketPreview(
    listingId,
    open && Boolean(listing.data) && !listing.data?.installed,
  );
  const { add, adding } = useAddFromPreview();
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="lg">
        <Dialog.Header>
          <Dialog.Title>Read it before you add it</Dialog.Title>
          <Dialog.Description>
            Anyone can publish a skill. Here’s what this one says and does.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {listing.isError ? (
            <Callout tone="warning" title="That skill isn’t there any more">
              {errorText(
                listing.error,
                'Its place may have taken it down, or can’t be reached right now.',
              )}
            </Callout>
          ) : listing.data ? (
            <MarketSkillPreview
              headingLevel={2}
              listing={listing.data}
              {...(preview.data && { preview: preview.data })}
              {...(preview.isError && {
                error: errorText(preview.error, 'Something went wrong reading it.'),
                onRetry: () => void preview.refetch(),
              })}
              mode={mode}
              onModeChange={setMode}
              adding={adding}
              addLabel={
                preview.data?.review.verdict === 'danger'
                  ? 'Add anyway and carry on'
                  : 'Add and carry on'
              }
              onAdd={() =>
                preview.data &&
                void add(preview.data, mode).then(onAdded, (error: unknown) =>
                  toast.error(errorText(error, 'Couldn’t add it.')),
                )
              }
            />
          ) : (
            <Text tone="muted" role="status">
              Finding it…
            </Text>
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
