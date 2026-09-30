/**
 * `pnpm start`: a small supervisor that keeps the gateway running and can start
 * it again (see `supervisor.ts`). Kept apart from `main.ts` so the supervisor
 * never loads the gateway itself.
 */
import { shouldSupervise, supervise } from './supervisor';

if (shouldSupervise()) await supervise();
else await import('./main');
