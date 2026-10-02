import {
  GOOGLE_CREDENTIAL_LIMIT,
  parseGoogleCredentials,
  type GoogleCapability,
} from '@conch/protocol';
import {
  Accordion,
  Button,
  Callout,
  CopyButton,
  Field,
  GoogleSetupGuide,
  Input,
  PasswordInput,
  Stack,
  Text,
} from '@conch/nacre';
import { useRef, useState } from 'react';
import { googleApi } from './googleApi';

/** Browser-only draft state is a step number, never credentials or pasted return URLs. */
const stepKey = 'conch-google-setup-step';
function initialStep() {
  try {
    const step = Number(sessionStorage.getItem(stepKey));
    return Number.isInteger(step) && step >= 0 && step <= 3 ? step : 0;
  } catch {
    return 0;
  }
}
export function googleServices(
  capabilities: GoogleCapability[],
): ('gmail' | 'calendar' | 'drive')[] {
  return [
    ...new Set(
      capabilities.map((c) =>
        c.startsWith('mail-')
          ? ('gmail' as const)
          : c === 'calendar-read'
            ? ('calendar' as const)
            : ('drive' as const),
      ),
    ),
  ];
}
export function GoogleSetup({
  capabilities,
  busy,
  onSave,
}: {
  capabilities: GoogleCapability[];
  busy: boolean;
  onSave: (save: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [step, setStep] = useState(initialStep);
  const [projectId, setProjectId] = useState('');
  const [credentials, setCredentials] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const upload = useRef(0);
  const callbackUrl = `${window.location.origin}/oauth/google/callback`;
  const changeStep = (next: number) => {
    setStep(next);
    try {
      sessionStorage.setItem(stepKey, String(next));
    } catch {
      /* Private browsing. */
    }
  };
  const accept = (text: string) => {
    setCredentials('');
    setSummary('');
    setError('');
    try {
      const parsed = parseGoogleCredentials(text, callbackUrl);
      setCredentials(text);
      setSummary(
        `${parsed.clientType === 'desktop' ? 'Desktop app' : 'Web application'}${parsed.projectId ? ` · ${parsed.projectId}` : ''}. Ready to connect.`,
      );
      if (parsed.projectId) setProjectId(parsed.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Choose the OAuth client JSON from Google.');
    }
  };
  const save = async (operation: () => Promise<unknown>) => {
    if (await onSave(operation)) {
      setCredentials('');
      setClientId('');
      setClientSecret('');
      try {
        sessionStorage.removeItem(stepKey);
      } catch {
        /* Private browsing. */
      }
    }
  };
  return (
    <GoogleSetupGuide
      step={step}
      onStepChange={changeStep}
      projectId={projectId}
      onProjectIdChange={setProjectId}
      services={googleServices(capabilities)}
      importControl={
        <Stack gap={3}>
          <Field>
            <Field.Label>Google credential JSON</Field.Label>
            <Input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                const selection = ++upload.current;
                setCredentials('');
                setSummary('');
                setError('');
                if (!file) return;
                if (file.size > GOOGLE_CREDENTIAL_LIMIT) {
                  setError(
                    'Choose the small OAuth client JSON from Google, not an export or backup.',
                  );
                  return;
                }
                void file
                  .text()
                  .then((text) => {
                    if (selection === upload.current) accept(text);
                  })
                  .catch(() => {
                    if (selection === upload.current)
                      setError(
                        'That file could not be read. Download it again or paste its JSON below.',
                      );
                  });
              }}
            />
            <Field.Description>
              Choose the downloaded file. Conch reads it here and encrypts the credentials on your
              Conch computer. It never sends them to your assistant.
            </Field.Description>
          </Field>
          <Field>
            <Field.Label>Or paste credential JSON</Field.Label>
            <PasswordInput
              autoComplete="off"
              value={credentials}
              disabled={busy}
              onChange={(e) => {
                ++upload.current;
                accept(e.target.value);
              }}
            />
          </Field>
          {error && <Callout tone="danger">{error}</Callout>}
          {summary && <Text role="status">{summary}</Text>}
          <Button
            disabled={busy || !credentials}
            loading={busy}
            onClick={() => void save(() => googleApi.importCredentials(credentials))}
          >
            Save and connect Google
          </Button>
          <Accordion type="single" collapsible>
            <Accordion.Item value="manual">
              <Accordion.Trigger>Advanced: existing Web client</Accordion.Trigger>
              <Accordion.Content>
                <Stack gap={3}>
                  <Text>
                    Keep an existing Web application client if you prefer an automatic return on a
                    remote HTTPS address. Register this exact callback in Clients. A Desktop app
                    client does not need this step.
                  </Text>
                  <Field>
                    <Field.Label>Callback address to register</Field.Label>
                    <Input
                      readOnly
                      value={callbackUrl}
                      trailing={<CopyButton value={callbackUrl} label="Copy callback address" />}
                    />
                  </Field>
                  <Field>
                    <Field.Label>Google client ID</Field.Label>
                    <Input
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value.trim())}
                      autoComplete="off"
                      disabled={busy}
                    />
                  </Field>
                  <Field>
                    <Field.Label>Google client secret</Field.Label>
                    <PasswordInput
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value.trim())}
                      autoComplete="off"
                      disabled={busy}
                    />
                  </Field>
                  <Button
                    disabled={busy || !clientId || !clientSecret}
                    onClick={() =>
                      void save(() =>
                        googleApi.configure({
                          clientType: 'web',
                          clientId,
                          clientSecret,
                          redirectUrl: callbackUrl,
                        }),
                      )
                    }
                  >
                    Save Web client and connect
                  </Button>
                </Stack>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion>
        </Stack>
      }
    />
  );
}
