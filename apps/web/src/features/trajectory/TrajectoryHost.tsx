import { RunSheet } from './RunSheet';
import { SaveDialog } from './SaveDialog';

/** How it did it, and saving it: over whatever is open (ADR 0113). */
export function TrajectoryHost() {
  return (
    <>
      <RunSheet />
      <SaveDialog />
    </>
  );
}
