import {
  GOOGLE_CREDENTIAL_LIMIT,
  parseGoogleCredentials,
  productOf,
  type GoogleCapability,
} from '@conch/protocol';
import {
  Accordion,
  Button,
  CopyButton,
  Field,
  FileDropZone,
  GoogleSetupGuide,
  Input,
  PasswordInput,
  Stack,
  Text,
  type FileDropState,
} from '@conch/nacre';
import { useRef, useState } from 'react';
import { googleApi } from './googleApi';
import styles from './Integrations.module.css';

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
  return [...new Set(capabilities.map(productOf))];
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
  const [fileName, setFileName] = useState<string>();
  const [reading, setReading] = useState(false);
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
  const clear = () => {
    ++upload.current;
    setCredentials('');
    setSummary('');
    setError('');
    setFileName(undefined);
  };
  /** Checked here before anything is sent: what kind of client it is, and that it's one. */
  const accept = (text: string) => {
    setCredentials('');
    setSummary('');
    setError('');
    if (!text.trim()) return;
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
  const take = (file: File) => {
    const selection = ++upload.current;
    clear();
    upload.current = selection;
    setFileName(file.name);
    if (file.size > GOOGLE_CREDENTIAL_LIMIT) {
      setError(
        'That’s too big to be the file Google gave you. Choose the small client_secret….json.',
      );
      return;
    }
    setReading(true);
    void file
      .text()
      .then((text) => {
        if (selection === upload.current) accept(text);
      })
      .catch(() => {
        if (selection === upload.current)
          setError('That file couldn’t be read. Download it again, or paste what’s in it.');
      })
      .finally(() => {
        if (selection === upload.current) setReading(false);
      });
  };
  const state: FileDropState = reading ? 'checking' : error ? 'error' : credentials ? 'ok' : 'idle';
  const save = async (operation: () => Promise<unknown>) => {
    if (await onSave(operation)) {
      clear();
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
          <FileDropZone
            title="Drop the file you downloaded"
            hint="It’s a small .json file, usually in Downloads, named client_secret_….json."
            accept=".json,application/json"
            chooseLabel="Choose the file"
            disabled={busy}
            state={state}
            fileName={fileName}
            message={error || summary || undefined}
            onFile={take}
            onClear={clear}
            paste={{
              label: 'Paste what’s in it instead',
              content: (
                <Field>
                  <Field.Label>What’s in the file</Field.Label>
                  <PasswordInput
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    onChange={(e) => {
                      ++upload.current;
                      setFileName(undefined);
                      accept(e.target.value);
                    }}
                  />
                  <Field.Description>
                    Open the file in any text editor, copy everything, and paste it here.
                  </Field.Description>
                </Field>
              ),
            }}
          />
          <Text size="sm" tone="muted">
            Conch reads it here and keeps it locked on your Conch computer. Your assistant never
            sees it.
          </Text>
          <Button
            className={styles.fit}
            disabled={busy || !credentials}
            loading={busy}
            onClick={() => void save(() => googleApi.importCredentials(credentials))}
          >
            Save and continue with Google
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
                    className={styles.fit}
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
