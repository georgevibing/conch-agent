import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import { GuideSteps } from '../Channels/GuideSteps';
import { PortalSketch } from '../Channels/PortalSketch';

export const GOOGLE_APIS = {
  gmail: { name: 'Gmail API', service: 'gmail.googleapis.com' },
  calendar: { name: 'Google Calendar API', service: 'calendar-json.googleapis.com' },
  drive: { name: 'Google Drive API', service: 'drive.googleapis.com' },
};
export function googleConsoleUrl(path: string, projectId = '') {
  const url = new URL(path, 'https://console.cloud.google.com');
  if (/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) url.searchParams.set('project', projectId);
  return url.href;
}
function Open({
  path,
  projectId,
  children,
}: {
  path: string;
  projectId?: string;
  children: ReactNode;
}) {
  return (
    <Button asChild variant="surface">
      <a href={googleConsoleUrl(path, projectId)} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    </Button>
  );
}

export interface GoogleSetupGuideProps {
  step: number;
  onStepChange: (step: number) => void;
  projectId: string;
  onProjectIdChange: (id: string) => void;
  services: (keyof typeof GOOGLE_APIS)[];
  /** The app owns file handling and keeps credentials out of presentation state. */
  importControl: ReactNode;
}
/** The same console path for local and remote Conch. No hosted connection service. */
export function GoogleSetupGuide({
  step,
  onStepChange,
  projectId,
  onProjectIdChange,
  services,
  importControl,
}: GoogleSetupGuideProps) {
  const state = (index: number) =>
    index < step
      ? ('done' as const)
      : index === step
        ? ('current' as const)
        : ('upcoming' as const);
  return (
    <Stack gap={4}>
      <Text>
        Set up your own Google app once. Conch connects directly to Google from your computer or
        server. No Conch cloud account or hosted connection service.
      </Text>
      {step < 3 && (
        <Button variant="ghost" onClick={() => onStepChange(3)}>
          I already have a credential file
        </Button>
      )}
      <GuideSteps label="Set up Google for Conch">
        <GuideSteps.Step
          number={1}
          title="Create or choose your Google project"
          state={state(0)}
          onEdit={() => onStepChange(0)}
          editLabel="Review project"
        >
          <Stack gap={3}>
            <Text>
              Open Google Cloud and create a project named Conch, or reuse your existing project.
              Keep that project selected in the following steps.
            </Text>
            <Open path="/projectcreate">Open Google Cloud</Open>
            <Field>
              <Field.Label>Project ID (optional)</Field.Label>
              <Input
                value={projectId}
                onChange={(e) => onProjectIdChange(e.target.value.trim())}
                placeholder="my-conch-project"
                autoComplete="off"
              />
              <Field.Description>
                Paste the project ID to make the following links open the right project. You can
                also select it in Google Cloud.
              </Field.Description>
            </Field>
            <Button onClick={() => onStepChange(1)}>My project is selected</Button>
          </Stack>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Enable the APIs for this job"
          state={state(1)}
          onEdit={() => onStepChange(1)}
          editLabel="Review APIs"
        >
          <Stack gap={3}>
            <Text>
              Open each API below and press Enable. If you see Manage, it is already enabled. You
              can add other Google apps later.
            </Text>
            {services.map((id) => (
              <Open
                key={id}
                path={`/apis/library/${GOOGLE_APIS[id].service}`}
                projectId={projectId}
              >
                Open {GOOGLE_APIS[id].name}
              </Open>
            ))}
            <Text tone="muted">
              These buttons open Google’s settings. Conch checks actual API access after you sign
              in.
            </Text>
            <Button onClick={() => onStepChange(2)}>I enabled these APIs</Button>
          </Stack>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Allow your Google account"
          state={state(2)}
          onEdit={() => onStepChange(2)}
          editLabel="Review audience"
        >
          <Stack gap={3}>
            <Text>
              In Google Auth Platform, press Get started if prompted. Use Conch as the app name and
              your email for support and contact. Choose External for a personal Google account;
              Internal is only for an eligible Workspace organization.
            </Text>
            <Open path="/auth/branding" projectId={projectId}>
              Open Branding
            </Open>
            <Text>
              In Audience, add the email you will connect under Test users while the app is in
              Testing.
            </Text>
            <Open path="/auth/audience" projectId={projectId}>
              Open Audience
            </Open>
            <Callout tone="info">
              Google’s Testing mode can require signing in again after seven days. Publishing
              changes those limits, but sensitive access may need Google verification. You can
              finish personal setup in Testing.
            </Callout>
            <Button onClick={() => onStepChange(3)}>My account is allowed</Button>
          </Stack>
        </GuideSteps.Step>
        <GuideSteps.Step number={4} title="Download your app’s credential file" state={state(3)}>
          <Stack gap={3}>
            <Text>
              In Clients, press Create client. Choose Desktop app, name it Conch, then create it and
              download its JSON file. Desktop app works for a self-hosted server too; you do not
              need to register a website or callback address.
            </Text>
            <Open path="/auth/clients" projectId={projectId}>
              Open Clients
            </Open>
            <PortalSketch
              label="Google’s client creation screen"
              address="console.cloud.google.com"
              title="Create OAuth client"
              nav={['Branding', 'Audience', 'Clients']}
              active="Clients"
            >
              <PortalSketch.Field label="Application type">Desktop app</PortalSketch.Field>
              <PortalSketch.Field label="Name">Conch</PortalSketch.Field>
              <PortalSketch.Row>
                <PortalSketch.Button>Create</PortalSketch.Button>
              </PortalSketch.Row>
            </PortalSketch>
            {importControl}
            <Button variant="ghost" onClick={() => onStepChange(0)}>
              Review setup steps
            </Button>
          </Stack>
        </GuideSteps.Step>
      </GuideSteps>
    </Stack>
  );
}
