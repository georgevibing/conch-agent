/**
 * A press on a toast isn't a press outside: its Undo (or any action) acts on
 * what's open, so the dialog stays where it is.
 */
export function keepOpenForToasts<E extends { target: EventTarget | null; preventDefault(): void }>(
  handler?: (event: E) => void,
) {
  return (event: E) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-sonner-toaster]')) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
