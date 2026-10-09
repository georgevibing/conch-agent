/**
 * `conch dashboards …` (ADR 0119): the same Settings → Dashboards, from the
 * terminal of the computer Conch runs on — for a server without a browser
 * nearby, or anyone who'd rather type. It writes the same files the page
 * does; the running gateway sees the change within seconds.
 *
 * Having this terminal is the proof that it's you, as for `conch key`: the
 * commands that send somewhere new or hand out a token are kept from the
 * assistant's own shell (`lib/protect.ts`).
 */
import {
  DASHBOARD_DESTINATIONS,
  DashboardDestinationId,
  destinationOf,
  destinationSubject,
  readDashboardPaste,
  type TelemetryStatus,
} from '@conch/protocol';

import type { Ui } from '../cli/ui';
import { DASHBOARDS_SUBCOMMANDS } from '../cliCommands';
import { scrapeConfig, type TelemetryService } from './service';

export interface DashboardsIo {
  ui: Ui;
  conch: (args: string) => string;
  /** Ask, with nothing echoed when `hidden` (a key). */
  ask: (question: string, options?: { hidden?: boolean }) => Promise<string>;
  /** Where the running Conch answers on this computer, if it's running. */
  gateway: () => Promise<string | undefined>;
  fetch?: typeof fetch;
}

const option = (args: string[], name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1]?.trim() || undefined : undefined;
};

