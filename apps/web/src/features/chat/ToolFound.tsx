import type { ToolView } from '@conch/protocol';
import {
  AgendaView,
  ChatMessages,
  FileList,
  MailList,
  Places,
  RecipeCards,
  Sources,
  WeatherCard,
  replyRequest,
} from '@conch/nacre';

import { useUi } from '../../app/ui';
import { SentAttachments } from './AttachmentViewer';
import { recipeCards, recipeTimerDone } from './recipes';
import { ShopShelf } from './ShopShelf';
import { attachmentUrl } from './uploads';
import { MusicFound } from './MusicFound';
import { FoundVideos } from './FoundVideos';

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
    case 'files':
      return <FileList files={view.items} />;
    case 'messages':
      return <ChatMessages messages={view.items} place={view.place} />;
    case 'weather':
      return <WeatherCard weather={view} />;
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
  }
}
