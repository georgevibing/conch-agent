import { afterEach, describe, expect, it } from 'vitest';

import { MockDingTalk } from './dingtalk';
import { MockFeishu } from './feishu';
import { MockQq } from './qq';
import { MockWeChat } from './wechat';

const stops: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

// The default shared budget in guardMockServer.
const BUDGET = 1200;

describe('pretend providers share one request budget', () => {
  it.each([
    ['DingTalk', () => new MockDingTalk(), 'POST', '/v1.0/robot/oToMessages/batchSend'],
    ['Feishu', () => new MockFeishu(), 'GET', '/open-apis/bot/v3/info'],
    ['QQ', () => new MockQq(), 'GET', '/users/@me'],
    ['WeChat', () => new MockWeChat(), 'POST', '/cgi-bin/media/upload'],
  ] as const)(
    '%s answers 429 once every caller together spends it',
    async (_name, make, method, path) => {
      const mock = make();
      const base = await mock.start();
      stops.push(() => mock.stop());
      const send = () => fetch(`${base}${path}`, { method });
      // Below the concurrency cap, so only the budget can refuse.
      for (let sent = 0; sent < BUDGET; sent += 20) {
        const statuses = await Promise.all(
          Array.from({ length: 20 }, async () => {
            const response = await send();
            await response.arrayBuffer();
            return response.status;
          }),
        );
        expect(statuses).not.toContain(429);
      }
      const refused = await send();
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await refused.json()).toMatchObject({ error: 'rate-limited' });
    },
  );
});
