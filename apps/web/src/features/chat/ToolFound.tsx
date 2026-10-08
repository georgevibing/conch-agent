import type { Attachment, ToolView } from '@conch/protocol';
import {
  AgendaView,
  BookShelf,
  CardShare,
  ChartCard,
  ChatMessages,
  FileList,
  Fundamentals,
  KnowledgeCard,
  LinkCards,
  MailList,
  Places,
  QuotesCard,
  RecipeCards,
  ShowCards,
  Sources,
  WeatherCard,
  replyRequest,
  type CardPicture,
} from '@conch/nacre';

import { useUi } from '../../app/ui';
import { useCardShare } from './cardShare';
import { SentAttachments } from './AttachmentViewer';
import { MailSentItem } from './MailItems';
import { recipeCards, recipeTimerDone } from './recipes';
import { ShopShelf } from './ShopShelf';
import { attachmentUrl } from './uploads';
import { MusicFound } from './MusicFound';
import { FoundVideos } from './FoundVideos';
import { useWeatherUnits } from './weatherUnits';
import { priceHistory } from './financeApi';

/** A picture the gateway fetched and keeps for this chat: drawn from Conch, never the web. */
const picture = (a: Attachment | undefined): CardPicture | undefined =>
  a?.kind === 'image'
    ? {
        src: attachmentUrl(a.id),
        ...(a.width && { width: a.width }),
        ...(a.height && { height: a.height }),
      }
    : undefined;

/** A site's own small picture, asked of the site by the gateway (`GET /api/favicon`). */
function siteIcon(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)
      ? `/api/favicon?host=${encodeURIComponent(host)}`
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Words for the open chat's composer, from anywhere in it: the same way ⌘K's
 * "use this skill" hands words over. Nothing is sent; the person reads,
 * changes and sends them.
 */
export function useComposerInsert() {
  const setComposerText = useUi((s) => s.setComposerText);
  return (text: string) => setComposerText(text);
}

/**
 * What a tool found, drawn as it is under its row (ADR 0060): an agenda,
 * emails, files or messages. Everything in it came from outside and is
 * drawn as plain text by Nacre. Rows offer next steps only as composer text.
 */
export function ToolFound({ view }: { view: ToolView }) {
  const insert = useComposerInsert();
  switch (view.kind) {
    case 'downloads':
      return <SentAttachments attachments={view.items} made />;
    case 'sources':
      return <Sources sources={view.items} />;
    case 'agenda':
      return <AgendaView events={view.items} from={view.from} to={view.to} />;
    case 'mail':
      return <MailList messages={view.items} onReply={(m) => insert(replyRequest(m))} />;
    case 'mail-sent':
      return <MailSentItem view={view} />;
    case 'files':
      return <FileList files={view.items} />;
    case 'messages':
      return <ChatMessages messages={view.items} place={view.place} />;
    case 'weather':
      return <WeatherFound view={view} />;
    case 'recipe':
      return <RecipeCards recipes={recipeCards(view.items)} onTimerDone={recipeTimerDone} />;
    case 'products':
      return <ShopShelf view={view} onAsk={insert} />;
    case 'places': {
      // The map's tiles are the chat's own pictures, served by Conch: never a remote image.
      const { items, map, ...rest } = view;
      return (
        <Places
          {...rest}
          places={items}
          {...(map && {
            map: { ...map, tiles: map.tiles.map((t) => (t ? attachmentUrl(t.id) : null)) },
          })}
        />
      );
    }
    case 'audio':
      return <MusicFound view={view} />;
    case 'videos':
      return <FoundVideos view={view} />;
    case 'knowledge':
      return (
        <KnowledgeCard
          title={view.title}
          description={view.description}
          extract={view.extract}
          picture={picture(view.picture)}
          facts={view.facts}
          url={view.url}
          lang={view.lang}
          source={view.source}
          sourceIcon={siteIcon(view.url)}
          related={view.related}
        />
      );
    case 'links':
      return (
        <LinkCards
          links={view.items.map(({ picture: p, ...link }) => ({
            ...link,
            picture: picture(p),
            icon: siteIcon(link.url),
          }))}
        />
      );
    case 'books':
      return (
        <BookShelf books={view.items.map(({ cover, ...b }) => ({ ...b, cover: picture(cover) }))} />
      );
    case 'quotes':
      return <QuotesFound view={view} />;
    case 'fundamentals':
      return <FundamentalsFound view={view} />;
    case 'shows':
      return (
        <ShowCards
          shows={view.items.map(({ poster, ...s }) => ({ ...s, poster: picture(poster) }))}
        />
      );
    case 'chart':
      return <ChartFound view={view} />;
  }
}

/**
 * A forecast in the units the person reads, with the card's switch changing
 * them everywhere — and its share bar: save the forecast as a picture, copy
 * it, or send it to a chat app (ADR 0105).
 */
function WeatherFound({ view }: { view: Extract<ToolView, { kind: 'weather' }> }) {
  const [units, setUnits] = useWeatherUnits();
  const { ref, share } = useCardShare({
    what: 'forecast',
    title: `Weather in ${view.place.name}`,
  });
  return (
    <WeatherCard
      ref={ref}
      weather={view}
      units={units}
      onUnitsChange={setUnits}
      share={<CardShare {...share} />}
    />
  );
}

/** A chart drawn in the chat, with its own share bar: save it, copy it, send it. */
function ChartFound({ view }: { view: Extract<ToolView, { kind: 'chart' }> }) {
  // Numbers only, drawn by Nacre: nothing in a chart is markup or a link.
  const { kind: _kind, ...chart } = view;
  const { ref, share } = useCardShare({ what: 'chart', title: chart.title });
  return <ChartCard ref={ref} chart={chart} actions={<CardShare {...share} />} />;
}

/** Prices in the chat, with their share bar. The range switch asks the gateway for more closes (`financeApi.ts`). */
function QuotesFound({ view }: { view: Extract<ToolView, { kind: 'quotes' }> }) {
  const first = view.items[0];
  const { ref, share } = useCardShare({
    what: 'chart',
    title: view.items.length === 1 && first ? `${first.symbol} · ${first.name}` : 'Prices',
  });
  return (
    <div ref={ref}>
      <QuotesCard quotes={view} onRange={priceHistory} share={<CardShare {...share} />} />
    </div>
  );
}

/** Filed figures in the chat, with their share bar. */
function FundamentalsFound({ view }: { view: Extract<ToolView, { kind: 'fundamentals' }> }) {
  const { ref, share } = useCardShare({
    what: 'chart',
    title: view.items.map((c) => c.name).join(', ') || 'Fundamentals',
  });
  return (
    <div ref={ref}>
      <Fundamentals fundamentals={view} share={<CardShare {...share} />} />
    </div>
  );
}
