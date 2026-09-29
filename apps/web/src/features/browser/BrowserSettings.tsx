import type { UpdateBrowserSettingsBody } from '@conch/protocol';
import {
  AlertDialog,
  BrowserStatusCard,
  Button,
  Field,
  IconButton,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
} from '@conch/nacre';
import { Globe, LogOut, X } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { useAssistantName } from '../integrations/queries';
import { Section } from '../settings/Section';
import { browserApi } from './api';
import styles from './BrowserSettings.module.css';
import {
  browserKeys,
  useBrowserStatus,
  useRepairBrowser,
  useRevokeSite,
  useUpdateBrowserSettings,
  useWipeBrowser,
} from './queries';
import { useQueryClient } from '@tanstack/react-query';

/** Settings › Browser: its health, how it behaves, the sites you trust, your sign-ins. */
export function BrowserSettings() {
  const name = useAssistantName();
  const { data: status, isPending } = useBrowserStatus();
  const update = useUpdateBrowserSettings();
  const repair = useRepairBrowser();
  const revoke = useRevokeSite();
  const wipe = useWipeBrowser();
  const auth = useAuth();
  const client = useQueryClient();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [confirmWipe, setConfirmWipe] = useState(false);

  if (isPending || !status) {
    return (
      <Stack gap={4}>
        <Skeleton height={120} />
        <Skeleton height={200} />
      </Stack>
    );
  }
  const { settings } = status;
  const save = (patch: UpdateBrowserSettingsBody) => update.mutate(patch);
  const firstFound = status.candidates[0];

  return (
    <Stack gap={8}>
      <Section
        title="Browser"
        description={`${name} has a browser of its own. You can watch it in the chat and take over any time. Nothing to set up: it uses a browser you already have, or fetches one the first time.`}
      >
        <BrowserStatusCard
          phase={status.phase}
          disabled={!settings.enabled}
          browserName={status.browser?.name}
          version={status.browser?.version}
          install={status.install}
          problem={status.problem}
          healed={status.healed}
          repairing={repair.isPending}
          onRepair={() => repair.mutate()}
        >
          {status.candidates.length > 1 && (
            <Field>
              <Field.Label>Browser to use</Field.Label>
              <Select
                value={settings.preferred}
                onValueChange={(preferred) => save({ preferred })}
                aria-label="Browser to use"
              >
                <Select.Item value="auto">
                  Automatic{firstFound ? ` (${firstFound.name})` : ''}
                </Select.Item>
                {status.candidates.map((candidate) => (
                  <Select.Item key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </Select.Item>
                ))}
              </Select>
            </Field>
          )}
        </BrowserStatusCard>
      </Section>

      <Section title="While it browses">
        <Stack gap={4}>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => save({ enabled })}
            label={`Let ${name} use the browser`}
            description="Off: it won’t browse, and says so when a task needs it."
          />
          <Switch
            checked={settings.autoOpen}
            disabled={!settings.enabled}
            onCheckedChange={(autoOpen) => save({ autoOpen })}
            label="Show the browser when it starts browsing"
            description="The panel slides in beside the chat. It always opens when you’re needed."
          />
          <Switch
            checked={settings.declineCookies}
            disabled={!settings.enabled}
            onCheckedChange={(declineCookies) => save({ declineCookies })}
            label="Decline cookie banners for you"
            description="Picks “reject” or “necessary only” wherever it can, so banners don’t get in the way."
          />
          <Switch
            checked={settings.allowLocal}
            disabled={!settings.enabled}
            onCheckedChange={(allowLocal) =>
              void guard(async () => {
                client.setQueryData(
                  browserKeys.status,
                  await browserApi.updateSettings({ allowLocal }),
                );
              })
            }
            label="Open local apps"
            description="Pages on this computer and your network, like a dev server on localhost or your router. A page it visits could then reach them too, so only turn this on if you need it. Conch itself always stays out of reach."
          />
        </Stack>
      </Section>

      <Section
        title="How it keeps you safe"
        description={`${name} never types passwords, codes or card numbers: when a site needs one, it hands the browser to you and never sees what you type. It asks before acting on a new site, and every time before anything that buys, sends, posts or deletes. Instructions on web pages are treated as information, never as orders.`}
      >
        {status.sites.length === 0 ? (
          <Text size="sm" tone="subtle">
            When you choose “Always” for a site, it’s listed here, and you can take it back.
          </Text>
        ) : (
          <ul className={styles.sites} aria-label="Sites you always allow">
            {status.sites.map((site) => (
              <li key={site.site} className={styles.site}>
                <Globe aria-hidden className={styles.siteIcon} />
                <span className={styles.siteName}>{site.site}</span>
                <Text as="span" size="xs" tone="subtle">
                  Always allowed
                </Text>
                <IconButton
                  size="sm"
                  label={`Stop always allowing ${site.site}`}
                  onClick={() => revoke.mutate(site.site)}
                >
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Your sign-ins"
        description={`Sites you sign in to in ${name}’s browser stay signed in, so you only do it once. Your own browser is never touched.`}
      >
        <div>
          <Button
            variant="surface"
            tone="danger"
            leadingIcon={<LogOut />}
            loading={wipe.isPending}
            onClick={() => setConfirmWipe(true)}
          >
            Sign out of every site
          </Button>
        </div>
      </Section>

      <AlertDialog.Root open={confirmWipe} onOpenChange={setConfirmWipe}>
        <AlertDialog.Content tone="danger">
          <AlertDialog.Title>Sign out of every site?</AlertDialog.Title>
          <AlertDialog.Description>
            {name}’s browser forgets every sign-in, cookie and saved page. Sites you use will ask
            you to sign in again. Your own browser isn’t affected.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button tone="danger" onClick={() => wipe.mutate()}>
                Sign out of everything
              </Button>
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </Stack>
  );
}
