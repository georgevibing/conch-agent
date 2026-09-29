# Nacre — agent instructions

Nacre is Conch's design system. Read [docs/design/NACRE.md](../../docs/design/NACRE.md)
before changing anything visual.

## Layout

```
src/
  styles/       tokens.css, base.css, motion.css, lustre.css, utilities.css, index.css
  theme/        NacreProvider, accents & neutral presets
  lustre/       installLustre (delegated pointer listener)
  tokens/       JS mirrors of motion tokens (springs, durations, easings)
  utils/        cx, useMediaQuery…
  components/   Primitives (Button, Dialog, Input, …)
  patterns/     Chat compositions (Message, Composer, ToolCall, CodeBlock, …)
  stories/      Foundations docs (MDX) for Storybook
  test/         setup + renderNacre / expectAccessible helpers
  index.ts      Public barrel — the ONLY import path apps may use
```

## Component contract

Each component lives in `src/components/<Name>/` (patterns in `src/patterns/<Name>/`):

| File                 | Rules                                                                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Name>.tsx`         | Function components, React 19 `ref` as a prop. Behaviour from Radix (`radix-ui`) whenever a primitive exists — never hand-roll focus traps, roving tabindex, or dismissal. Variants/states exposed as `data-*` attributes. Support `asChild` where the element type may vary. Compound APIs via `Object.assign(Root, { Part })`. |
| `<Name>.module.css`  | Everything inside `@layer nacre.components { … }`. Only tokens (`var(--nc-*)`) — no raw colours, sizes or durations. Local knobs as `--<abbr>-*` custom properties that variants reassign. Hover inside `@media (hover: hover)`.                                                                                                 |
| `<Name>.stories.tsx` | Title `Components/<Group>/<Name>` or `Patterns/Chat/<Name>`. A `Playground` story with controls, one story per meaningful state, and a realistic composed example. Docs description explaining the design intent.                                                                                                                |
| `<Name>.test.tsx`    | `renderNacre` + `expectAccessible` (axe), keyboard interaction via `user-event`, controlled/uncontrolled behaviour.                                                                                                                                                                                                              |
| `index.ts`           | Re-export the component(s) and their prop types. Add to `src/index.ts`.                                                                                                                                                                                                                                                          |

## Do / don't

- **Do** add `data-lustre` to surfaces users touch, then tune the knobs down until it's
  _barely_ there. Lustre should be felt more than seen.
- **Do** use the spring tokens for transform transitions and `--nc-ease-out` for colour.
- **Do** test in light + dark and at `lustre=0`, `motion=reduced` (Storybook toolbar).
- **Don't** use `backdrop-filter` blur. Nacre is opaque.
- **Don't** encode meaning only in colour or iridescence.
- **Don't** import from `src/components/**` in apps — use the barrel.

## Verify

```bash
pnpm --filter @conch/nacre test          # unit + axe
pnpm --filter @conch/nacre typecheck
pnpm --filter @conch/nacre lint
pnpm storybook                           # then, from repo root:
node scripts/snap.mjs components-actions-button--variants --mode=dark
```
