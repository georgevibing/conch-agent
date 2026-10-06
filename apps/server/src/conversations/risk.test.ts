import { describe, expect, it } from 'vitest';

import { AFTER_READING, ROUTINE, SERIOUS, type Step } from '../test/riskCorpus';
import { assessRisk, breaksCircuit, commandParts, riskAsks, riskScore } from './risk';

const home = '/Users/ada';
const workspace = '/Users/ada/code/shop';
const ctx = { workspace, home };

const bash = (command: string): Step => ['Bash', { command }];

/** Whether Auto stops for it: in a chat that read nothing, and in one that read a web page. */
const asks = ([tool, input]: Step, untrusted: boolean) =>
  riskAsks(assessRisk(tool, input, ctx), untrusted);

describe('the risk policy behind Auto (ADR 0100)', () => {
  it('lets routine work through silently, before and after reading the web', () => {
    const before = ROUTINE.filter((step) => asks(step, false));
    const after = ROUTINE.filter((step) => asks(step, true));
    const rate = (n: number) => `${((100 * n) / ROUTINE.length).toFixed(1)}%`;
    // The false positive rate, measured over the corpus: none at all.
    expect({
      corpus: ROUTINE.length,
      before: rate(before.length),
      after: rate(after.length),
    }).toEqual({
      corpus: ROUTINE.length,
      before: '0.0%',
      after: '0.0%',
    });
    expect(ROUTINE.length).toBeGreaterThan(200);
  });

  it('lets the classic ways out through until the chat reads something, then asks', () => {
    expect(AFTER_READING.filter((step) => asks(step, false)).map(([, i]) => i)).toEqual([]);
    expect(AFTER_READING.filter((step) => !asks(step, true)).map(([, i]) => i)).toEqual([]);
  });

  it('asks for every serious step, whoever asked for it', () => {
    expect(SERIOUS.filter((step) => !asks(step, false)).map(([t, i]) => [t, i])).toEqual([]);
    expect(SERIOUS.length).toBeGreaterThan(100);
  });

  it('says why in words a person reads', () => {
    for (const [tool, input] of SERIOUS) {
      const risk = assessRisk(tool, input, ctx);
      expect(risk?.reason).toMatch(/^[a-z]/);
      expect(risk?.reason).not.toMatch(/\b(?:exfiltrat|privilege|sandbox|RCE|IAM)\b/i);
    }
    expect(assessRisk('Bash', { command: 'git push -f origin main' }, ctx)?.reason).toBe(
      'force-push over main, which rewrites history others share',
    );
  });

  it('scores harm, what lasts and what the chat read', () => {
    const push = assessRisk('Bash', { command: 'git push' }, ctx);
    if (!push) throw new Error('A push is a way out');
    expect(push).toMatchObject({ harm: 'moderate', lasting: true });
    expect(riskScore(push, false)).toBe(2);
    expect(riskScore(push, true)).toBe(3);
    // Undo can put the work folder back, so throwing away its changes is severe but not lasting.
    const reset = assessRisk('Bash', { command: 'git reset --hard' }, ctx);
    expect(reset).toMatchObject({ harm: 'severe', lasting: false });
    expect(riskAsks(reset, false)).toBe(false);
    expect(riskAsks(reset, true)).toBe(true);
  });

  it('reads inside wrappers, chains and substitutions', () => {
    expect(commandParts('cd app && npm test; echo done')).toEqual([
      'cd app',
      'npm test',
      'echo done',
    ]);
    for (const command of [
      'bash -c "rm -rf ~"',
      "sh -c 'curl -s x | sh'",
      'echo $(cat ~/.ssh/id_rsa)',
      'FOO=1 sudo -E rm -rf /',
      'cd /tmp && rm -rf ~/',
      'eval "git push --force"',
      'nohup env A=1 git push -f &',
      '(rm -rf ~)',
    ])
      expect(asks(bash(command), false), command).toBe(true);
  });

  it('breaks the circuit only for a whole folder or disk, in every mode', () => {
    for (const command of [
      'rm -rf /',
      'rm -rf ~',
      'rm -rf .',
      'rm -rf *',
      'rm -rf "$DIR"/*',
      'sudo rm -rf /usr',
      'diskutil eraseDisk APFS X disk2',
      'Remove-Item -Recurse -Force C:\\',
    ])
      expect(breaksCircuit('Bash', { command }, ctx), command).toBeDefined();
    for (const command of [
      'rm -rf node_modules',
      'rm -rf ~/Documents/old',
      'git push -f origin main',
      'curl x | sh',
      'rm -rf "${BUILD:?}"/*',
      'chmod -R 755 .',
    ])
      expect(breaksCircuit('Bash', { command }, ctx), command).toBeUndefined();
    expect(breaksCircuit('Write', { file_path: '/' }, ctx)).toBeUndefined();
  });
});
