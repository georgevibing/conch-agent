import { BuiltInEngineId, type ComputerSample, type ComputerStatus } from '@conch/protocol';
import {
  Button,
  ComputerHeader,
  CoreStrip,
  HelperList,
  LiveChart,
  ProviderLogo,
  Skeleton,
  Stack,
  StatTile,
  Text,
  type HelperRow,
} from '@conch/nacre';
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Cpu,
  Globe,
  HardDrive,
  MemoryStick,
  MonitorCog,
  Shell,
  SquareTerminal,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { providerLogo } from '../models/catalog';
import { Section } from '../settings/Section';
import { useComputer } from './api';
import styles from './Computer.module.css';
import { batteryWords, disk, duration, memory, percent, rate, statusOf } from './words';

const OS_MARK = { mac: 'macos', windows: 'windows', linux: 'linux', other: 'other' } as const;

const CPU_COLOR = 'var(--nc-chart-1)';
const MEMORY_COLOR = 'var(--nc-chart-3)';
const GRAPHICS_COLOR = 'var(--nc-chart-7)';

const usedShare = (part: { usedBytes: number; totalBytes: number }) =>
  part.totalBytes > 0 ? (part.usedBytes / part.totalBytes) * 100 : 0;

function helperIcon(id: string): ReactNode {
  if (id === 'browser') return <Globe />;
  if (id === 'other') return <SquareTerminal />;
  const engine = BuiltInEngineId.safeParse(id);
  return engine.success ? <ProviderLogo provider={providerLogo(engine.data)} size={16} /> : <Cpu />;
}

const processes = (n: number) => `${n} ${n === 1 ? 'process' : 'processes'}`;

/** The series a page draws, each one value per sample (null where a sample didn't have it). */
function history(samples: readonly ComputerSample[]) {
  const pick = (read: (s: ComputerSample) => number | undefined) =>
    samples.map((s) => read(s) ?? null);
  return {
    times: samples.map((s) => s.at),
    cpu: pick((s) => s.cpu),
    memory: pick((s) => usedShare(s.memory)),
    download: pick((s) => s.network?.inPerSecond),
    upload: pick((s) => s.network?.outPerSecond),
    graphics: pick((s) => s.graphics?.percent),
    conch: pick((s) => s.conch.cpu),
    helper: (id: string) =>
      pick((s) => (s.helpers ? (s.helpers.find((h) => h.id === id)?.cpu ?? 0) : undefined)),
  };
}

/**
 * Settings → This computer: the machine Conch runs on, live. How it's doing
 * in a few words, the numbers that matter at a glance, the last three
 * minutes as charts, and what Conch and everything it started take, by who
 * it belongs to. Conch only looks while this page is open.
 */
export function ComputerTab() {
  const { data, error, refetch, isFetching } = useComputer();
  if (!data) {
    return error ? (
      <Stack gap={3} align="start">
        <Text tone="muted">Conch couldn’t read this computer just now.</Text>
        <Button size="sm" variant="surface" onClick={() => void refetch()} loading={isFetching}>
          Try again
        </Button>
      </Stack>
    ) : (
      <ComputerLoading />
    );
  }
  return <ComputerPage status={data} live={!error} />;
}

function ComputerLoading() {
  return (
    <Stack gap={8} aria-busy="true">
      <Stack gap={2}>
        <Skeleton shape="text" width="10rem" />
        <Skeleton shape="block" width="16rem" height="2.5rem" />
      </Stack>
      <div className={styles.glance}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} shape="block" height="8.5rem" />
        ))}
      </div>
    </Stack>
  );
}

