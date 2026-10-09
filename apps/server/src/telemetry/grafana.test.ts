import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { METRICS, prometheusName } from './catalog';
import { grafanaDashboard, grafanaJson } from './grafana';

const FILE = join(import.meta.dirname, '../../../../docs/dashboards/conch-grafana.json');

interface Panel {
  type: string;
  title: string;
  targets?: { expr: string }[];
}

describe('the Grafana dashboard', () => {
  it('is the file kept in the repository', () => {
    expect(
      readFileSync(FILE, 'utf8'),
      'docs/dashboards/conch-grafana.json is out of date: run `pnpm --filter @conch/server exec tsx -e "import(\'./src/telemetry/grafana.ts\').then(m => process.stdout.write(m.grafanaJson()))" > docs/dashboards/conch-grafana.json`',
    ).toBe(grafanaJson());
  });

  it('asks only for metrics Conch has, by their Prometheus names', () => {
    const known = new Set(METRICS.map((m) => prometheusName(m)));
    const panels = grafanaDashboard().panels as Panel[];
    const asked = new Set<string>();
    for (const panel of panels)
      for (const t of panel.targets ?? [])
        for (const [, name = ''] of t.expr.matchAll(
          /\b((?:conch|gen_ai|system|process|nodejs)_[a-z0-9_]+)\{/g,
        ))
          asked.add(name.replace(/_(bucket|sum|count)$/, ''));
    for (const name of asked) expect(known, name).toContain(name);
    // Every turn number a person looks for first is on it.
    for (const name of [
      'conch_turns_total',
      'conch_cost_usd_total',
      'conch_tokens_total',
      'gen_ai_client_operation_duration_seconds',
    ])
      expect(asked).toContain(name);
  });

  it('has a title on every panel and nowhere two panels overlap', () => {
    const panels = grafanaDashboard().panels as (Panel & {
      gridPos: { x: number; y: number; w: number; h: number };
    })[];
    const cells = new Set<string>();
    for (const p of panels) {
      expect(p.title.length).toBeGreaterThan(2);
      expect(p.gridPos.x + p.gridPos.w).toBeLessThanOrEqual(24);
      for (let x = p.gridPos.x; x < p.gridPos.x + p.gridPos.w; x++)
        for (let y = p.gridPos.y; y < p.gridPos.y + p.gridPos.h; y++) {
          const cell = `${x},${y}`;
          expect(cells.has(cell), `${p.title} overlaps at ${cell}`).toBe(false);
          cells.add(cell);
        }
    }
  });
});
