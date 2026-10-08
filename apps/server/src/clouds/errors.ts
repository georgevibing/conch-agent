import { ApiError } from '../engines/api/types';

/** Why a cloud couldn't be used, in the few ways the page and the chat answer differently. */
export type CloudProblem =
  /** No account chosen yet. */
  | 'not-chosen'
  /** The sign-in ended or was never made: one press signs in again. */
  | 'signed-out'
  /** The cloud's own program isn't on this computer: Conch can install it. */
  | 'missing-tool'
  /** The program is too old for what Conch asks of it: Conch can update it. */
  | 'outdated-tool'
  /** Signed in, but the account can't use these models (no access, wrong region). */
  | 'no-access'
  /** Anything else, said as the program said it. */
  | 'failed';

/**
 * A cloud failure. It is an `ApiError`, so a turn that meets it ends with the
 * right `TurnProblem` (a sign-in that ended is `signed-out`, never a dead end),
 * and it carries the need to install when that's the fix.
 */
export class CloudError extends ApiError {
  readonly problem: CloudProblem;
  readonly need?: string;

  constructor(problem: CloudProblem, message: string, options: { need?: string } = {}) {
    super(problem === 'failed' ? 'other' : problem === 'no-access' ? 'not-found' : 'auth', message);
    this.name = 'CloudError';
    this.problem = problem;
    if (options.need) this.need = options.need;
  }
}
