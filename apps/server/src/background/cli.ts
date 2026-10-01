/**
 * `pnpm conch background [on|off|status]` and `pnpm conch quit`: Always on
 * from the terminal (ADR 0026), for the computer Conch runs on — a Mac mini
 * in a cupboard, a server you reach over SSH.
 */
import type { BackgroundService } from './service';

export interface BackgroundIo {
  say: (line?: string) => void;
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  /** The gateway recorded as running: its pid and whether the computer started it. */
  running: () => Promise<{ pid: number; port: number; background?: boolean } | undefined>;
  /** Conch answers at its address. */
  answering: () => Promise<boolean>;
  /** The address people open. */
  url: () => Promise<string>;
  /** The last thing Conch said in its log. */
  lastWords: () => Promise<string | undefined>;
  kill: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
  /** How long to wait for a background Conch to answer. */
  waitMs?: number;
}

export async function backgroundCommand(
  args: string[],
  service: BackgroundService,
  io: BackgroundIo,
): Promise<number> {
  const { say, bold, dim, green, yellow } = io;
  const verb = args[0] ?? 'status';
  const status = await service.status();

  if (verb === 'status') {
    say(bold('Always on'));
    say();
    if (!status.supported) {
      say(dim(status.unsupported ?? 'Always on isn’t available here.'));
      return 0;
    }
    say(
      status.on
        ? `${green('●')} On: Conch starts by itself when you log in.`
        : `${dim('○')} Off: Conch runs while its window is open.`,
    );
    const running = await io.running();
    if (running)
      say(
        dim(running.background ? '  Running in the background now.' : '  Running in a window now.'),
      );
    if (status.problem) {
      say(`${yellow('⚠')} ${status.problem.message}`);
      if (status.problem.command) say(dim(`  → ${status.problem.command}`));
    }
    if (status.place) say(dim(`  You'll find it in ${status.place}.`));
    say(
      dim(
        status.on ? '  pnpm conch background off · pnpm conch quit' : '  pnpm conch background on',
      ),
    );
    return 0;
  }

  if (verb === 'on') {
    if (!status.supported) {
      say(`✗ ${status.unsupported ?? 'Always on isn’t available here.'}`);
      return 1;
    }
    try {
      await service.enable();
    } catch (error) {
      say(`✗ ${(error as Error).message}`);
      return 1;
    }
    const running = await io.running();
    if (running && !running.background) {
      say(`${green('✓')} Always on is on.`);
      say(
        dim(
          'Conch is open in a window now. Close that window (or press Ctrl+C in it),\nand Conch carries on in the background by itself.',
        ),
      );
      return 0;
    }
    const deadline = Date.now() + (io.waitMs ?? 30_000);
    while (Date.now() < deadline && !(await io.answering())) await io.sleep(500);
    if (await io.answering()) {
      say(`${green('✓')} Conch is running in the background at ${bold(await io.url())}`);
      say(dim('It starts by itself when you log in. To stop it: pnpm conch quit'));
      return 0;
    }
    const said = await io.lastWords();
    say(`${yellow('⚠')} Conch will start when you log in, but didn’t start just now.`);
    if (said) say(dim(`  It said: ${said}`));
    return 1;
  }

  if (verb === 'off') {
    const result = await service.set(false);
    say(`${green('✓')} Always on is off: Conch won’t start by itself when you log in.`);
    if (result.status.running === 'background' || (await io.running())?.background)
      say(dim('Conch keeps running until you quit it: pnpm conch quit'));
    return 0;
  }

  say(
    `Unknown: ${verb}. Try ${bold('pnpm conch background on')}, ${bold('off')} or ${bold('status')}.`,
  );
  return 1;
}

/** `pnpm conch quit`: stop the Conch that's running, wherever it was started. */
export async function quitCommand(io: BackgroundIo): Promise<number> {
  const running = await io.running();
  if (!running) {
    io.say(io.dim('Conch isn’t running.'));
    return 0;
  }
  io.kill(running.pid);
  for (let i = 0; i < 20 && (await io.running()); i++) await io.sleep(250);
  if (await io.running()) {
    io.say(`${io.yellow('⚠')} Conch is still stopping. Give it a moment.`);
    return 1;
  }
  io.say(`${io.green('✓')} Conch has stopped.`);
  if (running.background) io.say(io.dim('It starts again when you log in, or when you open it.'));
  return 0;
}
