# 0002 — Nacre design system

- Status: accepted
- Date: 2026-09-29

## Context

The product's value is largely experiential: a calm, fast interface for a capable
agent. Off-the-shelf kits (MUI, Chakra, shadcn defaults) would give Conch a common
look, and frosted-glass effects cost GPU time and lower text contrast.

## Decision

Build **Nacre**, our own component library:

- **Behaviour & accessibility from Radix Primitives** (`radix-ui`), `cmdk` for the
  command palette, `sonner` for toasts, `shiki` for code highlighting — battle-tested
  headless layers we style completely.
- **Styling with CSS Modules + custom properties + cascade layers.** No runtime
  CSS-in-JS; variants are `data-*` attributes; all values are tokens.
- **OKLCH colour, derived at runtime** from a few knobs (accent hue/chroma, neutral
  tint), so themes are one CSS variable away and always perceptually balanced.
- **Lustre** — an opaque, porcelain material with pointer-reactive iridescence — as
  the brand signature instead of glass (see docs/design/NACRE.md).
- **Motion via CSS `linear()` springs** for state transitions and `motion` for layout
  animation, all collapsing under reduced-motion preferences.

## Consequences

More upfront work than adopting a kit, but full control over the details, a look
of its own, and no fighting library defaults. Every component must ship with stories
and axe-checked tests.
