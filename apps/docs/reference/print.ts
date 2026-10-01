/**
 * Prints the reference as JSON on stdout. `plugin.ts` runs this in a process
 * of its own, so the server's modules load the way the server loads them.
 */
import { buildReference } from './build';

process.stdout.write(JSON.stringify(buildReference()));
