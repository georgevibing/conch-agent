/**
 * @conch/nacre — public API.
 *
 * Import the stylesheet once at your app root:
 *   import '@conch/nacre/styles.css';
 */

// Theme & material
export * from './theme';
export { installLustre } from './lustre';
export { durations, easings, springs } from './tokens';
export { cx, useMediaQuery, usePrefersReducedMotion } from './utils';

// Layout & typography
export * from './components/Stack';
export * from './components/Surface';
export * from './components/Text';
export * from './components/Separator';
export * from './components/ScrollArea';

// Actions
export * from './components/Button';
export * from './components/IconButton';

// Forms
export * from './components/Field';
export * from './components/Input';
export * from './components/Textarea';
export * from './components/Checkbox';
export * from './components/Switch';
export * from './components/RadioGroup';
export * from './components/Select';
export * from './components/Slider';
export * from './components/SegmentedControl';

// Navigation & disclosure
export * from './components/Tabs';
export * from './components/Accordion';
export * from './components/Collapsible';

// Overlays
export * from './components/Tooltip';
export * from './components/Dialog';
export * from './components/AlertDialog';
export * from './components/Sheet';
export * from './components/Popover';
export * from './components/HoverCard';
export * from './components/DropdownMenu';
export * from './components/ContextMenu';
export * from './components/CommandPalette';

// Feedback
export * from './components/Spinner';
export * from './components/Pearl';
export * from './components/Progress';
export * from './components/Skeleton';
export * from './components/Callout';
export * from './components/Toast';

// Display
export * from './components/Kbd';
export * from './components/Highlight';
export * from './components/LiveTitle';
export * from './components/Badge';
export * from './components/Avatar';
export * from './components/EmptyState';

// Chat patterns
export * from './patterns';
