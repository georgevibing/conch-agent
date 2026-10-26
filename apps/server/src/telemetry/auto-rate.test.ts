import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TelemetryService } from './service';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-auto-rate-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('Auto’s ask rate, as numbers (ADR 0150)', () => {
  it('counts steps by mode and questions by reason, so questions per 100 steps can be read', async () => {
    const t = new TelemetryService({ home, version: '9.9.9', manual: true });
    for (let i = 0; i < 3; i++) t.autoStep('auto');
    t.autoStep('default');
    t.autoQuestion('install');
    t.autoQuestion('after-reading');
    t.autoQuestion('after-reading');
    t.auto('lifted', 'install');
    await t.update({ prometheus: { on: true } });
    const page = (await t.prometheus()).body;
    expect(page).toContain('conch_auto_steps_total{conch_mode="auto"} 3');
    expect(page).toContain('conch_auto_steps_total{conch_mode="default"} 1');
    expect(page).toContain('conch_auto_questions_total{conch_question_reason="install"} 1');
    expect(page).toContain('conch_auto_questions_total{conch_question_reason="after-reading"} 2');
    // A second look that lifted a question is counted as such, not as an unknown word.
    expect(page).toContain(
      'conch_auto_judgements_total{conch_verdict="lifted",conch_risk="install"} 1',
    );
    await t.stop(10);
  });

  it('never carries words: anything but a mode or a kind of reason is a placeholder', async () => {
    const t = new TelemetryService({ home, version: '9.9.9', manual: true });
    const command = `git push https://ada:${'ghp_' + 'A1b2C3d4E5f6G7h8I9j0'}@github.com/ada/shop`;
    t.autoStep(command);
    t.autoQuestion(command);
    await t.update({ prometheus: { on: true } });
    const page = (await t.prometheus()).body;
    expect(page).not.toContain('ghp_');
    expect(page).not.toContain('github.com');
    expect(page).toContain('conch_auto_steps_total{conch_mode="_OTHER"} 1');
    expect(page).toContain('conch_auto_questions_total{conch_question_reason="_OTHER"} 1');
    await t.stop(10);
  });
});
