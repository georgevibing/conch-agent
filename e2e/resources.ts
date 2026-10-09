/**
 * Scripted journeys run many gateways beside Chromium on one CI runner. Their
 * pretend work needs a predictable computer, not the runner's shared load.
 * Preloaded only by Playwright: installed and development gateways still sample
 * real resources. Recovery continues to probe the real HTTP listener; admission,
 * pressure and freeze behavior have their own isolated tests in src/recovery.
 */
import { ProcessService } from '../apps/server/src/processes/service';
import { resourcePolicy } from '../apps/server/src/recovery/resources';

if (process.env.CONCH_ENGINE === 'mock') {
  ProcessService.prototype.readResources = async () =>
    resourcePolicy({
      at: Date.now(),
      totalBytes: 8 * 1024 ** 3,
      availableBytes: 6 * 1024 ** 3,
      cpuCount: 4,
      loadPerCpu: 0,
      memoryPressure: 0,
    });
}
