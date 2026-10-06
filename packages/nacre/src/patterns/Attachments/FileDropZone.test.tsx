import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { FileDropZone } from './FileDropZone';

const file = () => new File(['{"installed":{}}'], 'client.json', { type: 'application/json' });

describe('FileDropZone', () => {
  it('takes a dropped file, and says so while one is over it', async () => {
    const onFile = vi.fn();
    const { container } = renderNacre(
      <FileDropZone
        title="Drop the file Google gave you"
        hint="A small .json file."
        onFile={onFile}
      />,
    );
    const zone = screen.getByRole('group', { name: 'Drop the file Google gave you' });
    expect(zone).toHaveAccessibleDescription('A small .json file.');
    const dataTransfer = { types: ['Files'], items: [], files: [file()], dropEffect: 'none' };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(zone).toHaveAttribute('data-dragging');
    expect(screen.getByText('Let go to use this file')).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer });
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'client.json' }));
    expect(zone).not.toHaveAttribute('data-dragging');
    await expectAccessible(container);
  });

  it('opens the picker from its one button, by keyboard too, and leaves dragged text alone', async () => {
    const onFile = vi.fn();
    renderNacre(<FileDropZone title="Drop it here" accept=".json" onFile={onFile} />);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker).toHaveAttribute('tabindex', '-1');
    expect(picker).toHaveAttribute('accept', '.json');
    const click = vi.spyOn(picker, 'click');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Choose file' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(click).toHaveBeenCalled();
    await userEvent.upload(picker, file());
    expect(onFile).toHaveBeenCalledTimes(1);
    const zone = screen.getByRole('group', { name: 'Drop it here' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'] } });
    expect(zone).not.toHaveAttribute('data-dragging');
  });

  it('says what landed in words, announced, and can forget it', async () => {
    const onClear = vi.fn();
    const { container } = renderNacre(
      <FileDropZone
        title="Drop it here"
        onFile={() => undefined}
        state="error"
        fileName="service.json"
        message="This is a service-account key."
        onClear={onClear}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('service.json');
    expect(screen.getByRole('status')).toHaveTextContent('This is a service-account key.');
    expect(screen.getByRole('group', { name: 'Drop it here' })).toHaveAccessibleDescription(
      'This is a service-account key.',
    );
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Forget service.json' }));
    expect(onClear).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('offers pasting instead, only when asked', async () => {
    renderNacre(
      <FileDropZone
        title="Drop it here"
        onFile={() => undefined}
        paste={{ label: 'Paste its contents instead', content: <textarea aria-label="Contents" /> }}
      />,
    );
    expect(screen.queryByRole('textbox', { name: 'Contents' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paste its contents instead' }));
    expect(screen.getByRole('textbox', { name: 'Contents' })).toBeInTheDocument();
  });
});
