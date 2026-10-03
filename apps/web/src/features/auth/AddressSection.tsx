import type { AddressStatus as Address, DnsReport } from '@conch/protocol';
import {
  AddressStatus,
  AlertDialog,
  Button,
  Dialog,
  DnsRecordCard,
  Field,
  Input,
  Pearl,
  Skeleton,
  Stack,
  Text,
  toast,
  type AddressProblem,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { Section } from '../settings/Section';
import styles from './Security.module.css';
import type { useVerify } from './useVerify';

type Guard = ReturnType<typeof useVerify>['guard'];

/** How often the set-up looks again for the record, while it's open. */
const LOOK_EVERY_MS = 5000;

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t work. Try again in a moment.';

/** "2 January 2027". */
const day = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** What Conch is doing now, in a few words. */
function progressOf(status: Address): string {
  return status.state === 'getting-certificate'
    ? 'Getting your certificate from Let’s Encrypt…'
    : 'Checking the way in from the internet…';
}

/** A problem's message, with what to do with its command when it has one. */
function problemText(problem: NonNullable<Address['problem']>): string {
  return problem.kind === 'ports-privilege' && problem.command
    ? `${problem.message} Run this on the computer running Conch, then press Try again.`
    : problem.message;
}

export function useAddress() {
  return useQuery({ queryKey: keys.address, queryFn: api.address, staleTime: 10_000 });
}

/**
 * Settings → Security → Your address (ADR 0064): where Conch answers on the
 * internet over its own certificate, the one fix when something's in the way,
 * and setting one up, the web's twin of `conch setup`.
 */
export function AddressSection({
  guard,
  focus,
}: {
  guard: Guard;
  /** A checkup fix (or ⌘K) asking to bring this section into view. */
  focus?: { place: string; done: () => void };
}) {
  const client = useQueryClient();
  const address = useAddress();
  const [settingUp, setSettingUp] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus?.place !== 'address' || address.isPending) return;
    focus.done();
    const section = ref.current;
    if (!section) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    section.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [focus, address.isPending]);

  // A gateway from before addresses doesn't know the route: nothing to show.
  if (address.isError) return null;

  const status = address.data;
  const set = (next: Address) => client.setQueryData(keys.address, next);

  /** Run a change, asking to confirm it's you when Conch asks. */
  const act = async (task: () => Promise<Address>) => {
    setBusy(true);
    try {
      await guard(async () => set(await task()));
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  };

  const problem = (status: Address): AddressProblem | undefined => {
    const wrong = status.problem;
    if (!wrong) return undefined;
    const name = status.name;
    // It mends itself (Let's Encrypt's limit, an outage): say when, offer nothing to press.
    const waits = wrong.kind === 'rate-limited' || wrong.kind === 'ca-unavailable';
    return {
      message: problemText(wrong),
      ...(wrong.command && { command: wrong.command }),
      ...(wrong.kind === 'another-computer'
        ? {
            action: {
              label: 'Turn on here',
              onClick: () => void act(api.addressHere),
              loading: busy,
            },
          }
        : status.state === 'ready'
          ? {
              action: {
                label: 'Try renewing now',
                onClick: () => void act(api.renewAddress),
                loading: busy,
              },
            }
          : !waits && name
            ? {
                action: {
                  label: 'Try again',
                  onClick: () => void act(() => api.setAddress(name)),
                  loading: busy,
                },
              }
            : {}),
    };
  };

  return (
    <Section
      ref={ref}
      title="Your address"
      description="Open Conch from anywhere at a domain you own. Conch keeps the connection secure with its own certificate."
    >
      {!status ? (
        <Skeleton shape="block" height={64} />
      ) : status.state === 'off' || !status.name ? (
        <AddressStatus state="off" onSetUp={() => setSettingUp(true)} />
      ) : (
        <AddressStatus
          state={
            status.state === 'ready' && !status.problem
              ? 'ready'
              : status.state === 'checking' || status.state === 'getting-certificate'
                ? 'getting'
                : 'problem'
          }
          address={status.name}
          progress={progressOf(status)}
          {...(status.certificate && { until: day(status.certificate.notAfter) })}
          {...(status.problem && { problem: problem(status) })}
          onTurnOff={() => setConfirmOff(true)}
        />
      )}

      <AlertDialog.Root open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialog.Content>
          <AlertDialog.Title>Turn off your address?</AlertDialog.Title>
          <AlertDialog.Description>
            Conch stops answering at https://{status?.name}. Devices that open it there lose their
            way in until you turn it back on.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep it on</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() =>
                void act(async () => {
                  const off = await api.removeAddress();
                  toast('Your address is off');
                  return off;
                })
              }
            >
              Turn off
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AddressSetUp
        open={settingUp}
        onOpenChange={setSettingUp}
        guard={guard}
        status={status}
        onStatus={set}
      />
    </Section>
  );
}

