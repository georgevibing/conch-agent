import {
  AppDock,
  AppIcon,
  ARTIFACT_KINDS,
  Button,
  ContextMenu,
  DockGlyph,
  toast,
  type AppDockItem,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Info, LayoutGrid, MessageSquare, PinOff, SquareArrowOutUpRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { usePinnedApps, useUpdateArtifact } from '../artifacts/queries';
import { conchAppsApi } from '../conchapps/api';
import { putConchApp, useConchApps } from '../conchapps/queries';
import { appLook, conchAppPath, conchPagePath } from '../conchapps/words';
import { APPS_PATH } from '../integrations/paths';
import { favouritesFirst, useAppsOpened } from './appOrder';

/**
 * Pinned apps at the top of the chat list (ADR 0089, after ADR 0034 and 0061):
 * a row of app tiles under a quiet **Apps** heading, so a page reads as an
 * app, not as one more chat. Each says where it came from, and a right-click
 * or a long press unpins it. The ones you open most sit in the row; past two
 * rows the last tile is **All apps**, a folder of every one, with a search.
 */
export function PinnedAppsDock({ onNavigate }: { onNavigate?: () => void }) {
  const artifacts = usePinnedApps();
  const { data: conchApps } = useConchApps();
  const updateArtifact = useUpdateArtifact();
  const client = useQueryClient();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const { recent, opened } = useAppsOpened();

  const go = (to: string) => {
    void navigate(to);
    onNavigate?.();
  };

  const unpinApp = async (id: string, name: string) => {
    try {
      putConchApp(client, await conchAppsApi.setPinned(id, false));
      toast(`${name} is off your sidebar`, {
        description: 'Its page is still in Apps.',
        action: {
          label: 'Undo',
          onClick: () =>
            void conchAppsApi.setPinned(id, true).then((app) => putConchApp(client, app)),
        },
      });
    } catch (e) {
      toast.error('Couldn’t unpin that', { description: (e as Error).message });
    }
  };

  const pages: AppDockItem[] = (conchApps ?? [])
    .filter((a) => a.pinned && a.manifest.pages.length > 0)
    .sort((a, b) => a.addedAt - b.addedAt)
    .flatMap((a) =>
      a.manifest.pages.map((page) => {
        const to = conchPagePath(a.id, page.id);
        const many = a.manifest.pages.length > 1;
        return {
          key: `${a.id}/${page.id}`,
          label: many ? page.title : a.manifest.name,
          icon: <AppIcon {...appLook(a)} size="md" />,
          source: many ? `Page of the ${a.manifest.name} app` : `The ${a.manifest.name} app`,
          active: path === to,
          onOpen: () => go(to),
          menu: (
            <>
              <ContextMenu.Item icon={<SquareArrowOutUpRight />} onSelect={() => go(to)}>
                Open
              </ContextMenu.Item>
              <ContextMenu.Item icon={<Info />} onSelect={() => go(conchAppPath(a.id))}>
                About this app
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item
                icon={<PinOff />}
                onSelect={() => void unpinApp(a.id, a.manifest.name)}
              >
                Unpin
              </ContextMenu.Item>
            </>
          ),
        };
      }),
    );

  const made: AppDockItem[] = artifacts.map((a) => {
    const to = `/apps/${a.id}`;
    const kind = ARTIFACT_KINDS[a.kind];
    return {
      key: a.id,
      label: a.title,
      icon: <DockGlyph icon={kind.icon} />,
      source: `${kind.label}, made in a chat`,
      active: path === to,
      onOpen: () => go(to),
      menu: (
        <>
          <ContextMenu.Item icon={<SquareArrowOutUpRight />} onSelect={() => go(to)}>
            Open
          </ContextMenu.Item>
          {a.conversationId && (
            <ContextMenu.Item
              icon={<MessageSquare />}
              onSelect={() => go(`/c/${a.conversationId}`)}
            >
              Open the chat it came from
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<PinOff />}
            onSelect={() => updateArtifact.mutate({ id: a.id, pinned: false })}
          >
            Unpin
          </ContextMenu.Item>
        </>
      ),
    };
  });

  // The row leads with what you reach for; the folder keeps every app in the
  // order they were added, so nothing moves about inside it.
  const items = [...pages, ...made].map((item) => ({
    ...item,
    onOpen: () => {
      opened(item.key);
      item.onOpen();
    },
  }));
  if (!items.length) return null;
  return (
    <AppDock
      items={items}
      label="Pinned apps"
      order={favouritesFirst(items, recent)}
      folderActions={
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<LayoutGrid />}
          onClick={() => go(APPS_PATH)}
        >
          Open Apps
        </Button>
      }
    />
  );
}
