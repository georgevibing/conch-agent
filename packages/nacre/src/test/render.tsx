import { render, type RenderOptions } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

import { NacreProvider } from '../theme';

/** Render inside a NacreProvider, as every real app does. */
export function renderNacre(ui: ReactElement, options?: RenderOptions) {
  return render(ui, {
    wrapper: ({ children }) => <NacreProvider scope="local">{children}</NacreProvider>,
    ...options,
  });
}

/** Assert that the rendered DOM has no axe-core violations. */
export async function expectAccessible(container: Element) {
  // color-contrast needs real layout, which jsdom lacks; Storybook's a11y addon covers it.
  const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results).toHaveNoViolations();
}