/**
 * The address path of `conch setup`, in the app: the name, the record to add
 * (looked for again by itself), then Conch answering there, followed live.
 */
function AddressSetUp({
  open,
  onOpenChange,
  guard,
  status,
  onStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guard: Guard;
  status: Address | undefined;
  onStatus: (status: Address) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<DnsReport>();
  const [checking, setChecking] = useState(false);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const here = report?.pointing === 'here' || report?.pointing === 'cloudflare';

  const reset = () => {
    setName('');
    setError(undefined);
    setReport(undefined);
    setStarted(false);
  };

  const look = async (wanted: string, quiet: boolean) => {
    if (!quiet) setChecking(true);
    try {
      const found = await api.addressDns(wanted);
      setReport(found);
      setError(undefined);
    } catch (e) {
      if (!quiet) {
        setReport(undefined);
        setError(message(e));
      }
    } finally {
      if (!quiet) setChecking(false);
    }
  };

  // Waiting for the record: look again now and then, and when the person comes back.
  const waiting = open && report !== undefined && !here && !started;
  const wanted = report?.name;
  useEffect(() => {
    if (!waiting || !wanted) return;
    const again = () => void look(wanted, true);
    const timer = setInterval(again, LOOK_EVERY_MS);
    window.addEventListener('focus', again);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', again);
    };
  }, [waiting, wanted]);

  const onCheck = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void look(name.trim(), false);
  };

  const turnOn = async () => {
    if (!report) return;
    setStarting(true);
    setError(undefined);
    try {
      const done = await guard(async () => onStatus(await api.setAddress(report.name)));
      if (done) setStarted(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setStarting(false);
    }
  };

  // What the address is doing now, once it's been turned on from here.
  const mine = started && status?.name === report?.name ? status : undefined;
  const ready = mine?.state === 'ready';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <Dialog.Content size="md">
        <Dialog.Header>
          <Dialog.Title>Your own address</Dialog.Title>
          <Dialog.Description>
            Open Conch from anywhere at a domain you own, like conch.yourname.com. Conch gets the
            certificate and renews it by itself.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={4}>
            {!started && (
              <form onSubmit={onCheck} aria-label="Your address">
                <Stack gap={2}>
                  <Field invalid={Boolean(error)}>
                    <Field.Label>Address</Field.Label>
                    <div className={styles.addressRow}>
                      <Input
                        name="address"
                        placeholder="conch.yourname.com"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setReport(undefined);
                        }}
                      />
                      <Button type="submit" variant="surface" loading={checking}>
                        Check
                      </Button>
                    </div>
                    {error && <Field.Error>{error}</Field.Error>}
                  </Field>
                </Stack>
              </form>
            )}

            {report && !started && (
              <DnsRecordCard
                name={report.name}
                state={here ? 'found' : 'waiting'}
                records={report.advice}
                {...((report.mine.v4 ?? report.mine.v6) && {
                  server: report.mine.v4 ?? report.mine.v6,
                })}
              />
            )}
            {report?.pointing === 'cloudflare' && !started && (
              <Text size="sm" tone="muted">
                {report.message}
              </Text>
            )}

            {mine && (mine.state === 'checking' || mine.state === 'getting-certificate') && (
              <p className={styles.addressProgress} role="status">
                <Pearl size="xs" state="thinking" label={null} />
                {progressOf(mine)}
              </p>
            )}
            {ready && (
              <p className={styles.addressProgress} role="status">
                <span>
                  Conch answers at{' '}
                  <a href={`https://${mine.name}`} target="_blank" rel="noreferrer">
                    https://{mine.name}
                  </a>{' '}
                  🔒
                </span>
              </p>
            )}
            {mine?.state === 'problem' && mine.problem && (
              <AddressStatus
                state="problem"
                address={mine.name ?? report?.name ?? ''}
                problem={{
                  message: problemText(mine.problem),
                  ...(mine.problem.command && { command: mine.problem.command }),
                  action: { label: 'Try again', onClick: () => void turnOn(), loading: starting },
                }}
              />
            )}
            {started && error && (
              <Text size="sm" tone="danger" role="alert">
                {error}
              </Text>
            )}

            {!ready && (
              <Text size="xs" tone="subtle">
                The certificate comes from Let’s Encrypt, free, and Conch renews it before it runs
                out.
              </Text>
            )}
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          {ready ? (
            <Dialog.Close asChild>
              <Button>Done</Button>
            </Dialog.Close>
          ) : (
            <>
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              {!started && (
                <Button disabled={!here} loading={starting} onClick={() => void turnOn()}>
                  Turn it on
                </Button>
              )}
            </>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
