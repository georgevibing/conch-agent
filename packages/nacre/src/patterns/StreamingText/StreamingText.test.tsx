import { describe, expect, it } from 'vitest';

import { renderNacre } from '../../test/render';
import { StreamingText } from './StreamingText';

describe('StreamingText', () => {
  it('animates appended chunks and keeps the full text', () => {
    const { container, rerender } = renderNacre(<StreamingText text="Hello" streaming />);
    const root = container.querySelector('[data-streaming]');
    expect(root).toHaveTextContent('Hello');
    rerender(<StreamingText text="Hello, world" streaming />);
    expect(root).toHaveTextContent('Hello, world');
    expect(root?.querySelectorAll('span[class]').length).toBeGreaterThanOrEqual(2);
  });

  it('resets when the text is replaced and drops the caret when done', () => {
    const { container, rerender } = renderNacre(<StreamingText text="abc" streaming />);
    rerender(<StreamingText text="xyz" />);
    const root = container.firstElementChild?.firstElementChild;
    expect(root).toHaveTextContent('xyz');
    expect(root).not.toHaveAttribute('data-streaming');
    expect(root?.querySelector('[aria-hidden]')).toBeNull();
  });

  it('merges old segments on long streams', () => {
    const { container, rerender } = renderNacre(<StreamingText text="a" />);
    let text = 'a';
    for (let i = 0; i < 100; i++) {
      text += 'b';
      rerender(<StreamingText text={text} />);
    }
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBeLessThanOrEqual(50);
    expect(container).toHaveTextContent(text);
  });
});
