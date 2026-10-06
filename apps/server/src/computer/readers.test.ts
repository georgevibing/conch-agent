import { describe, expect, it } from 'vitest';

import {
  cpuBetween,
  familyOf,
  linuxBattery,
  parseCpuTime,
  parseIoreg,
  parseNetstat,
  parseNvidiaSmi,
  parsePmset,
  parseProcNetDev,
  parsePs,
  pickTemperature,
} from './readers';

describe('reading this computer', () => {
  it('works out how busy the processor was, as a whole and per core', () => {
    const before = [
      { busy: 100, total: 1000 },
      { busy: 0, total: 1000 },
    ];
    const after = [
      { busy: 600, total: 2000 },
      { busy: 0, total: 2000 },
    ];
    expect(cpuBetween(before, after)).toEqual({ cpu: 25, cores: [50, 0] });
    // A core that appeared, or no time passing, never divides by zero.
    expect(cpuBetween([], [{ busy: 0, total: 0 }])).toEqual({ cpu: 0, cores: [0] });
  });

  it('counts the physical interfaces on a Mac once, and not loopback or tunnels', () => {
    const text = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       3763842     0 14536182764  3763842     0 14536182764     0
lo0        16384 127           localhost        3763842     - 14536182764  3763842     - 14536182764     -
en0        1500  <Link#11>   aa:bb:cc:dd:ee:ff  1000     0       5000     800     0       3000     0
en0        1500  192.168.1     192.168.1.20     1000     -       5000     800     -       3000     -
en1*       1500  <Link#12>                         10     0        100      10     0        200     0
utun3      1380  <Link#20>                        500     0     999999     500     0     999999     0`;
    expect(parseNetstat(text)).toEqual({ in: 5100, out: 3200 });
    expect(parseNetstat('Name Mtu\n')).toBeUndefined();
  });

  it('counts Linux interfaces but not loopback, bridges or tunnels', () => {
    const text = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9999 1 0 0 0 0 0 0 9999 1 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
 wlan0: 50 1 0 0 0 0 0 0 70 1 0 0 0 0 0 0
docker0: 8888 1 0 0 0 0 0 0 8888 1 0 0 0 0 0 0
tailscale0: 7777 1 0 0 0 0 0 0 7777 1 0 0 0 0 0 0`;
    expect(parseProcNetDev(text)).toEqual({ in: 1050, out: 2070 });
  });

  it('reads Apple’s graphics processor from ioreg', () => {
    const text = `      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=4455694336,"Renderer Utilization %"=7,"Device Utilization %"=12,"In use system memory"=1142489088}
      "model" = "Apple M3 Pro"`;
    expect(parseIoreg(text)).toEqual({
      name: 'Apple M3 Pro',
      percent: 12,
      memoryUsedBytes: 1142489088,
    });
    expect(parseIoreg('nothing here')).toBeUndefined();
  });

  it('reads NVIDIA’s from nvidia-smi', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4090, 37, 2048, 24564, 51\n')).toEqual({
      name: 'NVIDIA GeForce RTX 4090',
      percent: 37,
      memoryUsedBytes: 2048 * 1024 * 1024,
      memoryTotalBytes: 24564 * 1024 * 1024,
      temperature: 51,
    });
    // A field the card doesn't report is left out, not zero.
    expect(parseNvidiaSmi('Tesla T4, [N/A], 10, 15360, [N/A]')).toEqual({
      name: 'Tesla T4',
      memoryUsedBytes: 10 * 1024 * 1024,
      memoryTotalBytes: 15360 * 1024 * 1024,
    });
  });

  it('picks the processor’s temperature, or the warmest zone', () => {
    expect(
      pickTemperature([
        { type: 'acpitz', celsius: 70 },
        { type: 'x86_pkg_temp', celsius: 48.6 },
      ]),
    ).toBe(49);
    expect(pickTemperature([{ type: 'acpitz', celsius: 41 }])).toBe(41);
    expect(pickTemperature([{ type: 'x', celsius: Number.NaN }])).toBeUndefined();
  });

  it('reads the battery on a Mac and on Linux', () => {
    expect(
      parsePmset(
        "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true",
      ),
    ).toEqual({ percent: 100, state: 'charged' });
    expect(
      parsePmset(' -InternalBattery-0 (id=1)\t54%; charging; 1:02 remaining present: true'),
    ).toEqual({ percent: 54, state: 'charging' });
    expect(
      parsePmset(' -InternalBattery-0 (id=1)\t31%; discharging; 2:10 remaining present: true'),
    ).toEqual({ percent: 31, state: 'battery' });
    expect(parsePmset("Now drawing from 'AC Power'")).toBeUndefined();
    expect(linuxBattery('77\n', 'Discharging\n')).toEqual({ percent: 77, state: 'battery' });
    expect(linuxBattery('100', 'Full')).toEqual({ percent: 100, state: 'charged' });
  });

  it('reads processor time as ps prints it', () => {
    expect(parseCpuTime('1:18.47')).toBeCloseTo(78.47);
    expect(parseCpuTime('01:02:03')).toBe(3723);
    expect(parseCpuTime('2-00:00:01')).toBe(172_801);
    expect(parseCpuTime('garbage')).toBe(0);
  });

  it('groups what Conch started by who it belongs to, and nothing else', () => {
    const rows = parsePs(`    1     0  21600 15:11.98 /sbin/launchd
  100     1 80000 0:10.00 /usr/local/bin/node
  200   100 40000 0:05.00 /Users/me/.local/bin/claude
  201   200 2000 0:01.00 /bin/zsh
  202   201 1000 0:00.50 /usr/bin/git
  300   100 30000 0:02.00 /usr/local/bin/node
  400   100 90000 0:03.00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  401   400 50000 0:01.00 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer)
  500   100 1000 0:00.10 /bin/sh
  600     1 500000 0:30.00 /Applications/Ollama.app/Contents/Resources/ollama
  601   600 900000 1:00.00 /Applications/Ollama.app/Contents/Resources/ollama
  700     1 100000 9:00.00 /Applications/Slack.app/Contents/MacOS/Slack`);
    expect(rows[2]).toMatchObject({ pid: 200, ppid: 100, rssBytes: 40000 * 1024, cpuSeconds: 5 });
    const words = new Map([
      [300, '/usr/local/bin/node /opt/lib/node_modules/@openai/codex/bin/codex.js app-server'],
    ]);
    const family = familyOf(rows, 100, words);
    expect(Object.fromEntries(family)).toEqual({
      200: 'claude-code',
      // A command the assistant ran belongs to the provider that ran it.
      201: 'claude-code',
      202: 'claude-code',
      300: 'codex-cli',
      400: 'browser',
      401: 'browser',
      500: 'other',
      // Ollama runs on its own, but it is the model on this computer.
      600: 'ollama',
      601: 'ollama',
    });
    // Other programs, and Conch itself, are never in the list.
    expect(family.has(700)).toBe(false);
    expect(family.has(100)).toBe(false);
    // Without the script's words, a node process is only "ours".
    expect(familyOf(rows, 100).get(300)).toBe('other');
  });
});
