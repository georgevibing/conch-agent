import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';

/**
 * Settings → Dashboards (ADR 0121), against the real gateway and the mock
 * engine: Prometheus turned on, its token made once, a chat, and the scrape
 * that counts the turn and its tokens; then a pretend OpenTelemetry collector
 * on this computer, a test sent to it, and the span and numbers arriving.
 */

interface Received {
  path: string;
  type: string;
  body: Buffer;
}

let collector: Server;
let collectorUrl: string;
const received: Received[] = [];

test.beforeAll(async () => {
  collector = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      received.push({
        path: req.url ?? '',
        type: String(req.headers['content-type']),
        body: req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw,
      });
      res.writeHead(200, { 'content-type': 'application/x-protobuf' }).end();
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  collectorUrl = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  collector.closeAllConnections();
  collector.close();
});

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

async function shot(page: Page, name: string) {
  const dir = process.env.CONCH_SHOTS ?? test.info().outputDir;
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, `${name}-dark.png`), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
}

test('Prometheus reads the turn after a chat, with the token shown once', async ({
  page,
  request,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  // ⌘K listens once the app is up: pressed before that, it does nothing.
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('grafana');
  await page.getByRole('option', { name: /Dashboards/ }).click();
  await expect(page).toHaveURL(/\/settings\/dashboards$/);

  // Off, /metrics isn't there.
  expect((await request.get('/metrics')).status()).toBe(404);

  await page.getByRole('switch', { name: 'Answer at /metrics' }).click();
  await expect(page.getByText('Waiting for Prometheus to read it')).toBeVisible();
  await page.getByRole('button', { name: 'Make a scrape token' }).click();
  const config = page.getByRole('figure').filter({ hasText: 'prometheus.yml' });
  await expect(config).toContainText('job_name: conch');
  // The token arrives a moment after the config is drawn: wait for it, not just the config.
  await expect(config).toContainText(/conch_scrape_[A-Za-z0-9_-]{43}/);
  const text = (await config.textContent()) ?? '';
  const token = /conch_scrape_[A-Za-z0-9_-]{43}/.exec(text)?.[0];
  expect(token).toBeTruthy();

  // Without the token it says what it needs; another site can't read it at all.
  const bare = await fetch(`${baseURL}/metrics`);
  expect(bare.status).toBe(401);

  // A chat, then the scrape counts it.
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Hello there');
  await composer.press('Enter');
  await expect
    .poll(
      async () => {
        const res = await fetch(`${baseURL}/metrics`, {
          headers: { authorization: `Bearer ${token}` },
        });
        return res.ok ? await res.text() : '';
      },
      { timeout: 30_000 },
    )
    .toMatch(/conch_turns_total\{conch_provider="mock",[^}]*conch_origin="chat"[^}]*\} [1-9]/);
  const page2 = await (
    await fetch(`${baseURL}/metrics`, { headers: { authorization: `Bearer ${token}` } })
  ).text();
  expect(page2).toMatch(/conch_tokens_total\{[^}]*conch_token_type="output"\} [1-9]/);
  expect(page2).toContain('# TYPE gen_ai_client_operation_duration_seconds histogram');
  expect(page2).not.toContain('Hello there');

  // The page says Prometheus read it.
  await page.goto('/settings/dashboards');
  await expect(page.getByText(/Prometheus read it/)).toBeVisible({ timeout: 10_000 });
  await shot(page, 'dashboards-prometheus');
});

test('a test to a collector on this computer arrives', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/settings/dashboards');
  await page.getByRole('radio', { name: /On this computer/ }).click();
  await expect(page.getByRole('radio', { name: /On this computer/ })).toBeChecked();
  await page.getByRole('button', { name: 'Type them instead' }).click();
  const address = page.getByRole('textbox', { name: 'Address' });
  await address.fill(collectorUrl);
  await address.blur();
  await page.getByRole('switch', { name: /Send to the collector on this computer/ }).click();
  await page.getByRole('button', { name: 'Send a test' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'received it' })).toContainText(
    'The collector on this computer received it.',
    { timeout: 20_000 },
  );
  const traces = received.find(
    (r) => r.path === '/v1/traces' && r.body.includes('conch.dashboards.test'),
  );
  expect(traces?.type).toBe('application/x-protobuf');
  expect(received.some((r) => r.path === '/v1/metrics')).toBe(true);
  // What arrived carries Conch's name, never anyone's words.
  expect(Buffer.concat(received.map((r) => r.body)).toString('latin1')).toContain('conch');
  await shot(page, 'dashboards-sent');
});
