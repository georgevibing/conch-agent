import 'vitest';

interface AxeMatchers {
  toHaveNoViolations(): void;
}

declare module 'vitest' {
  // Type parameter must match vitest's declaration for interface merging.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
