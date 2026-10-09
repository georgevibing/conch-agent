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
import { WhereItRuns } from './WhereItRuns';
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
        description="A browser of its own: watch it in the chat, and take over any time."
      >
        <BrowserStatusCard
          phase={status.phase}
          disabled={!settings.enabled}
          browserName={status.browser?.name}
          version={status.browser?.version}
          install={status.install}
          problem={status.problem}
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
            description="Off: it says so when a task needs it."
          />
          <Switch
            checked={settings.autoOpen}
            disabled={!settings.enabled}
            onCheckedChange={(autoOpen) => save({ autoOpen })}
            label="Show the browser when it starts"
            description="It always opens when you’re needed."
          />
        </Stack>
      </Section>

      <Section
        title="Where it runs"
        description="Its own browser, your Chrome where you’re signed in, or one in the cloud."
      >
        <WhereItRuns status={status} name={name} guard={guard} />
      </Section>

      <Section title="On the pages it opens">
        <Stack gap={4}>
          <Switch
            checked={settings.declineCookies}
            disabled={!settings.enabled}
            onCheckedChange={(declineCookies) => save({ declineCookies })}
            label="Decline cookie banners for you"
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
            description="A dev server or your router. A page it visits could reach them too, so only turn this on if you need it. Conch itself stays out of reach."
          />
        </Stack>
      </Section>

      <Section
        title="Sites you always allow"
        description={`${name} asks before acting on a new site, and never types passwords or card numbers.`}
      >
        {status.sites.length === 0 ? (
          <Text size="sm" tone="subtle">
            Choose “Always” for a site and it’s listed here, to take back any time.
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
        description="Sites stay signed in here, so you only do it once. Your own browser isn’t touched."
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