export function ComputerPage({ status, live = true }: { status: ComputerStatus; live?: boolean }) {
  const { info, samples, intervalMs } = status;
  const last = samples.at(-1);
  const series = useMemo(() => history(samples), [samples]);
  const latest = series.times.at(-1);
  const trend = (values: (number | null)[], color: string, max = 100) => ({
    values,
    max,
    color,
    latest,
    intervalMs,
  });
  const { status: words, tone } = statusOf(samples);

  const facts = [
    info.system,
    `${info.cores} cores`,
    `${memory(info.memoryBytes)} memory`,
    ...(info.graphics && info.graphics !== info.processor ? [info.graphics] : []),
    `Up ${duration(status.uptimeSeconds)}`,
  ];

  // One scale for every row, so a bigger sparkline is a bigger share.
  const helperMax = Math.max(
    5,
    ...series.conch.map((v) => v ?? 0),
    ...samples.flatMap((s) => s.helpers?.map((h) => h.cpu) ?? []),
  );
  const rows: HelperRow[] = last
    ? [
        {
          id: 'conch',
          label: 'Conch',
          icon: <Shell />,
          detail: `Running for ${duration(status.conchUptimeSeconds)}`,
          cpu: percent(last.conch.cpu),
          memory: memory(last.conch.memoryBytes),
          trend: trend(series.conch, CPU_COLOR, helperMax),
        },
        ...(last.helpers ?? []).map((helper) => ({
          id: helper.id,
          label: helper.label,
          icon: helperIcon(helper.id),
          detail: processes(helper.processes),
          cpu: percent(helper.cpu),
          memory: memory(helper.memoryBytes),
          trend: trend(series.helper(helper.id), CPU_COLOR, helperMax),
        })),
      ]
    : [];

  const diskShare = last?.disk ? usedShare(last.disk) : undefined;
  const diskTone =
    diskShare === undefined
      ? 'normal'
      : diskShare >= 95
        ? 'critical'
        : diskShare >= 90
          ? 'warning'
          : 'normal';

  return (
    <Stack gap={8}>
      <ComputerHeader
        os={OS_MARK[info.os]}
        name={info.processor}
        status={words}
        tone={tone}
        facts={facts}
        live={live}
        level={3}
      />

      {last && (
        <div className={styles.glance}>
          <StatTile
            label="Processor"
            icon={<Cpu />}
            value={percent(last.cpu)}
            detail={
              last.load !== undefined ? `Load ${last.load.toFixed(1)}` : `${info.cores} cores`
            }
            trend={trend(series.cpu, CPU_COLOR)}
          />
          <StatTile
            label="Memory"
            icon={<MemoryStick />}
            value={percent(usedShare(last.memory))}
            detail={`${memory(last.memory.usedBytes)} of ${memory(last.memory.totalBytes)}`}
            trend={trend(series.memory, MEMORY_COLOR)}
            tone={last.room === 'critical' ? 'critical' : 'normal'}
          />
          {last.disk && diskShare !== undefined && (
            <StatTile
              label="Disk"
              icon={<HardDrive />}
              value={percent(diskShare)}
              detail={`${diskTone === 'normal' ? '' : 'Running low · '}${disk(last.disk.totalBytes - last.disk.usedBytes)} free`}
              meter={diskShare}
              tone={diskTone}
            />
          )}
          {last.battery ? (
            <StatTile
              label="Battery"
              icon={batteryIcon(last.battery)}
              value={percent(last.battery.percent)}
              detail={batteryWords(last.battery)}
              meter={last.battery.percent}
              tone={
                last.battery.state === 'battery' && last.battery.percent <= 10
                  ? 'critical'
                  : 'normal'
              }
            />
          ) : last.graphics?.percent !== undefined ? (
            <StatTile
              label="Graphics"
              icon={<MonitorCog />}
              value={percent(last.graphics.percent)}
              detail={info.graphics ?? 'Graphics processor'}
              trend={trend(series.graphics, GRAPHICS_COLOR)}
            />
          ) : null}
        </div>
      )}

      <Section title="The last few minutes">
        <div className={styles.charts}>
          <Stack gap={3}>
            <LiveChart
              title="Processor"
              detail={last?.temperature !== undefined ? `${last.temperature} °C` : undefined}
              times={series.times}
              series={[{ id: 'cpu', label: 'Processor', values: series.cpu, color: CPU_COLOR }]}
              format={percent}
              max={100}
              intervalMs={intervalMs}
            />
            {last && last.cores.length > 1 && <CoreStrip values={last.cores} />}
          </Stack>
          <LiveChart
            title="Memory"
            detail={
              last
                ? `${memory(last.memory.usedBytes)} of ${memory(last.memory.totalBytes)}`
                : undefined
            }
            times={series.times}
            series={[{ id: 'memory', label: 'Memory', values: series.memory, color: MEMORY_COLOR }]}
            format={percent}
            max={100}
            intervalMs={intervalMs}
          />
          {samples.some((s) => s.network) && (
            <LiveChart
              title="Network"
              times={series.times}
              series={[
                { id: 'in', label: 'Download', values: series.download },
                { id: 'out', label: 'Upload', values: series.upload },
              ]}
              format={rate}
              intervalMs={intervalMs}
            />
          )}
          {samples.some((s) => s.graphics?.percent !== undefined) && (
            <LiveChart
              title="Graphics"
              detail={
                last?.graphics?.memoryUsedBytes !== undefined
                  ? `${memory(last.graphics.memoryUsedBytes)} in use`
                  : undefined
              }
              times={series.times}
              series={[
                { id: 'gpu', label: 'Graphics', values: series.graphics, color: GRAPHICS_COLOR },
              ]}
              format={percent}
              max={100}
              intervalMs={intervalMs}
            />
          )}
        </div>
      </Section>

      {rows.length > 0 && (
        <Section
          title="Conch and what it started"
          description="Grouped by who it belongs to. A command the assistant runs counts toward its provider."
        >
          <HelperList rows={rows} caption="Conch and what it started" />
        </Section>
      )}
    </Stack>
  );
}

function batteryIcon(battery: NonNullable<ComputerSample['battery']>) {
  if (battery.state === 'charging') return <BatteryCharging />;
  if (battery.percent <= 20) return <BatteryLow />;
  if (battery.percent <= 70) return <BatteryMedium />;
  return <BatteryFull />;
}