const ago = (at: number | undefined) => {
  if (!at) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)} min ago`
      : `${Math.round(s / 3600)} h ago`;
};

function describe(status: TelemetryStatus, ui: Ui, conch: (args: string) => string): void {
  const { settings } = status;
  const destination = destinationOf(settings.otlp.destination);
  const rows: [string, string][] = [];
  rows.push([
    'Prometheus',
    settings.prometheus.on
      ? `on at /metrics, ${settings.prometheus.access === 'token' ? 'with its scrape token' : 'for programs on this computer'} · read ${ago(status.prometheus.lastScrapeAt)}`
      : 'off',
  ]);
  rows.push([
    'Sending',
    settings.otlp.on
      ? `to ${destinationSubject(destination, false)}${status.key.hint ? ` (key ${status.key.hint})` : ''} · last sent ${ago(status.otlp.lastSentAt)}`
      : 'off',
  ]);
  if (settings.otlp.on)
    rows.push([
      'What',
      [
        ...(['metrics', 'traces', 'logs'] as const).filter(
          (s) => settings.otlp.signals[s] && destination.signals.includes(s),
        ),
        settings.content ? 'with the words of chats' : 'numbers only, never words',
      ].join(' · '),
    ]);
  ui.kv(rows);
  if (status.otlp.problem) {
    ui.blank();
    ui.error(status.otlp.problem.message);
  }
  if (!settings.otlp.on && !settings.prometheus.on) {
    ui.blank();
    ui.hint(`Turn on Prometheus: ${ui.code(conch('dashboards prometheus'))}`);
    ui.hint(`Or send somewhere: ${ui.code(conch('dashboards send grafana-cloud'))}`);
  }
}

async function test(telemetry: TelemetryService, io: DashboardsIo): Promise<number> {
  const { ui } = io;
  const step = ui.step('Sending a test span and the numbers…');
  const result = await telemetry.test();
  if (result.ok) {
    step.done(`${result.message}${result.ms !== undefined ? ` (${result.ms} ms)` : ''}`);
    return 0;
  }
  step.fail(result.message);
  return 1;
}

export async function dashboardsCommand(
  args: string[],
  telemetry: TelemetryService,
  io: DashboardsIo,
): Promise<number> {
  const { ui, conch } = io;
  const [sub = 'status', name] = args.filter(
    (a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--')),
  );

  switch (sub) {
    case 'status':
      describe(await telemetry.status(), ui, conch);
      return 0;

    case 'test': {
      const status = await telemetry.status();
      if (!status.settings.otlp.on) {
        ui.error('Nothing is being sent yet.');
        ui.hint(`Choose where: ${ui.code(conch('dashboards send <destination>'))}`);
        return 1;
      }
      return test(telemetry, io);
    }

    case 'off':
      await telemetry.update({ otlp: { on: false }, prometheus: { on: false }, content: false });
      ui.ok('Dashboards are off: nothing is sent, and /metrics is closed.');
      return 0;

    case 'token':
    case 'prometheus': {
      const here = args.includes('--this-computer');
      await telemetry.update({
        prometheus: {
          on: true,
          ...(sub === 'prometheus' && { access: here ? 'this-computer' : 'token' }),
        },
      });
      const base = (await io.gateway()) ?? 'http://localhost:4317';
      const url = new URL(base);
      const where = { host: url.host, https: url.protocol === 'https:' };
      if (here) {
        ui.ok('/metrics is on, for programs on this computer.');
        ui.box(
          scrapeConfig(where)
            .replace(/ {4}authorization:\n.*\n.*\n/, '')
            .trimEnd()
            .split('\n'),
          {
            title: 'prometheus.yml',
            tone: 'accent',
          },
        );
      } else {
        const made = await telemetry.newScrapeToken(where);
        ui.ok(
          sub === 'token'
            ? 'Made a new scrape token. The old one stopped working.'
            : '/metrics is on, behind a scrape token.',
        );
        ui.box(made.config.trimEnd().split('\n'), { title: 'prometheus.yml', tone: 'accent' });
        ui.hint('Copy it now: the token won’t be shown again.');
        // Read it once, the way Prometheus will.
        const running = await io.gateway();
        if (running) {
          try {
            const res = await (io.fetch ?? fetch)(`${running}/metrics`, {
              headers: { authorization: `Bearer ${made.token}` },
              signal: AbortSignal.timeout(5000),
            });
            const body = await res.text();
            if (res.ok)
              ui.ok(
                `Conch answered with ${body.split('\n').filter((l) => l && !l.startsWith('#')).length} numbers.`,
              );
            else
              ui.note(
                `Conch answered ${res.status}. It may still be reading the new settings: try again in a few seconds.`,
              );
          } catch {
            ui.note('Conch didn’t answer just now. It reads the new settings when it starts.');
          }
        }
      }
      return 0;
    }

    case 'send': {
      const id = DashboardDestinationId.safeParse(name);
      if (!id.success) {
        ui.error(name ? `Conch doesn’t know “${name}”.` : 'Say where to send.');
        ui.kv(DASHBOARD_DESTINATIONS.map((d) => [d.id, `${d.name}: ${d.tagline}`] as const));
        return 1;
      }
      const destination = destinationOf(id.data);
      ui.say(ui.bold(destination.name));
      ui.hint(destination.keyHelp);
      let endpoint = option(args, '--endpoint');
      let region = option(args, '--region');
      const fields: Record<string, string> = {};
      if (destination.fields.length || (destination.endpoint && !endpoint)) {
        ui.blank();
        const paste = await io.ask(
          destination.fields.length
            ? 'Paste what it shows you (the key, or its OTEL_EXPORTER_OTLP lines):'
            : 'Its address (Enter for the usual one):',
          { hidden: destination.fields.some((f) => f.secret) },
        );
        const read = readDashboardPaste(paste, id.data);
        if (read.destination && read.destination !== id.data && Object.keys(read.fields).length) {
          ui.note(
            `That looks like ${destinationOf(read.destination).name}’s. Using it for ${destinationOf(read.destination).name}.`,
          );
        }
        Object.assign(fields, read.fields);
        endpoint ??= read.endpoint;
        region ??= read.region;
        for (const field of destination.fields)
          if (!fields[field.id] && !field.optional)
            fields[field.id] = (await io.ask(`${field.label}:`, { hidden: field.secret })).trim();
        if (destination.endpoint && !endpoint && !destination.endpoint.optional)
          endpoint = (await io.ask(`${destination.endpoint.label}:`)).trim() || undefined;
        const chosen =
          read.destination && read.destination !== id.data && Object.keys(read.fields).length
            ? read.destination
            : id.data;
        await telemetry.update({
          otlp: {
            on: true,
            destination: chosen,
            ...(endpoint && { endpoint }),
            ...(region && { region }),
          },
          key: fields,
        });
      } else
        await telemetry.update({
          otlp: {
            on: true,
            destination: id.data,
            ...(endpoint && { endpoint }),
            ...(region && { region }),
          },
        });
      ui.blank();
      return test(telemetry, io);
    }

    case 'help':
      ui.kv(
        DASHBOARDS_SUBCOMMANDS.map((s) => [conch(`dashboards ${s.usage}`), s.summary] as const),
      );
      return 0;

    default:
      ui.error(`Hmm, “dashboards ${sub}” isn’t something Conch knows.`);
      ui.hint(`See what it can do: ${ui.code(conch('dashboards help'))}`);
      return 1;
  }
}
