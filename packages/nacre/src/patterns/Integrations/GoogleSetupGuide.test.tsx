import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectAccessible, renderNacre } from '../../test/render';
import { GoogleSetupGuide } from './GoogleSetupGuide';
describe('Google setup guide', () => {
  it.each([0, 1, 2, 3])('keeps step %i accessible and clearly current', async (step) => {
    const { container } = renderNacre(
      <GoogleSetupGuide
        step={step}
        onStepChange={() => {}}
        projectId="personal-conch"
        onProjectIdChange={() => {}}
        services={['gmail']}
        importControl={<p>Choose your JSON file.</p>}
      />,
    );
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    await expectAccessible(container);
  });
  it('offers a keyboard shortcut past instructions and only links the requested APIs', async () => {
    const next = vi.fn();
    const { rerender } = renderNacre(
      <GoogleSetupGuide
        step={0}
        onStepChange={next}
        projectId="personal-conch"
        onProjectIdChange={() => {}}
        services={['calendar']}
        importControl={null}
      />,
    );
    screen.getByRole('button', { name: 'I already have a credential file' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(next).toHaveBeenCalledWith(3);
    rerender(
      <GoogleSetupGuide
        step={1}
        onStepChange={next}
        projectId="personal-conch"
        onProjectIdChange={() => {}}
        services={['calendar']}
        importControl={null}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open Google Calendar API' })).toHaveAttribute(
      'href',
      'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=personal-conch',
    );
    expect(screen.queryByRole('link', { name: 'Open Gmail API' })).not.toBeInTheDocument();
  });
});
