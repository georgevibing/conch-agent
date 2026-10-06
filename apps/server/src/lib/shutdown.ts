/** One shutdown path for quit, update, watchdog and OS signals. First request wins. */
export function shutdownHandler(deps: {
  begin: () => void;
  drain: () => Promise<void>;
  close: () => Promise<void>;
  exit: (code: number) => void;
  warn: (message: string) => void;
  flushMs?: number;
  deadlineMs?: number;
}): (code: number) => Promise<void> {
  let stopping: Promise<void> | undefined;
  return (code) => {
    stopping ??= (async () => {
      let exited = false;
      const finish = () => {
        if (exited) return;
        exited = true;
        deps.exit(code);
      };
      const deadline = setTimeout(finish, deps.deadlineMs ?? 10_000);
      let flushTimer: NodeJS.Timeout | undefined;
      try {
        deps.begin();
        await Promise.race([
          deps.drain(),
          new Promise<void>((resolve) => {
            flushTimer = setTimeout(() => {
              deps.warn(
                'Saving progress took too long; Conch will recover from its last checkpoint.',
              );
              resolve();
            }, deps.flushMs ?? 5_000);
          }),
        ]).catch(() => deps.warn('Conch could not save its latest progress before stopping.'));
        clearTimeout(flushTimer);
        await deps.close();
      } catch {
        deps.warn('Some cleanup did not finish before Conch stopped.');
      } finally {
        clearTimeout(flushTimer);
        clearTimeout(deadline);
        finish();
      }
    })();
    return stopping;
  };
}
